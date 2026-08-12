import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile('index.html', 'utf8');
const app = await readFile('app.js', 'utf8');
const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]));
const selectors = [...app.matchAll(/\$\(['"]#([^'"]+)['"]\)/g)].map(match => match[1]);
const generated = new Set(['save-file']);
const missing = [...new Set(selectors.filter(id => !ids.has(id) && !generated.has(id)))];
assert.deepEqual(missing, [], `app.js references missing UI ids: ${missing.join(', ')}`);
assert.match(html, /id="workspace-tree"/);
assert.match(html, /id="terminal-command"/);
assert.match(html, /id="assistant-mode"/);
assert.match(html, /id="plugin-list"/);
console.log(`UI contract audit passed (${ids.size} ids, ${new Set(selectors).size} referenced)`);
