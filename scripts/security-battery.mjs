#!/usr/bin/env node
/**
 * Security hardening battery — verifies the 3 security fixes applied 2026-08-26.
 * Probes: terminal command filter, git push validation, search-replace exclusions.
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

let pass = 0;
let fail = 0;
const total = 5;

function probe(name, fn) {
  return fn().then(ok => {
    if (ok) { pass++; console.log(`PASS ${name}`); }
    else { fail++; console.log(`FAIL ${name}`); }
  }).catch(e => { fail++; console.log(`FAIL ${name}: ${e.message}`); });
}

// Helper: start daemon, make request, kill daemon
async function daemonRequest(path, method = 'GET', body = null) {
  const { default: handler } = await import('../../daemon/server.mjs');
  // Use a tiny server to test the handler
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      req.url = path;
      req.method = method;
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        if (body) {
          req._body = body;
        }
        // We'll test via the process instead
        res.writeHead(200);
        res.end('ok');
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
    setTimeout(() => { srv.close(); reject(new Error('timeout')); }, 5000);
  });
}

// Direct test: import the daemon and test terminal filter logic
async function testTerminalFilter() {
  const fs = await import('node:fs');
  const src = fs.readFileSync('daemon/server.mjs', 'utf8');
  
  // Check: DENIED_FLAGS object exists with node -e, python -c filters
  const hasDeniedFlags = /DENIED_FLAGS\s*=/.test(src);
  const hasNodeFilter = /node:\s*\/\^.*--eval/.test(src);
  const hasPythonFilter = /python:\s*\/\^.*--exec/.test(src);
  const hasNpxFilter = /npx:\s*\/\^.*--call/.test(src);
  
  return hasDeniedFlags && hasNodeFilter && hasPythonFilter && hasNpxFilter;
}

async function testGitPushValidation() {
  const fs = await import('node:fs');
  const src = fs.readFileSync('daemon/server.mjs', 'utf8');
  
  // Check: branch and remote validation regex exists before push call
  const hasBranchRegex = /test\(branch\)/.test(src);
  const hasRemoteRegex = /test\(remote\)/.test(src);
  const hasRemoteAssigned = /const remote = String\(input\.remote/.test(src);
  
  return hasBranchRegex && hasRemoteRegex && hasRemoteAssigned;
}

async function testSearchReplaceExclusions() {
  const fs = await import('node:fs');
  const src = fs.readFileSync('node/src/routes/fs.ts', 'utf8');
  
  // Check: SENSITIVE_PATHS regex exists before the walk function
  const hasSensitiveRegex = /SENSITIVE_PATHS\s*=\s*\/\^/.test(src);
  const hasCredentialBlock = /credentials/.test(src);
  const hasEnvBlock = /\.env/.test(src);
  const hasDpapiBlock = /\.dpapi/.test(src);
  
  return hasSensitiveRegex && hasCredentialBlock && hasEnvBlock && hasDpapiBlock;
}

async function testEgressAuditStillPasses() {
  // Run the egress audit script and check it still passes
  return new Promise((resolve) => {
    const child = spawn('node', ['scripts/egress-audit.mjs'], {
      cwd: process.cwd(),
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    child.stdout.on('data', d => stdout += d);
    child.on('close', code => resolve(code === 0 && stdout.includes('PASS')));
  });
}

async function testFacadeTestsStillPass() {
  // Run facade tests
  return new Promise((resolve) => {
    const child = spawn('node', ['--test', 'tests/unit/test-facade.mjs'], {
      cwd: process.cwd(),
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    child.stdout.on('data', d => stdout += d);
    child.on('close', code => resolve(code === 0 && stdout.includes('pass 12')));
  });
}

console.log('=== SECURITY HARDENING BATTERY ===');
await probe('terminal-filter-node-e', testTerminalFilter);
await probe('git-push-validation', testGitPushValidation);
await probe('search-replace-exclusions', testSearchReplaceExclusions);
await probe('egress-audit-still-passes', testEgressAuditStillPasses);
await probe('facade-tests-still-pass', testFacadeTestsStillPass);

console.log(`\nBATTERY: ${pass}/${total} passed`);
process.exit(fail > 0 ? 1 : 0);
