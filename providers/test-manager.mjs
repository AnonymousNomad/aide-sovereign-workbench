import assert from 'node:assert/strict';
import { ProviderManager } from './manager.mjs';

const originalOpenAiKey = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;

try {
  const manager = new ProviderManager('providers/manifest.json');
  await manager.load();

  assert.equal(manager.list().length, 5);
  assert.equal(
    manager.list().find(provider => provider.id === 'local-openai-compatible').configured,
    true
  );

  await assert.rejects(manager.chat('openai', []), /OPENAI_API_KEY/);

  console.log('provider manager test passed');
} finally {
  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
}
