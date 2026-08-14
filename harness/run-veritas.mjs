import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runVeritasChecks } from './checks.mjs';
import { evaluateExecution, renderVeritasReport, THRESHOLDS } from './veritas.mjs';

const DEFAULT_WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseVeritasArgs(args = []) {
  const options = {
    format: 'json',
    taskClass: 'code-change',
    workspace: DEFAULT_WORKSPACE,
    output: null,
    help: false
  };
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--report') options.format = 'report';
    else if (arg === '--json') options.format = 'json';
    else if (arg === '--task-class') {
      options.taskClass = readValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith('--task-class=')) {
      options.taskClass = arg.slice('--task-class='.length);
    } else if (arg === '--workspace') {
      options.workspace = readValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith('--workspace=')) {
      options.workspace = arg.slice('--workspace='.length);
    } else if (arg === '--output') {
      options.output = readValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.output = arg.slice('--output='.length);
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > 1) throw new Error('only one workspace path may be provided');
  if (positional.length === 1) options.workspace = positional[0];
  if (!Object.hasOwn(THRESHOLDS, options.taskClass)) throw new Error(`unknown task class: ${options.taskClass}`);

  return {
    ...options,
    workspace: path.resolve(options.workspace),
    output: options.output ? path.resolve(options.output) : null
  };
}

export function renderHelp() {
  const classes = Object.keys(THRESHOLDS).join(', ');
  return [
    'Usage: npm run veritas -- [workspace] [options]',
    '',
    'Options:',
    '  --report                 Print a human-readable Veritas report',
    '  --json                   Print machine-readable JSON (default)',
    '  --task-class <class>     Set evidence threshold class',
    '  --workspace <path>       Workspace to verify',
    '  --output <path>          Write the rendered output to a file',
    '  --help                   Show this help',
    '',
    `Task classes: ${classes}`
  ].join('\n');
}

export async function runVeritasCli(args = process.argv.slice(2), io = console) {
  const options = parseVeritasArgs(args);
  if (options.help) {
    io.log(renderHelp());
    return 0;
  }

  const result = await runVeritasChecks({ workspace: options.workspace });
  const veritas = evaluateExecution({ taskClass: options.taskClass, execution: result });
  const payload = options.format === 'report'
    ? renderVeritasReport({ taskClass: options.taskClass, veritas, execution: result })
    : JSON.stringify({ ...result, veritas }, null, 2);

  if (options.output) {
    await fs.mkdir(path.dirname(options.output), { recursive: true });
    await fs.writeFile(options.output, `${payload}\n`, 'utf8');
  } else {
    io.log(payload);
  }

  return result.passed ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runVeritasCli();
  } catch (error) {
    console.error(`veritas: ${error.message}`);
    process.exitCode = 2;
  }
}
