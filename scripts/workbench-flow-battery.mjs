#!/usr/bin/env node
/**
 * Smart workbench flow battery — verifies orchestrator state machine wiring.
 */
import { readFileSync } from 'node:fs';

let pass = 0;
let fail = 0;
const total = 7;

function probe(name, fn) {
  const ok = fn();
  if (ok) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}`); }
}

const app = readFileSync('app.js', 'utf8');
const has = (pattern) => new RegExp(pattern).test(app);

probe('describe-box', () => has('describe-input') && has('describe-form'));
probe('plan-button', () => has('plan-btn'));
probe('send-describe-fn', () => has('sendDescribe'));
probe('plan-and-build-fn', () => has('planAndBuild'));
probe('agent-start-api', () => has('api/agent/start'));
probe('workflow-plan-api', () => has('api/workflow/plan'));
probe('workflow-apply-api', () => has('api/workflow/apply'));

console.log(`\nBATTERY: ${pass}/${total} passed`);
process.exit(fail > 0 ? 1 : 0);
