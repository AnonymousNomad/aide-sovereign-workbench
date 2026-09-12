import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EvalExportGate } from './eval-export.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-eval-export-'));
const aide = path.join(root, '.aide');
const workDir = path.join(aide, 'training');
const exportsDir = path.join(aide, 'exports');
const tempRoots = [];
const mkTemp = async prefix => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
};

async function makeJob(id, finalLoss, baseDir = workDir) {
  const jobDir = path.join(baseDir, id);
  await fs.mkdir(path.join(jobDir, 'adapter'), { recursive: true });
  await fs.mkdir(path.join(jobDir, 'checkpoints', 'checkpoint-100'), { recursive: true });
  await fs.writeFile(path.join(jobDir, 'adapter', 'adapter_config.json'), '{"r":16}');
  await fs.writeFile(path.join(jobDir, 'adapter', 'adapter_model.safetensors'), 'weights-bytes');
  await fs.writeFile(
    path.join(jobDir, 'checkpoints', 'checkpoint-100', 'trainer_state.json'),
    JSON.stringify({ log_history: [{ loss: 4.4, epoch: 0.5 }, { loss: finalLoss, epoch: 1 }] })
  );
  return jobDir;
}

try {
  const gate = new EvalExportGate({ workDir, exportsDir });
  await gate.load();

  const blocked = await gate.exportAdapter('ghost-job');
  assert.equal(blocked.error, 'FORBIDDEN', 'export without passing eval must be refused (fail-closed)');
  await fs.mkdir(exportsDir, { recursive: true });

  await makeJob('job-badloss', 2.9);
  const badEval = await gate.evaluate('job-badloss');
  assert.equal(badEval.passed, false);
  assert.match(badEval.reasons[0], /exceeds gate/);
  assert.equal((await gate.exportAdapter('job-badloss')).error, 'FORBIDDEN');

  await makeJob('job-good', 1.42);
  const missingJob = await gate.evaluate('job-incomplete');
  assert.equal(missingJob.passed, false);
  assert.ok(missingJob.reasons.some(reason => /missing adapter_config/.test(reason)));

  const good = await gate.evaluate('job-good');
  assert.equal(good.passed, true);
  assert.equal(good.final_loss, 1.42);

  const exported = await gate.exportAdapter('job-good', { quant: 'Q4_K_M' });
  assert.equal(exported.manifest.status, 'passed');
  assert.equal(exported.manifest.source_files.length, 2);
  for (const file of exported.manifest.source_files) assert.match(file.sha256, /^[0-9a-f]{64}$/);
  assert.equal(exported.manifest.quant_target, 'Q4_K_M');

  const badQuant = await gate.exportAdapter('job-good', { quant: 'FP4' });
  assert.equal(badQuant.error, 'BAD_REQUEST');

  const reloaded = new EvalExportGate({ workDir, exportsDir });
  const listed = await reloaded.load();
  assert.deepEqual(listed, ['job-good'], 'approved exports must survive reload');
  assert.equal((await reloaded.exportAdapter('job-badloss')).error, 'FORBIDDEN');

  // --- Lexical traversal matrix (preserved) ---
  const escapedDir = path.join(root, 'escaped-job');
  await fs.mkdir(path.join(escapedDir, 'adapter'), { recursive: true });
  await fs.mkdir(path.join(escapedDir, 'checkpoints', 'checkpoint-1'), { recursive: true });
  await fs.writeFile(path.join(escapedDir, 'adapter', 'adapter_config.json'), '{"r":16}');
  await fs.writeFile(path.join(escapedDir, 'adapter', 'adapter_model.safetensors'), 'weights-bytes');
  await fs.writeFile(
    path.join(escapedDir, 'checkpoints', 'checkpoint-1', 'trainer_state.json'),
    JSON.stringify({ log_history: [{ loss: 0.5, epoch: 1 }] })
  );
  const outsideManifest = path.join(root, 'escaped-job-Q4_K_M.json');
  const exportsBefore = (await fs.readdir(exportsDir)).sort();

  const maliciousIds = [
    '..\\..\\escaped-job',
    '../../escaped-job',
    'C:\\Windows\\Temp\\evil',
    '\\\\server\\share\\evil',
    '/etc/passwd',
    '..',
    '.',
    '',
    '   ',
    'a/b',
    'a\\b',
    '%2e%2e%2fevil',
    'j'.repeat(65)
  ];
  for (const maliciousId of maliciousIds) {
    const evald = await gate.evaluate(maliciousId);
    assert.equal(evald.passed, false, `evaluate must reject ${JSON.stringify(maliciousId)}`);
    assert.match(String(evald.reasons[0] ?? ''), /invalid job id|escapes|resolves outside/, `reason for ${JSON.stringify(maliciousId)}`);
    const attempted = await gate.exportAdapter(maliciousId);
    assert.equal(attempted.error, 'BAD_REQUEST', `export must reject ${JSON.stringify(maliciousId)}`);
  }
  assert.equal(await fs.access(outsideManifest).then(() => true).catch(() => false), false, 'no manifest may be written outside the exports root');
  assert.deepEqual((await fs.readdir(exportsDir)).sort(), exportsBefore, 'rejected requests must not alter the exports root');

  const boundaryEval = await gate.evaluate('j'.repeat(64));
  assert.equal(boundaryEval.passed, false);
  assert.ok(!boundaryEval.reasons.includes('invalid job id'), '64-char safe id must pass validation');
  const tooLong = await gate.evaluate('j'.repeat(65));
  assert.deepEqual(tooLong.reasons, ['invalid job id']);

  // --- Effective filesystem-object containment ---
  // Read: job directory junction -> external artifacts.
  {
    const external = await mkTemp('aide-export-ext-job-');
    await makeJob('job-junction', 0.3, external);
    const junctionPath = path.join(workDir, 'job-junction');
    await fs.symlink(external, junctionPath, 'junction');
    const evald = await gate.evaluate('job-junction');
    assert.equal(evald.passed, false, 'junctioned job directory must fail closed');
    assert.match(evald.reasons.join(' '), /job directory resolves outside/);
    assert.equal((await gate.exportAdapter('job-junction')).error, 'BAD_REQUEST');
    assert.equal(await fs.access(path.join(exportsDir, 'job-junction-Q4_K_M.json')).then(() => true).catch(() => false), false);
    await fs.rm(junctionPath, { recursive: true, force: true });
  }

  // Read: contained job directory with nested adapter junction -> external artifacts.
  {
    const externalAdapter = await mkTemp('aide-export-ext-adapter-');
    await fs.mkdir(path.join(externalAdapter, 'adapter'), { recursive: true });
    await fs.writeFile(path.join(externalAdapter, 'adapter', 'adapter_config.json'), '{"external":true}');
    await fs.writeFile(path.join(externalAdapter, 'adapter', 'adapter_model.safetensors'), 'EXTERNAL-WEIGHTS');
    const jobDir = path.join(workDir, 'job-nested');
    await fs.mkdir(path.join(jobDir, 'checkpoints', 'checkpoint-100'), { recursive: true });
    await fs.writeFile(path.join(jobDir, 'checkpoints', 'checkpoint-100', 'trainer_state.json'), JSON.stringify({ log_history: [{ loss: 0.2, epoch: 1 }] }));
    await fs.symlink(path.join(externalAdapter, 'adapter'), path.join(jobDir, 'adapter'), 'junction');
    const evald = await gate.evaluate('job-nested');
    assert.equal(evald.passed, false, 'nested adapter junction must fail closed');
    assert.match(evald.reasons.join(' '), /adapter directory resolves outside|adapter_config\.json resolves outside/);
    assert.equal((await gate.exportAdapter('job-nested')).error, 'BAD_REQUEST');
    assert.equal(await fs.access(path.join(exportsDir, 'job-nested-Q4_K_M.json')).then(() => true).catch(() => false), false);
  }

  // Read: relevant leaf symlink -> external file (where the platform allows).
  {
    const externalFile = path.join(await mkTemp('aide-export-ext-leaf-'), 'config.json');
    await fs.writeFile(externalFile, '{"external-leaf":true}');
    const jobDir = await makeJob('job-leaf', 0.4);
    const configPath = path.join(jobDir, 'adapter', 'adapter_config.json');
    await fs.rm(configPath, { force: true });
    let leafSymlink = false;
    try {
      await fs.symlink(externalFile, configPath, 'file');
      leafSymlink = true;
    } catch { /* file symlinks may require privilege; skip honestly */ }
    if (leafSymlink) {
      const evald = await gate.evaluate('job-leaf');
      assert.equal(evald.passed, false, 'leaf symlink must fail closed');
      assert.match(evald.reasons.join(' '), /adapter_config\.json resolves outside/);
      assert.equal((await gate.exportAdapter('job-leaf')).error, 'BAD_REQUEST');
    } else {
      console.log('leaf-symlink case skipped: no privilege to create a file symlink');
    }
  }

  // Write: preexisting destination file symlink must not receive manifest bytes.
  {
    const sentinelDir = await mkTemp('aide-export-ext-dest-symlink-');
    const sentinel = path.join(sentinelDir, 'sentinel.json');
    await fs.writeFile(sentinel, 'SYMLINK-TARGET-SENTINEL');
    const manifestPath = path.join(exportsDir, 'job-good-Q4_K_M.json');
    await fs.rm(manifestPath, { force: true });
    let destSymlink = false;
    try {
      await fs.symlink(sentinel, manifestPath, 'file');
      destSymlink = true;
    } catch { /* skip honestly */ }
    if (destSymlink) {
      const attempt = await gate.exportAdapter('job-good');
      assert.equal(attempt.error, 'BAD_REQUEST');
      assert.equal(await fs.readFile(sentinel, 'utf8'), 'SYMLINK-TARGET-SENTINEL', 'external symlink target must be unchanged');
      await fs.rm(manifestPath, { force: true });
    } else {
      console.log('destination-symlink case skipped: no privilege to create a file symlink');
    }
  }

  // Write: preexisting destination hardlink must not modify the external target.
  {
    const hardDir = await mkTemp('aide-export-ext-dest-hardlink-');
    const hardTarget = path.join(hardDir, 'hard-target.json');
    await fs.writeFile(hardTarget, 'HARDLINK-TARGET-SENTINEL');
    const manifestPath = path.join(exportsDir, 'job-good-Q4_K_M.json');
    await fs.rm(manifestPath, { force: true });
    let destHardlink = false;
    try {
      await fs.link(hardTarget, manifestPath);
      destHardlink = true;
    } catch { /* skip honestly */ }
    if (destHardlink) {
      const attempt = await gate.exportAdapter('job-good');
      assert.equal(attempt.error, undefined, 'hardlink destination is replaced atomically');
      assert.equal(await fs.readFile(hardTarget, 'utf8'), 'HARDLINK-TARGET-SENTINEL', 'external hardlink target must be unchanged');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      assert.equal(manifest.status, 'passed');
      const [a, b] = await Promise.all([fs.stat(hardTarget), fs.stat(manifestPath)]);
      assert.notEqual(a.ino, b.ino, 'replacement must be a new file, not the shared inode');
    } else {
      console.log('destination-hardlink case skipped: no privilege to create a hardlink');
    }
  }

  // Write: ordinary existing regular manifest is replaced; fresh export works.
  {
    const manifestPath = path.join(exportsDir, 'job-good-Q4_K_M.json');
    const first = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const replaced = await gate.exportAdapter('job-good');
    assert.equal(replaced.error, undefined);
    assert.equal(replaced.manifest.status, 'passed');
    const second = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.equal(second.job_id, first.job_id);
    assert.notEqual(second.created_at < first.created_at, true, 'replacement manifest must be current');
  }

  // Root: application roots resolving outside the canonical workspace fail closed.
  {
    const ws2 = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-export-ws-junction-'));
    tempRoots.push(ws2);
    await fs.mkdir(path.join(ws2, '.aide', 'exports'), { recursive: true });
    const externalTraining = await mkTemp('aide-export-ext-training-root-');
    await makeJob('job-good', 0.3, externalTraining);
    await fs.symlink(externalTraining, path.join(ws2, '.aide', 'training'), 'junction');
    const gated = new EvalExportGate({ workDir: path.join(ws2, '.aide', 'training'), exportsDir: path.join(ws2, '.aide', 'exports') });
    const evald = await gated.evaluate('job-good');
    assert.equal(evald.passed, false, 'redirected training root must fail closed');
    assert.match(evald.reasons.join(' '), /training root resolves outside the canonical workspace/);
    assert.equal((await gated.exportAdapter('job-good')).error, 'BAD_REQUEST');
    assert.deepEqual(await gated.load(), []);

    const ws3 = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-export-ws-exports-junction-'));
    tempRoots.push(ws3);
    await fs.mkdir(path.join(ws3, '.aide', 'training'), { recursive: true });
    const externalExports = await mkTemp('aide-export-ext-exports-root-');
    await fs.symlink(externalExports, path.join(ws3, '.aide', 'exports'), 'junction');
    const gatee = new EvalExportGate({ workDir: path.join(ws3, '.aide', 'training'), exportsDir: path.join(ws3, '.aide', 'exports') });
    assert.deepEqual(await gatee.load(), [], 'redirected exports root must not inject approvals');
    assert.equal((await gatee.exportAdapter('job-good')).error, 'BAD_REQUEST');
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
  for (const dir of tempRoots) await fs.rm(dir, { recursive: true, force: true });
}
console.log('eval-export tests passed');
