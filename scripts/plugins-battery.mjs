#!/usr/bin/env node
/**
 * Plugins surface v1 battery — verifies catalog, trust, contributions are wired.
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const total = 6;

function probe(name, fn) {
  const ok = fn();
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}`); }
}

const app = readFileSync('app.js', 'utf8');
const hasPlugin = (pattern) => new RegExp(pattern).test(app);

probe('plugin-contributions-defined', () => hasPlugin('PLUGIN_CONTRIBUTIONS'));
probe('plugin-trust-check', () => hasPlugin('pluginTrusted'));
probe('plugin-panel-loader', () => hasPlugin('loadPluginsPanel'));
probe('plugin-renderer', () => hasPlugin('renderPlugins'));
probe('plugin-presets-api', () => hasPlugin('api/plugins/presets'));
probe('plugin-trust-api', () => hasPlugin('api/plugins/trust'));

console.log(`\nBATTERY: ${pass}/${total} passed`);
process.exit(fail > 0 ? 1 : 0);
