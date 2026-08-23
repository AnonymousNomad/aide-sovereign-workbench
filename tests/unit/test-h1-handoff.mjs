import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function mkWs() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aide-h1-'));
}
// --- handoff service ---
import { createHandoffService, scanForSecrets } from '../../node/src/services/handoff-service.mjs';

function loopWith(transcript) {
  return {
    list: () => [{ session_id: 's-1' }],
    transcriptOf: id => (id === 's-1' ? transcript : (() => { throw new Error('no such session'); })()),
  };
}

test('handoff: secret scanner catches planted tokens', () => {
  assert.ok(scanForSecrets('key = sk-abcdefghijklmnopqrstuvwx').length === 1);
  assert.ok(scanForSecrets('token ghp_' + 'a'.repeat(30)).length === 1);
  assert.ok(scanForSecrets('-----BEGIN RSA PRIVATE KEY-----').length === 1);
  assert.equal(scanForSecrets('clean text nothing here').length, 0);
});

test('handoff: brief tier default writes bundle with distilled task', async () => {
  const ws = mkWs();
  const service = createHandoffService({
    workspace: ws,
    agentLoop: loopWith([
      { role: 'user', content: 'Fix the refund endpoint timeout' },
      { role: 'assistant', content: "I'll patch the retry budget. Should I also add telemetry?" },
      { role: 'tool', content: '<tool_result>ok</tool_result>' },
    ]),
  });
  const out = await service.exportBundle({});
  assert.equal(out.tier, 'brief');
  assert.equal(out.message_count, 0);
  const bundle = JSON.parse(fs.readFileSync(path.join(ws, out.file_path), 'utf8'));
  assert.match(bundle.brief.task, /refund endpoint timeout/);
  assert.ok(bundle.brief.decisions.length >= 1 || bundle.brief.open_questions.length >= 1);
  assert.equal(bundle.transcript, undefined);
});

test('handoff: transcript tier without confirmed is refused', async () => {
  const ws = mkWs();
  const service = createHandoffService({ workspace: ws });
  await assert.rejects(() => service.exportBundle({ tier: 'transcript', confirmed: false }));
});

test('handoff: transcript tier confirmed includes scrubbed transcript', async () => {
  const ws = mkWs();
  const service = createHandoffService({
    workspace: ws,
    agentLoop: loopWith([{ role: 'user', content: 'read C:\\Users\\grey\\proj\\secret.txt please' }]),
  });
  const out = await service.exportBundle({ tier: 'transcript', confirmed: true });
  assert.equal(out.message_count, 1);
  const bundle = JSON.parse(fs.readFileSync(path.join(ws, out.file_path), 'utf8'));
  assert.doesNotMatch(bundle.transcript[0].content, /C:\\Users\\grey/);
});

test('handoff: secret in transcript refuses unless confirmed_secret_scan', async () => {
  const ws = mkWs();
  const service = createHandoffService({
    workspace: ws,
    agentLoop: loopWith([{ role: 'assistant', content: 'the key is sk-abcdefghijklmnop12345678' }]),
  });
  await assert.rejects(
    () => service.exportBundle({ tier: 'transcript', confirmed: true }),
    err => err.code === 'SECRET_DETECTED'
  );
  const ok = await service.exportBundle({ tier: 'transcript', confirmed: true, confirmed_secret_scan: true });
  assert.ok(ok.bundle_id);
});

test('handoff: fork truncates via up_to_message_index; list+get roundtrip; import adopts', async () => {
  const ws = mkWs();
  const service = createHandoffService({
    workspace: ws,
    agentLoop: loopWith([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
    ]),
  });
  await service.exportBundle({ tier: 'transcript', confirmed: true, up_to_message_index: 2 });
  const listed = service.listBundles();
  assert.equal(listed.bundles.length, 1);
  const id = listed.bundles[0].id;
  const bundle = service.getBundle(id);
  assert.equal(bundle.transcript.length, 2);

  const receipt = service.importBundle(bundle);
  assert.match(receipt.context_id, /^import-/);
  assert.equal(receipt.message_count, 2);
  const relisted = service.listBundles();
  assert.equal(relisted.bundles.filter(b => b.imported).length, 1);
  assert.throws(() => service.getBundle('not-a-uuid'), err => err.code !== undefined);
});
