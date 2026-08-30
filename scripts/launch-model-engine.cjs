// launch-model-engine.cjs (cline/T4, 2026-08-29)
//
// Launches the AIDE in-house model engine (llama-server.exe) on the
// specified port with the specified GGUF. Detached + unref so it
// survives the launching shell. Logs go to .aide/logs/<label>-{out,err}.log.
//
// Usage:
//   node scripts/launch-model-engine.cjs
//   PORT=8084 GGUF=path/to.gguf BACKEND=cuda node scripts/launch-model-engine.cjs
//
// Defaults: PORT=8084 (North-Mini-Code), GGUF=in-house symlink, BACKEND=vulkan
//
// This is the canonical way to bring up the model engine in
// development. The production installer (npm create aide) wraps
// this with model download + verify.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const AIDE = 'E:/aide-sovereign-workbench';
const LLAMA = 'E:/llama-cpp/llama-server.exe';
const DEFAULT_GGUF = path.join(AIDE, 'models', 'aide-house', 'North-Mini-Code-1.0-UD-Q2_K_XL.gguf');
const PORT = Number(process.env.PORT || 8084);
const GGUF = process.env.GGUF || DEFAULT_GGUF;
const BACKEND = process.env.BACKEND || 'vulkan';
const NGL = Number(process.env.NGL || 999);
const CTX = Number(process.env.CTX || 32768);
const LABEL = process.env.LABEL || 'north-engine';

const LOG_DIR = path.join(AIDE, '.aide', 'logs');
const OUT = fs.openSync(path.join(LOG_DIR, `${LABEL}-out.log`), 'a');
const ERR = fs.openSync(path.join(LOG_DIR, `${LABEL}-err.log`), 'a');

console.log('LAUNCHING:');
console.log(' binary:  ', LLAMA);
console.log(' gguf:    ', GGUF);
console.log(' port:    ', PORT);
console.log(' backend: ', BACKEND);
console.log(' ngl:     ', NGL);
console.log(' ctx:     ', CTX);
console.log(' label:   ', LABEL);

const args = [
  '-m', GGUF,
  '--port', String(PORT),
  '--host', '127.0.0.1',
  '-ngl', String(NGL),
  '-c', String(CTX),
  '-t', '8'
];

const child = spawn(LLAMA, args, {
  cwd: path.dirname(LLAMA),
  env: { ...process.env },
  stdio: ['ignore', OUT, ERR],
  detached: true,
  windowsHide: true
});
child.unref();
console.log('PID:', child.pid);
console.log('OUT_LOG:', path.join(LOG_DIR, `${LABEL}-out.log`));
console.log('ERR_LOG:', path.join(LOG_DIR, `${LABEL}-err.log`));

fs.writeFileSync(path.join(LOG_DIR, `${LABEL}.pid`), String(child.pid));
console.log('WROTE pid file');

setTimeout(() => process.exit(0), 1000);
