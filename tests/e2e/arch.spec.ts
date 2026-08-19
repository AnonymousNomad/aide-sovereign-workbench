import { test, expect, type APIRequestContext } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const scratch = 'e2e-scratch.txt';
const scratchPath = path.join(repoRoot, scratch);

async function resetSession(): Promise<void> {
  await fs.rm(path.join(repoRoot, '.aide', 'session.json'), { force: true });
}

async function putSession(api: APIRequestContext, session: unknown): Promise<void> {
  const response = await api.put('/api/session', { data: session });
  expect(response.status()).toBe(200);
}

async function readFile(api: APIRequestContext, relPath: string): Promise<string | null> {
  const response = await api.get(`/api/file?path=${encodeURIComponent(relPath)}`);
  const envelope = (await response.json()) as { ok: boolean; data?: { content: string | null } };
  if (!envelope.ok) return null;
  return envelope.data?.content ?? null;
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async () => {
  await resetSession();
  await fs.rm(scratchPath, { force: true });
});

test.afterEach(async () => {
  await fs.rm(scratchPath, { force: true });
});

test('boots and shows daemon status', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#title')).toContainText('AIDE \u2014');
  await expect(page.locator('#status-dot')).toHaveClass(/ok/);
  await expect(page.locator('#status-bar')).toContainText(/daemon|ready/);
});

test('opens a file from the workspace list', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-activity="map"]').click();
  await page.locator('.file-list button', { hasText: 'package.json' }).first().click();
  await expect(page.locator('.group-editor .monaco-editor')).toBeVisible();
  await expect(page.locator('.group-tabbar .tab', { hasText: 'package.json' })).toBeVisible();
});

test('edits and saves a scratch file (daemon round-trip)', async ({ page, request }) => {
  await fs.writeFile(scratchPath, 'hello e2e\n', 'utf8');
  await page.goto('/');
  await page.locator('[data-activity="map"]').click();
  await page.locator('.file-list button', { hasText: scratch }).first().click();
  await expect(page.locator('.group-editor .monaco-editor')).toBeVisible();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('edited e2e content\n');
  await page.keyboard.press('Control+s');

  await expect.poll(async () => readFile(request, scratch)).toContain('edited e2e content');
});

test('search finds a match and opens the hit', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-activity="map"]').click();
  await page.locator('#search-q').fill('"name"');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.locator('.search-results .search-hit').first()).toBeVisible();
  await expect(page.locator('.search-summary')).toContainText('match');
  await page.locator('.search-results .search-hit').first().click();
  await expect(page.locator('.group-tabbar .tab').first()).toBeVisible();
});

test('split creates a second editor group', async ({ page }) => {
  await page.goto('/');
  await page.locator('[title="Split right"]').first().click();
  await expect(page.locator('.group')).toHaveCount(2);
  await expect(page.locator('.group').nth(1).locator('.group-tabbar')).toBeVisible();
});

test('session restore rebuilds tabs after reload', async ({ page, request }) => {
  await putSession(request, {
    version: 1,
    activeTab: `file:///${scratch}`,
    tabs: [{ uri: `file:///${scratch}` }]
  });
  await fs.writeFile(scratchPath, 'restored\n', 'utf8');
  await page.goto('/');
  await expect(page.locator('.group-tabbar .tab', { hasText: scratch })).toBeVisible();
});

test('ws event bus drops to err and reconnects to ok after a connection failure', async ({ page }) => {
  let failures = 0;
  await page.routeWebSocket('**/ws', ws => {
    if (failures++ < 2) {
      void ws.close();
    } else {
      void ws.connectToServer();
    }
  });
  await page.goto('/');
  await expect(page.locator('#status-dot')).toHaveClass(/err/, { timeout: 15000 });
  await expect(page.locator('#status-dot')).toHaveClass(/ok/, { timeout: 20000 });
  await expect(page.locator('#status-bar')).toContainText(/daemon|ready/);
});