import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EvalExportGate } from './eval-export.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-eval-export-'));
try {
  const gate = new EvalExportGate({ workDir: path.join(root, 'training'), exportsDir: path.join(root, 'exports') });
  await gate.load();

  const blocked = await gate.exportAdapter('ghost-job');
  assert.equal(blocked.error, 'FORBIDDEN', 'export without passing eval must be refused (fail-closed)');
  await fs.mkdir(path.join(root, 'exports'), { recursive: true });

  function makeJob(id, finalLoss) {
    return (async () => {
      const jobDir = path.join(root, 'training', id);
      await fs.mkdir(path.join(jobDir, 'adapter'), { recursive: true });
      await fs.mkdir(path.join(jobDir, 'checkpoints', 'checkpoint-100'), { recursive: true });
      await fs.writeFile(path.join(jobDir, 'adapter', 'adapter_config.json'), '{"r":16}');
      await fs.writeFile(path.join(jobDir, 'adapter', 'adapter_model.safetensors'), 'weights-bytes');
      await fs.writeFile(
        path.join(jobDir, 'checkpoints', 'checkpoint-100', 'trainer_state.json'),
        JSON.stringify({ log_history: [{ loss: 4.4, epoch: 0.5 }, { loss: finalLoss, epoch: 1 }] })
      );
    })();
  }

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

  const reloaded = new EvalExportGate({ workDir: path.join(root, 'training'), exportsDir: path.join(root, 'exports') });
  const listed = await reloaded.load();
  assert.deepEqual(listed, ['job-good'], 'approved exports must survive reload');
  assert.equal((await reloaded.exportAdapter('job-badloss')).error, 'FORBIDDEN');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('eval-export tests passed');
