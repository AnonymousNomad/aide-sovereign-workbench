import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Envelope, fail, ok } from '../../common/errors.ts';
import { FileReadResponse } from '../../common/contracts/file.ts';
import { WorkspaceListResponse } from '../../common/contracts/workspace.ts';
import { fileReadFixtures, workspaceListFixtures } from '../fixtures/index.ts';

test('error envelope: fail() produces a valid envelope', () => {
  const envelope = fail('FORBIDDEN', 'path escaped workspace');
  assert.equal(Envelope.safeParse(envelope).success, true);
  assert.equal(envelope.ok, false);
  if (!envelope.ok) assert.equal(envelope.error.code, 'FORBIDDEN');
});

test('error envelope: strict() rejects unknown keys', () => {
  const envelope = fail('FORBIDDEN', 'path escaped workspace');
  const bad = { ...envelope, error: { ...envelope.error, extra: 1 } };
  assert.equal(Envelope.safeParse(bad).success, false);
});

test('error envelope: ok() produces a valid envelope', () => {
  const envelope = ok({ anything: true });
  assert.equal(Envelope.safeParse(envelope).success, true);
  assert.equal(envelope.ok, true);
});

test('file read contract accepts the verified too-large payload', () => {
  const parsed = FileReadResponse.safeParse(fileReadFixtures.readTooLarge);
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.content, null);
});

test('file read contract accepts the normal payload', () => {
  const parsed = FileReadResponse.safeParse(fileReadFixtures.readNormal);
  assert.equal(parsed.success, true);
});

test('file read contract rejects a payload missing size', () => {
  const parsed = FileReadResponse.safeParse({ path: 'a', content: 'x', too_large: false });
  assert.equal(parsed.success, false);
});

test('file read contract rejects unknown keys (strict)', () => {
  const parsed = FileReadResponse.safeParse({ ...fileReadFixtures.readNormal, extra: 1 });
  assert.equal(parsed.success, false);
});

test('workspace list contract accepts the fixture', () => {
  const parsed = WorkspaceListResponse.safeParse(workspaceListFixtures.listNormal);
  assert.equal(parsed.success, true);
});

test('workspace list contract rejects an unknown entry kind', () => {
  const parsed = WorkspaceListResponse.safeParse({
    ...workspaceListFixtures.listNormal,
    entries: [{ name: 'x', kind: 'link' }]
  });
  assert.equal(parsed.success, false);
});