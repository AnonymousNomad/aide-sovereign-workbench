import { test, expect, type APIRequestContext } from '@playwright/test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const scratch = 'e2e-scratch.txt';
const scratchPath = path.join(repoRoot, scratch);
const brokenTs = 'e2e-broken.ts';
const brokenTsPath = path.join(repoRoot, brokenTs);
const completeTs = 'e2e-complete.ts';
const completeTsPath = path.join(repoRoot, completeTs);
const hoverTs = 'e2e-hover.ts';
const hoverTsPath = path.join(repoRoot, hoverTs);
const defATs = 'e2e-def-a.ts';
const defATsPath = path.join(repoRoot, defATs);
const defBTs = 'e2e-def-b.ts';
const defBTsPath = path.join(repoRoot, defBTs);
const chatgptExport = 'e2e-chatgpt-export.json';
const chatgptExportPath = path.join(repoRoot, chatgptExport);
const chatHistoryPath = path.join(repoRoot, '.aide', 'chat-history.json');

async function removeScratchFiles(): Promise<void> {
  for (const p of [scratchPath, brokenTsPath, completeTsPath, hoverTsPath, defATsPath, defBTsPath, chatgptExportPath, chatHistoryPath]) {
    await fs.rm(p, { force: true });
  }
}

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
  await removeScratchFiles();
});

test.afterEach(async () => {
  await removeScratchFiles();
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

test('opening a broken ts file surfaces an lsp error marker in the editor', async ({ page }) => {
  await fs.writeFile(brokenTsPath, 'export const answer: string = 42;\n', 'utf8');
  await page.goto('/');
  await page.locator('[data-activity="map"]').click();
  await page.locator('.file-list button', { hasText: brokenTs }).first().click();
  await expect(page.locator('.group-editor .monaco-editor')).toBeVisible();
  await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible({ timeout: 60000 });
});

test('lsp completion suggests members of a ts object', async ({ page }) => {
  await fs.writeFile(completeTsPath, 'const toolbox = { wrench: 1, screwdriver: 2 };\nconst t = toolbox.\n', 'utf8');
  await page.goto('/');
  await page.locator('[data-activity="map"]').click();
  await page.locator('.file-list button', { hasText: completeTs }).first().click();
  await expect(page.locator('.group-editor .monaco-editor')).toBeVisible();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Control+Space');
  await expect(page.locator('.suggest-widget')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.suggest-widget')).toContainText('wrench');
  await page.keyboard.press('Escape');
});

test('lsp hover shows type information for a ts symbol', async ({ page }) => {
  await fs.writeFile(hoverTsPath, 'const gadget = 42;\n', 'utf8');
  await page.goto('/');
  await page.locator('[data-activity="map"]').click();
  await page.locator('.file-list button', { hasText: hoverTs }).first().click();
  await page.locator('[data-activity="map"]').click();
  await expect(page.locator('.group-editor .monaco-editor')).toBeVisible();
  await expect(page.locator('#lsp-status')).toContainText('running', { timeout: 60000 });
  const line = page.locator('.group-editor .view-line').first();
  await expect.poll(async () => (await line.boundingBox()) !== null, { timeout: 30000 }).toBe(true);
  const box = await line.boundingBox();
  assert.ok(box, 'first view line must have a bounding box');
  await page.mouse.move(box.x + 75, box.y + box.height / 2);
  await expect(page.locator('.monaco-hover:not([widgetid])')).toContainText('gadget', { timeout: 60000 });
  await page.mouse.move(0, 0);
});

test('exp chat panel lists models and surfaces not-ready honestly', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(String(err)));
  await page.goto('/');
  await page.locator('[data-activity="exp"]').click();
  await expect(page.locator('#chat-model')).toBeVisible();
  await expect(page.locator('#chat-model option').first()).toBeAttached({ timeout: 30000 });
  const options = await page.locator('#chat-model option').count();
  expect(options).toBeGreaterThanOrEqual(3);
  await page.locator('#chat-input').fill('hello model');
  await page.locator('#chat-send').click();
  await expect(page.locator('#status-right')).toContainText(/model:|start this model|warming/, { timeout: 30000 });
  expect(pageErrors, 'chat panel must not throw page errors').toEqual([]);
});

test('exp chat panel binds per conversation and shows the down-switch banner', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(String(err)));
  await page.goto('/');
  await page.locator('[data-activity="exp"]').click();
  await expect(page.locator('#chat-model')).toBeVisible();
  await expect(page.locator('#chat-model option').first()).toBeAttached({ timeout: 30000 });
  const firstValue = await page.locator('#chat-model').inputValue();
  expect(firstValue.length).toBeGreaterThan(0);
  const bigCtxValue = await page.locator('#chat-model option', { hasText: 'SmolLM2 1.7B' }).first().getAttribute('value');
  expect(bigCtxValue).not.toBeNull();
  await page.locator('#chat-model').selectOption(bigCtxValue!);
  const bound = await page.locator('#chat-model').inputValue();
  expect(bound).toContain('smollm2-1.7b-instruct');
  const smallCtxValue = await page.locator('#chat-model option', { hasText: 'SmolLM2 360M' }).first().getAttribute('value');
  expect(smallCtxValue).not.toBeNull();
  await page.locator('#chat-model').selectOption(smallCtxValue!);
  await expect(page.locator('#chat-banner')).toContainText(/switching from .* \(8192 ctx\) to .* \(2048 ctx\)/, { timeout: 10000 });
  expect(pageErrors, 'chat panel must not throw page errors').toEqual([]);
});

test('route endpoint reports not-ready honestly when no model is running', async ({ page }) => {
  await page.goto('/');
  const envelope = await page.evaluate(async () => {
    const response = await fetch('/api/models/route', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'chat' })
    });
    return response.json();
  });
  expect(envelope).toHaveProperty('ok', false);
  expect(envelope.error.code).toBe('NOT_READY');
  expect(envelope.error.message).toMatch(/start this model/);
});

test('fit endpoint estimates tokens and reports dropped turns', async ({ page }) => {
  await page.goto('/');
  const fit = await page.evaluate(async () => {
    const messages = [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second question' }
    ];
    const response = await fetch('/api/models/fit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, contextLength: 2048 })
    });
    return response.json();
  });
  expect(fit.ok).toBe(true);
  expect(fit.data.estimatedTokens).toBeGreaterThan(0);
  expect(fit.data.dropped).toBe(0);
  expect(fit.data.overflow).toBe(false);
  expect(fit.data.messages.length).toBe(3);
});

test('lsp go-to-definition jumps the cursor to the declaration', async ({ page }) => {
  await fs.writeFile(defATsPath, 'function widget(): number { return 7; }\nconst w = widget();\n', 'utf8');
  await page.goto('/');
  await page.locator('[data-activity="map"]').click();
  await page.locator('.file-list button', { hasText: defATs }).first().click();
  await page.locator('[data-activity="map"]').click();
  await expect(page.locator('.group-editor .monaco-editor')).toBeVisible();
  await expect(page.locator('#lsp-status')).toContainText('running', { timeout: 60000 });
  const usageLine = page.locator('.group-editor .view-line').nth(1);
  await usageLine.waitFor({ state: 'visible' });
  await usageLine.click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('F12');
  await expect(page.locator('.monaco-alert').first()).toContainText('Found 1 symbol', { timeout: 30000 });
});

test('providers panel lists built-in providers and renders connect forms', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(String(err)));
  await page.goto('/');
  await page.locator('[data-activity="exp"]').click();
  await expect(page.locator('.provider-row')).toHaveCount(6, { timeout: 30000 });
  await expect(page.locator('.provider-row').first()).toContainText('OpenAI');
  await page.locator('.provider-row').first().locator('.provider-action').click();
  await expect(page.locator('.provider-row').first().locator('.provider-form')).toBeVisible();
  await expect(page.locator('.provider-row').first().locator('.provider-key')).toBeVisible();
  await expect(page.locator('.provider-row').first().locator('.provider-base')).toHaveValue(/api\.openai\.com/);
  await expect(page.locator('.provider-row').first().locator('.provider-approve')).toHaveClass(/hidden/);
  await page.locator('.provider-row').first().locator('.provider-cancel').click();
  await expect(page.locator('.provider-row').first().locator('.provider-action')).toHaveText('Connect');
  expect(pageErrors, 'providers panel must not throw page errors').toEqual([]);
});

test('imports a chatgpt export into local history', async ({ page }) => {
  await fs.writeFile(
    chatgptExportPath,
    JSON.stringify({
      conversations: [
        {
          id: 'conv-e2e-1',
          title: 'e2e import',
          create_time: 1700000000,
          current_node: 'n2',
          mapping: {
            n1: { message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['hello'] } }, parent: null },
            n2: { message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['hi there'] } }, parent: 'n1' }
          }
        }
      ]
    }),
    'utf8'
  );
  await page.goto('/');
  await page.locator('[data-activity="exp"]').click();
  await page.locator('#import-file').setInputFiles(chatgptExportPath);
  await expect(page.locator('#import-status')).toContainText('imported 1 chat(s)', { timeout: 30000 });
});