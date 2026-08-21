import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { TrainingRunner } from './training-runner.mjs';

function fakeChild(script) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr.setEncoding = () => {};
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    queueMicrotask(() => child.emit('exit', null));
    return true;
  };
  child.script = script;
  return child;
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-training-'));
try {
  const runner = new TrainingRunner({ workDir: root });
  assert.deepEqual(runner.status(), { state: 'idle' });

  assert.equal((await runner.start({ approved: false })).error, 'FORBIDDEN');
  assert.equal((await runner.start({ approved: true, preset: '70b' })).error, 'BAD_REQUEST');
  assert.equal((await runner.start({ approved: true, sampleCount: 4 })).error, 'BAD_REQUEST');

  const events = [];
  const live = new TrainingRunner({
    workDir: root,
    onEvent: (channel, body) => events.push([channel, body.event]),
    spawnChild: () => {
      const child = fakeChild();
      queueMicrotask(() => {
        child.stdout.emit('data', 'epoch 1\n');
        child.stdout.emit('data', "{'loss': 2.50, 'step': 5}\n{'loss': 1.80}\n");
        child.stderr.emit('data', 'warn: something benign\n');
        child.stdout.emit('data', 'training complete\n');
        child.emit('exit', 0);
      });
      return child;
    }
  });
  const started = await live.start({ datasetId: 'ds-1', datasetPath: path.join(root, 'ds.jsonl'), sampleCount: 42, preset: '0.5b', approved: true });
  assert.equal(started.state, 'training');
  await new Promise(resolve => live.onEvent && setTimeout(resolve, 30));
  const status = live.status();
  assert.equal(status.state, 'done');
  assert.equal(status.exit_code, 0);
  assert.equal(status.loss_last, 1.8);
  assert.equal(status.oom_advice.length, 0);
  assert.deepEqual(events, [['training', 'started'], ['training', 'loss'], ['training', 'loss'], ['training', 'completed']]);
  const script = await fs.readFile(started.script, 'utf8');
  assert.match(script, /"fp16":\s*true/, 'pinned script must force fp16 for GTX 1060');
  assert.match(script, /"r":\s*16/);
  assert.ok(!script.includes('{{DATASET}}') && !script.includes('{{PRESET}}'));

  const oomRunner = new TrainingRunner({
    workDir: root,
    spawnChild: () => {
      const child = fakeChild();
      queueMicrotask(() => {
        child.stderr.emit('data', 'torch.cuda.OutOfMemoryError: CUDA out of memory\n');
        child.emit('exit', 1);
      });
      return child;
    }
  });
  await oomRunner.start({ datasetId: 'ds-1', datasetPath: path.join(root, 'ds.jsonl'), sampleCount: 42, approved: true });
  const oomStatus = oomRunner.status();
  assert.equal(oomStatus.state, 'error');
  assert.equal(oomStatus.oom, true);
  assert.equal(oomStatus.oom_advice.length, 4);
  assert.match(oomStatus.error ?? '', /OutOfMemoryError|exited with code/);

  let killed = null;
  const stopper = new TrainingRunner({
    workDir: root,
    spawnChild: () => {
      const child = fakeChild();
      child.kill = () => {
        killed = true;
        child.emit('exit', null);
        return true;
      };
      return child;
    }
  });
  await stopper.start({ datasetId: 'ds-1', datasetPath: path.join(root, 'ds.jsonl'), sampleCount: 42, approved: true });
  assert.deepEqual(stopper.stop(), { stopped: true });
  assert.equal(killed, true);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(stopper.status().state, 'error');

  const ckDir = path.join(root, 'job-ck', 'checkpoints');
  for (const [name, loss] of [['checkpoint-100', 0.9], ['checkpoint-200', 0.5], ['checkpoint-300', 0.7], ['checkpoint-400', null]]) {
    await fs.mkdir(path.join(ckDir, name), { recursive: true });
    const payload = loss === null ? {} : { log_history: [{ eval_loss: loss }] };
    await fs.writeFile(path.join(ckDir, name, 'trainer_state.json'), JSON.stringify(payload));
  }
  const best = await new TrainingRunner({ workDir: root }).checkpoints('job-ck');
  assert.deepEqual(best.map(entry => entry.name), ['checkpoint-200', 'checkpoint-300', 'checkpoint-100']);
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('training-runner tests passed');
