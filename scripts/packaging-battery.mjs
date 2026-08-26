#!/usr/bin/env node
/**
 * Packaging battery — verifies Rust toolchain, Tauri config, and build readiness.
 * NOTE: Full cargo build requires MSVC Build Tools (admin install). This battery
 * verifies everything EXCEPT the actual compilation.
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

let pass = 0;
let fail = 0;
const total = 7;

function probe(name, fn) {
  try {
    const ok = fn();
    if (ok) { pass++; console.log(`PASS ${name}`); }
    else { fail++; console.log(`FAIL ${name}`); }
  } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`); }
}

const PATH = `${process.env.USERPROFILE}\\.cargo\\bin;${process.env.USERPROFILE}\\.rustup\\toolchains\\stable-x86_64-pc-windows-msvc\\bin;${process.env.PATH}`;
const ENV = { ...process.env, PATH };

probe('rust-toolchain', () => {
  const out = execSync('rustc --version', { encoding: 'utf8', timeout: 10000, env: ENV });
  return out.includes('1.98.0');
});

probe('cargo-installed', () => {
  const out = execSync('cargo --version', { encoding: 'utf8', timeout: 10000, env: ENV });
  return out.includes('1.98.0');
});

probe('msvc-toolchain-active', () => {
  const out = execSync('rustup show', { encoding: 'utf8', timeout: 10000, env: ENV });
  return out.includes('stable-x86_64-pc-windows-msvc');
});

probe('tauri-conf-valid', () => {
  const conf = JSON.parse(readFileSync('desktop/tauri.conf.json', 'utf8'));
  return conf.productName !== undefined && conf.build.frontendDist !== undefined;
});

probe('cargo-tauri-dep', () => {
  const cargo = readFileSync('desktop/Cargo.toml', 'utf8');
  return cargo.includes('tauri') && cargo.includes('tauri-build');
});

probe('frontend-build-script', () => existsSync('desktop/prepare.mjs'));

probe('tauri-main-rs', () => existsSync('desktop/src/main.rs'));

console.log(`\nBATTERY: ${pass}/${total} passed`);
console.log('NOTE: cargo check/build requires MSVC Build Tools (admin install).');
process.exit(fail > 0 ? 1 : 0);
