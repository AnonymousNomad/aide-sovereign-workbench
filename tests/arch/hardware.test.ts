import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeHardware, clearHardwareCache } from '../../node/src/services/hardware.ts';

test('hardware probe reports real machine facts', async () => {
  clearHardwareCache();
  const info = await probeHardware();
  assert.ok(info.totalRamBytes > 0, 'total RAM must be positive');
  assert.ok(info.freeRamBytes > 0, 'free RAM must be positive');
  assert.ok(info.freeRamBytes <= info.totalRamBytes);
  assert.ok(info.logicalCpus >= 1);
  assert.ok(info.vramBytes >= 0);
  assert.ok(['nvidia-smi', 'none'].includes(info.vramSource));
});

test('hardware probe caches for 30 seconds', async () => {
  clearHardwareCache();
  const first = await probeHardware();
  const second = await probeHardware();
  assert.deepEqual(first, second);
});