#!/usr/bin/env node
import { runVeritasCli } from '../harness/run-veritas.mjs';

try {
  process.exitCode = await runVeritasCli();
} catch (error) {
  console.error(`veritas: ${error.message}`);
  process.exitCode = 2;
}
