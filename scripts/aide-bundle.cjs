#!/usr/bin/env node
// aide-bundle.cjs (cline/T4, 2026-08-29)
//
// The 1-click approve flow for AIDE workflow bundles. Wraps the
// 5 /api/workbenches routes (list, detail, install, trust,
// uninstall) in a tiny CLI so a new user can approve + load a
// bundle with one command:
//
//   aide-bundle list
//   aide-bundle show sovereign-coder
//   aide-bundle install sovereign-coder --trust-offline
//   aide-bundle trust sovereign-coder filesystem
//   aide-bundle uninstall sovereign-coder
//
// Default AIDE host is http://127.0.0.1:4173. Override with
// AIDE_HOST env or --host flag.
//
// This is the shell-verb the user asked for ("the user has to do
// is approve load bundle"). The UI surface in the cockpit will
// wrap this same CLI.

const http = require('http');

const DEFAULT_HOST = process.env.AIDE_HOST || 'http://127.0.0.1:4173';

function parseArgs(argv) {
  const args = { command: argv[2], positional: [], flags: {} };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
      args.flags[key] = val;
      if (val !== 'true') i++;
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

function call(host, method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, host);
    const data = body ? JSON.stringify(body) : '';
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    };
    const req = http.request(opts, (r) => {
      let d = '';
      r.on('data', (c) => d += c);
      r.on('end', () => {
        try {
          resolve({ status: r.statusCode, body: JSON.parse(d) });
        } catch {
          resolve({ status: r.statusCode, body: d });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(data);
    req.end();
  });
}


function printWorkbench(w) {
  console.log(`  ${w.id} v${w.version} - ${w.name}`);
  console.log(`    installed: ${w.installed}, enabled: ${w.enabled}, validated: ${w.validated}`);
  if (w.plugins_count != null) console.log(`    plugins: ${w.plugins_count}, skills: ${w.skills_count}, mcp: ${w.mcp_count} (${w.online_mcp_count} online)`);
  if (w.issues && w.issues.length) console.log(`    ISSUES: ${JSON.stringify(w.issues)}`);
}

async function cmdList(host) {
  const r = await call(host, 'GET', '/api/workbenches');
  if (r.status !== 200) {
    console.error('FAIL', r.status, JSON.stringify(r.body).slice(0, 300));
    process.exit(1);
  }
  const wbs = r.body.data.workbenches;
  console.log(`${wbs.length} bundle(s) available:`);
  for (const w of wbs) printWorkbench(w);
}

async function cmdShow(host, id) {
  const r = await call(host, 'POST', '/api/workbenches/detail', { id });
  if (r.status !== 200) {
    console.error('FAIL', r.status, JSON.stringify(r.body).slice(0, 300));
    process.exit(1);
  }
  printWorkbench(r.body.data.workbench);
  console.log('\nFull JSON:');
  console.log(JSON.stringify(r.body.data, null, 2));
}

async function cmdInstall(host, id, flags) {
  const r = await call(host, 'POST', '/api/workbenches/install', { id });
  if (r.status !== 200) {
    console.error('FAIL', r.status, JSON.stringify(r.body).slice(0, 300));
    process.exit(1);
  }
  console.log(`Installed ${id} v${r.body.data.workbench.version}`);
  printWorkbench(r.body.data.workbench);
  if (flags['trust-offline'] === 'true' || flags['trust-offline'] === true) {
    const detail = r.body.data.workbench;
    const offlineMcp = (detail.mcp_servers || []).filter(s => s.offline !== false);
    console.log(`\nTrusting ${offlineMcp.length} offline MCP server(s)...`);
    for (const s of offlineMcp) {
      const tr = await call(host, 'POST', '/api/workbenches/trust', { id, server: s.name, trusted: true });
      console.log(`  ${s.name}: ${tr.status === 200 ? 'TRUSTED' : 'FAILED ' + tr.status}`);
    }
    console.log('\nOnline MCP servers were NOT auto-trusted (opt-in online doctrine).');
    console.log('To trust them: aide-bundle trust <id> <server>');
  }
}

async function cmdTrust(host, id, server) {
  const r = await call(host, 'POST', '/api/workbenches/trust', { id, server, trusted: true });
  if (r.status !== 200) {
    console.error('FAIL', r.status, JSON.stringify(r.body).slice(0, 300));
    process.exit(1);
  }
  console.log(`Trusted ${server} in ${id}. Bundle is now ${r.body.data.workbench.enabled ? 'ENABLED' : 'installed but not enabled (trust more servers).'}`);
}

async function cmdUninstall(host, id) {
  const r = await call(host, 'POST', '/api/workbenches/uninstall', { id });
  if (r.status !== 200) {
    console.error('FAIL', r.status, JSON.stringify(r.body).slice(0, 300));
    process.exit(1);
  }
  console.log(`Uninstalled ${id}.`);
}

function usage() {
  console.log('Usage: aide-bundle <command> [args]');
  console.log('');
  console.log('Commands:');
  console.log('  list                              List all available bundles');
  console.log('  show <id>                         Show full bundle details (JSON)');
  console.log('  install <id> [--trust-offline]    Install; with --trust-offline, also trust offline MCP servers');
  console.log('  trust <id> <server>               Trust one MCP server');
  console.log('  uninstall <id>                    Remove a bundle');
  console.log('');
  console.log('Examples:');
  console.log('  aide-bundle list');
  console.log('  aide-bundle show sovereign-coder');
  console.log('  aide-bundle install sovereign-coder --trust-offline');
  console.log('  aide-bundle trust sovereign-coder filesystem');
  console.log('  aide-bundle uninstall sovereign-coder');
  console.log('');
  console.log('Environment:');
  console.log('  AIDE_HOST   default http://127.0.0.1:4173');
  process.exit(2);
}

async function main() {
  const args = parseArgs(process.argv);
  const host = args.flags.host || DEFAULT_HOST;
  const cmd = args.command;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') usage();
  switch (cmd) {
    case 'list': return cmdList(host);
    case 'show': {
      const id = args.positional[0];
      if (!id) { console.error('usage: aide-bundle show <id>'); process.exit(2); }
      return cmdShow(host, id);
    }
    case 'install': {
      const id = args.positional[0];
      if (!id) { console.error('usage: aide-bundle install <id> [--trust-offline]'); process.exit(2); }
      return cmdInstall(host, id, args.flags);
    }
    case 'trust': {
      const id = args.positional[0];
      const server = args.positional[1];
      if (!id || !server) { console.error('usage: aide-bundle trust <id> <server>'); process.exit(2); }
      return cmdTrust(host, id, server);
    }
    case 'uninstall': {
      const id = args.positional[0];
      if (!id) { console.error('usage: aide-bundle uninstall <id>'); process.exit(2); }
      return cmdUninstall(host, id);
    }
    default:
      console.error(`unknown command: ${cmd}`);
      usage();
  }
}

main().catch((e) => {
  console.error('FATAL', e.message);
  process.exit(1);
});

