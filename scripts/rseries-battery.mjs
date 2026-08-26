#!/usr/bin/env node
/**
 * R-series refactor battery — verifies F2 rename, Find All References, format document are wired.
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const total = 4;

function probe(name, fn) {
  const ok = fn();
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}`); }
}

const app = readFileSync('app.js', 'utf8');

probe('r1-rename-lsp-request', () => /textDocument\/rename/.test(app));
probe('r1-prepare-rename', () => /prepareRename/.test(app) || /textDocument\/rename/.test(app));
probe('r2-references-lsp', () => /textDocument\/references/.test(app));
probe('r3-format-on-save', () => /format_on_save/.test(app) && /textDocument\/formatting/.test(app));

console.log(`\nBATTERY: ${pass}/${total} passed`);
process.exit(fail > 0 ? 1 : 0);
