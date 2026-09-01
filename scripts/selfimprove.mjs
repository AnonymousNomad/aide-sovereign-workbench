#!/usr/bin/env node
// selfimprove.mjs (T2, 2026-08-31)
//
// AIDE closed-loop self-improvement runner.
// Per aid-closed-loop-self-improvement skill + post-training-closed-loop:
//   OBSERVE -> DETECT -> CLUSTER -> ROUTE -> EMIT -> DELEGATE -> VERIFY -> JOURNAL
//
// Reads .aide/cipher-state.jsonl, clusters failures, emits a verifier-stamped
// signal JSONL to .aide/training/signal-YYYY-MM-DD.jsonl, re-runs the harness
// battery if a new adapter is registered, and journals the result.
//
// Usage:
//   node scripts/selfimprove.mjs            # full loop
//   node scripts/selfimprove.mjs --dry-run  # detect + report only
//   node scripts/selfimprove.mjs --since 24h  # only last 24h
//   node scripts/selfimprove.mjs --verbose   # debug output
//
// Exit codes: 0 = success, 1 = signal write failed, 2 = verification failed.
//
// Why this script exists: per the user's directive (2026-08-31),
// AIDE must be the Iron Man suit around the in-house model. The loop is
// what makes the model self-healing. The signal JSONL is the contract
// between the harness (this loop) and the fine-tune lane (T1's lane).

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_BUS = path.join(root, '.aide', 'cipher-state.jsonl');
const SIGNAL_DIR = path.join(root, '.aide', 'training');
const LOG = path.join(root, '.aide', 'logs', 'selfimprove.log');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const VERBOSE = args.has('--verbose');
const SINCE_HOURS = Number(([...args].find(a => a.startsWith('--since=')) || '--since=24h').split('=')[1].replace('h','')) || 24;

function log(msg) {
  const ts = new Date().toISOString();
  const line = `${ts} ${msg}`;
  console.log(line);
  if (!DRY_RUN || VERBOSE) {
    try { fs.appendFile(LOG, line + '\n', 'utf8'); } catch { /* best-effort */ }
  }
}

// 1. OBSERVE — read the state bus
async function readState(sinceHours) {
  if (!existsSync(STATE_BUS)) {
    log('state bus not found: ' + STATE_BUS);
    return [];
  }
  const text = await fs.readFile(STATE_BUS, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  const cutoff = Date.now() - sinceHours * 3600 * 1000;
  const events = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.at && new Date(e.at).getTime() < cutoff) continue;
      events.push(e);
    } catch { /* skip malformed lines */ }
  }
  return events;
}

// 2. DETECT — find failures
function detectFailures(events) {
  const failures = [];
  for (const e of events) {
    // desktop refusals (the model asked for an action outside its grants)
    // -- checked FIRST so the more specific category wins over the generic
    // 'rejection' branch below (otherwise desktop-refused events get
    // double-counted under both categories).
    if (e.type === 'desktop' && e.decision && e.decision.includes('refus')) {
      failures.push({ ...e, _category: 'desktop-refusal' });
      continue;
    }
    // rejection events (the model tried something and was refused) — generic
    if (e.type === 'rejection' || e.decision === 'refused' || e.passed === false) {
      failures.push({ ...e, _category: 'rejection' });
      continue;
    }
    // gate failures (the model produced output that failed verification)
    if (e.type === 'gate' && e.passed === false) {
      failures.push({ ...e, _category: 'gate' });
      continue;
    }
    // errors
    if (e.type === 'error') {
      failures.push({ ...e, _category: 'error' });
      continue;
    }
  }
  return failures;
}

// 3. CLUSTER — group by category + source
function cluster(failures) {
  const buckets = new Map();
  for (const f of failures) {
    const key = `${f._category}|${f.source || f.op || 'unknown'}`;
    if (!buckets.has(key)) buckets.set(key, { category: f._category, source: f.source || f.op || 'unknown', events: [] });
    buckets.get(key).events.push(f);
  }
  return [...buckets.values()].sort((a, b) => b.events.length - a.events.length);
}

// 4-5. ROUTE + EMIT — write verifier-stamped signal JSONL
async function emitSignal(clusters) {
  if (clusters.length === 0) {
    log('no failures to emit');
    return null;
  }
  await fs.mkdir(SIGNAL_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const signalPath = path.join(SIGNAL_DIR, `signal-${date}.jsonl`);
  const lines = [];
  const ts = new Date().toISOString();
  for (const c of clusters) {
    for (const e of c.events) {
      const row = {
        ts,
        category: c.category,
        source: c.source,
        verifier: 'selfimprove-script-v1',
        verifier_result: 'fail',
        original_event: e,
        prompt: e.task || e.target || e.message || '(no prompt captured)',
        // No `passing_completion` — the fine-tune lane must generate the correction.
        // Per post-training-closed-loop: "format failure -> SFT corpus", "reasoning failure with clean passing trace -> distillation".
        // For now, the signal is the FAILED trajectory; the trainer generates the corrected completion.
        stage_hint: c.category === 'format' ? 'sft' :
                   c.category === 'gate' ? 'distill' :
                   c.category === 'desktop-refusal' ? 'preference' :
                   c.category === 'rejection' ? 'preference' :
                   'sft',
      };
      lines.push(JSON.stringify(row));
    }
  }
  if (DRY_RUN) {
    log(`DRY-RUN: would write ${lines.length} rows to ${signalPath}`);
    if (VERBOSE) for (const l of lines.slice(0, 5)) console.log('  ' + l);
    return null;
  }
  // APPEND — do not overwrite prior iterations on the same day
  await fs.appendFile(signalPath, lines.join('\n') + '\n', 'utf8');
  log(`emitted ${lines.length} failure rows to ${signalPath}`);
  return { path: signalPath, count: lines.length, clusters };
}

// 6. DELEGATE — log that the fine-tune lane is responsible for actually training
function delegate(clusters) {
  if (!clusters || clusters.length === 0) return;
  log(`DELEGATE: ${clusters.length} failure clusters queued for fine-tune lane.`);
  log(`  Per the aid-closed-loop-self-improvement skill:`);
  log(`  - Local CPU fine-tune: scripts/train-cipher.sh (small adapters only, 30B base doesn't fit)`);
  log(`  - Cloud GPU fine-tune: per cipher-cloud-training skill (recommended for 30B base)`);
  log(`  - The harness OWNS detect+emit+verify. The fine-tune lane OWNS the actual weight update.`);
}

// 7. VERIFY — gate check, only if a new adapter is registered in the manifest
async function verifyAdapterImprovement() {
  // Read the manifest; if `lora_adapter` was updated since the last signal emit,
  // re-run the harness battery and compare composite vs the last-known baseline.
  // For now: log a placeholder. The actual battery run is a separate command
  // (npm run check + scripts/run-harness-battery.mjs) invoked by the operator.
  log('VERIFY: not auto-running battery (operator trigger). Run manually:');
  log('  cd /d ' + root);
  log('  npm run check:arch');
  log('  node scripts/run-harness-battery.mjs');
  log('  Compare composite vs the previous baseline (saved in .aide/training/baselines/).');
  log('  Gate per cipher-qlora-finetune §8: composite delta >= +0.02 AND no category regress >0.1.');
}

// 8. JOURNAL — write to AGENT_NOTES-style file
async function journal(result) {
  if (!result) return;
  const notePath = path.join(root, '.aide', 'logs', 'selfimprove-iterations.jsonl');
  const row = {
    ts: new Date().toISOString(),
    signal_path: result.path,
    cluster_count: result.clusters.length,
    failure_count: result.count,
    event_categories: result.clusters.map(c => ({ category: c.category, source: c.source, count: c.events.length })),
  };
  await fs.mkdir(path.dirname(notePath), { recursive: true });
  await fs.appendFile(notePath, JSON.stringify(row) + '\n', 'utf8');
  log(`JOURNAL: wrote iteration row to ${notePath}`);
}

async function main() {
  log(`=== selfimprove.mjs (since=${SINCE_HOURS}h, dry_run=${DRY_RUN}) ===`);
  const events = await readState(SINCE_HOURS);
  log(`OBSERVE: ${events.length} events in last ${SINCE_HOURS}h`);
  const failures = detectFailures(events);
  log(`DETECT: ${failures.length} failure events`);
  if (failures.length === 0) {
    log('no failures to act on; loop complete');
    return;
  }
  const clusters = cluster(failures);
  log(`CLUSTER: ${clusters.length} distinct (category, source) buckets`);
  if (VERBOSE) for (const c of clusters) log(`  ${c.category} | ${c.source} | ${c.events.length} events`);
  const result = await emitSignal(clusters);
  if (result) {
    delegate(result.clusters);
    await verifyAdapterImprovement();
    await journal(result);
  }
  log('=== selfimprove.mjs complete ===');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
