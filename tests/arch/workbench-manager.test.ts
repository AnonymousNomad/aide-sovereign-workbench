import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchManager, WorkbenchValidationError, WorkbenchTrustError } from '../../workbenches/manager.mjs';

let workspace: string;

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-wb-mgr-'));
});

after(async () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    try { await fs.rm(workspace, { recursive: true, force: true }); return; }
    catch (error) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
});

test('list() returns the shipped sovereign-coder bundle summary, installed=false', async () => {
  const manager = new WorkbenchManager({ workspace, egressConsent: () => false });
  const { workbenches } = await manager.list();
  const bundle = workbenches.find(entry => (entry as { id?: string }).id === 'sovereign-coder');
  assert.ok(bundle, 'sovereign-coder bundle is discoverable');
  const summary = bundle as { id: string; installed: boolean; validated: boolean; mcp_count: number; online_mcp_count: number; plugins_count: number; skills_count: number };
  assert.equal(summary.installed, false);
  assert.equal(summary.validated, true, 'all referenced plugins/skills/models resolve against the real registries');
  assert.equal(summary.mcp_count, 5);
  assert.equal(summary.online_mcp_count, 2, 'github + netdata are flagged online');
  assert.equal(summary.plugins_count, 10);
  assert.equal(summary.skills_count, 3);
});

test('install() persists state with all components disabled and zero trust', async () => {
  const manager = new WorkbenchManager({ workspace, egressConsent: () => false });
  const result = await manager.install('sovereign-coder');
  const bundle = (result as { workbench: { installed: boolean; enabled: boolean; plugins: Array<{ id: string; enabled: boolean }> } }).workbench;
  assert.equal(bundle.installed, true);
  assert.equal(bundle.enabled, false, 'installed-but-disabled by default');
  for (const plugin of bundle.plugins) assert.equal(plugin.enabled, false);
  const state = JSON.parse(await fs.readFile(path.join(workspace, '.aide', 'workbenches', 'sovereign-coder.json'), 'utf8')) as { enabled: boolean; mcp_trusted: Record<string, boolean>; plugins_enabled: Record<string, boolean> };
  assert.equal(state.enabled, false);
  assert.deepEqual(state.mcp_trusted, {}, 'no MCP server pre-trusted');
  assert.deepEqual(state.plugins_enabled, {}, 'no plugin pre-enabled');
});

test('trusting an offline server succeeds with no egress consent call', async () => {
  let consentCalls = 0;
  const local = new WorkbenchManager({ workspace, egressConsent: () => { consentCalls += 1; return false; } });
  await local.install('sovereign-coder');
  const before = consentCalls;
  await local.setTrust('sovereign-coder', 'filesystem', true);
  assert.equal(consentCalls, before, 'offline servers never consult the consent signal');
  const detail = (await local.get('sovereign-coder')) as { workbench: { mcp_servers: Array<{ name: string; trusted: boolean }> } };
  const filesystem = detail.workbench.mcp_servers.find(s => s.name === 'filesystem');
  assert.equal(filesystem?.trusted, true);
});

test('trusting an online server without consent throws CONSENT_REQUIRED (fail-closed)', async () => {
  const local = new WorkbenchManager({ workspace, egressConsent: () => false });
  await assert.rejects(
    () => local.setTrust('sovereign-coder', 'github', true),
    (error: unknown) => error instanceof WorkbenchTrustError && (error.detail as { code?: string }).code === 'CONSENT_REQUIRED'
  );
  const detail = (await local.get('sovereign-coder')) as { workbench: { mcp_servers: Array<{ name: string; trusted: boolean }> } };
  const github = detail.workbench.mcp_servers.find(s => s.name === 'github');
  assert.equal(github?.trusted, false);
});

test('trusting an online server with explicit consent succeeds and enables the bundle', async () => {
  const local = new WorkbenchManager({ workspace, egressConsent: server => server === 'github' });
  const result = await local.setTrust('sovereign-coder', 'github', true);
  const bundle = (result as { workbench: { enabled: boolean; mcp_servers: Array<{ name: string; trusted: boolean }> } }).workbench;
  assert.equal(bundle.enabled, true, 'enabling trust also enables the bundle (useless otherwise)');
  const github = bundle.mcp_servers.find(s => s.name === 'github');
  assert.equal(github?.trusted, true);
});

test('uninstall removes the installed state and get() reports installed=false (bundle stays discoverable)', async () => {
  const local = new WorkbenchManager({ workspace, egressConsent: () => true });
  await local.install('sovereign-coder');
  await local.setTrust('sovereign-coder', 'github', false);
  const detail = (await local.get('sovereign-coder')) as { workbench: { installed: boolean; mcp_servers: Array<{ name: string; trusted: boolean }> } };
  const github = detail.workbench.mcp_servers.find(s => s.name === 'github');
  assert.equal(github?.trusted, false, 'server trust removed');
  const removed = (await local.uninstall('sovereign-coder')) as { removed: string };
  assert.equal(removed.removed, 'sovereign-coder');
  // After uninstall, the bundle is still discoverable but reported as not installed.
  const after = (await local.get('sovereign-coder')) as { workbench: { installed: boolean } };
  assert.equal(after.workbench.installed, false);
  // And the state file is gone.
  await assert.rejects(
    () => fs.access(path.join(workspace, '.aide', 'workbenches', 'sovereign-coder.json')),
    (error: unknown) => error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
});

test('installing a non-existent workbench fails with a validation error naming the id', async () => {
  const local = new WorkbenchManager({ workspace });
  await assert.rejects(
    () => local.install('not-a-real-workbench-id'),
    (error: unknown) => error instanceof WorkbenchValidationError && (error.issues ?? []).some((issue: string) => issue.includes('not-a-real-workbench-id'))
  );
});
