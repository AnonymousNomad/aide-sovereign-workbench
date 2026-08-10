import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVeritasChecks } from './checks.mjs';

const root = path.resolve(process.argv[2] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const result = await runVeritasChecks({ workspace: root });
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
