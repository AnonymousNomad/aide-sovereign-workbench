import assert from 'node:assert/strict';
import { loadGrammar } from '../daemon/model-manager.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

{
  const g = loadGrammar('sr-proposal');
  assert.ok(g, 'sr-proposal grammar should load');
  assert.ok(g.includes('<<<<<<< SEARCH'), 'grammar should contain SEARCH marker');
  assert.ok(g.includes('======='), 'grammar should contain separator');
  assert.ok(g.includes('>>>>>>> REPLACE'), 'grammar should contain REPLACE marker');
  console.log('PASS grammar-load — sr-proposal loads and contains expected markers');
}

{
  const g = loadGrammar('nonexistent-grammar-xyz');
  assert.equal(g, null, 'nonexistent grammar should return null');
  console.log('PASS grammar-missing — nonexistent grammar returns null');
}

{
  const g = loadGrammar('sr-proposal');
  const g2 = loadGrammar('sr-proposal');
  assert.equal(g, g2, 'second load should return cached reference');
  console.log('PASS grammar-cache — repeated load returns same reference');
}

{
  const raw = readFileSync(join(root, 'grammar', 'sr-proposal.gbnf'), 'utf8');
  assert.ok(raw.length > 20, 'grammar file should have meaningful content');
  assert.ok(!raw.includes('\r'), 'grammar should use LF line endings');
  console.log('PASS grammar-file — raw file readable, LF endings');
}

{
  const chatBody = { model: 'test', messages: [{ role: 'user', content: 'hi' }], temperature: 0.5, max_tokens: 100 };
  const grammarName = 'sr-proposal';
  const g = loadGrammar(grammarName);
  if (g) chatBody.grammar = g;
  assert.ok(chatBody.grammar, 'grammar should be set on chat body when loaded');
  assert.ok(chatBody.grammar.includes('<<<<<<< SEARCH'), 'chat body grammar should contain SEARCH marker');
  assert.ok(chatBody.grammar.includes('======='), 'chat body grammar should contain separator');
  console.log('PASS grammar-passthrough — grammar attaches to chat request body');
}

console.log('\nGRAMMAR BATTERY: 5/5 passed');
