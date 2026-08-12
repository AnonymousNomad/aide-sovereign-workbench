import assert from 'node:assert/strict';
import { ProviderManager } from './manager.mjs';
const manager = new ProviderManager('providers/manifest.json'); await manager.load();
assert.equal(manager.list().length, 5); assert.equal(manager.list().find(provider => provider.id === 'local-openai-compatible').configured, true); await assert.rejects(manager.chat('openai', []), /OPENAI_API_KEY/); console.log('provider manager test passed');
