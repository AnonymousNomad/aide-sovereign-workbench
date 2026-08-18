import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Logger } from '../../node/src/services/logger.ts';

test('logger writes JSON lines', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-log-'));
  const file = path.join(dir, 'daemon.log');
  const logger = new Logger(file);
  logger.info('hello', { route: '/api/health' });
  logger.error('boom', { stack: 'x' });
  await logger.flush();
  const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]!) as { level: string; msg: string; route: string };
  assert.equal(first.level, 'info');
  assert.equal(first.msg, 'hello');
  assert.equal(first.route, '/api/health');
  await fs.rm(dir, { recursive: true, force: true });
});

test('logger rotates when the file exceeds maxBytes', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aide-log-'));
  const file = path.join(dir, 'daemon.log');
  const logger = new Logger(file, 200);
  for (let i = 0; i < 50; i++) logger.info('x'.repeat(40), { i });
  await logger.flush();
  const rotated = await fs.stat(`${file}.1`).catch(() => null);
  assert.ok(rotated, 'rotated .1 file must exist');
  const current = await fs.stat(file);
  assert.ok(current.size <= 200 + 512, `current file must stay small, was ${current.size}`);
  await fs.rm(dir, { recursive: true, force: true });
});