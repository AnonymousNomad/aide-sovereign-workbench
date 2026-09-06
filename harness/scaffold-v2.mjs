// Scaffold v2 (orchestrator-consumer) - takes a WorkflowBundle and
// produces a byte-deterministic system prompt. Pure function. No I/O, no
// LLM, no L0-injection side effects beyond reading the SOPs from disk.
//
// Layer discipline (per the chassis C3+C4 design):
// L0 - Universal SOPs (loaded from sops/ by the orchestrator's loader;
//      injected as the first block)
// L1 - Skill body (the primary skill's full body from the v1 envelope)
// L2 - workspace facts (active file, recent diff, last 20 lines of terminal)
// L3 - session overrides (operator-added rules; not yet implemented in
//      this slice - the orchestrator is read-only in the chassis MVP)
//
// What was L2 in the old scaffold (task SOP) is now the skill's own
// `sop` field. Skill envelope is self-contained. 4 layers, not 5.
//
// Budget enforcement: 80 lines / 2 KiB for small local models, 150 lines /
// 6 KiB for strong cloud. Overflow drops L3 fragments LAST-FIRST (here
// L3 is not yet present, so we drop L1 first, then L0).

import path from 'node:path';

export function assembleScaffold({
  workflowBundle,
  sopBodies = {},
  skillBody = '',
  workspaceFacts = '',
  smallModel = true
}) {
  if (!workflowBundle) throw new Error('workflowBundle is required');
  const lines = smallModel ? 80 : 150;
  const bytes = smallModel ? 2048 : 6144;

  const l0 = workflowBundle.sopNames
    .map(n => sopBodies[n])
    .filter(Boolean)
    .map((text, i) => `=== SOP ${i + 1} (L0) ===\n${text}`)
    .join('\n\n');

  const l1 = `=== SKILL: ${workflowBundle.primarySkill.name} v${workflowBundle.primarySkill.version} (L1) ===\n${skillBody}`;

  const l2 = workspaceFacts ? `=== WORKSPACE FACTS (L2) ===\n${workspaceFacts}` : '';

  const header = `[AIDE scaffold v2 | bundle:${workflowBundle.id} | skills:${workflowBundle.primarySkill.name} | helix:${workflowBundle.helix.enabled ? 'on' : 'off'} | ${bytes}b budget]`;

  let blocks = [
    { name: 'header', body: header },
    { name: 'L0', body: l0 },
    { name: 'L1', body: l1 },
    { name: 'L2', body: l2 }
  ];

  const measure = (bs) => bs.reduce((acc, b) => acc + b.body.length + 1, 0);
  const lineCount = (bs) => bs.reduce((acc, b) => acc + b.body.split('\n').length, 0);
  let current = blocks.slice();
  let bytes_used = measure(current);
  let lines_used = lineCount(current);
  const dropOrder = ['L2', 'L1', 'L0'];
  while ((bytes_used > bytes || lines_used > lines) && dropOrder.length > 0) {
    const name = dropOrder.shift();
    const before = current.length;
    current = current.filter(b => b.name !== name);
    if (current.length === before) continue;
    bytes_used = measure(current);
    lines_used = lineCount(current);
    if (current.length === 1) break;
  }

  // L0 is the chassis safety layer. A tiny model may not fit the full SOP
  // bodies, but an empty scaffold is worse than a compact guardrail: it would
  // silently turn the harness into a header-only prompt. Preserve the header
  // and a bounded prefix of L0 after the normal LAST-FIRST drops.
  if ((!current.some(b => b.name === 'L0') || bytes_used > bytes || lines_used > lines) && current.some(b => b.name === 'header')) {
    const header = current.find(b => b.name === 'header');
    const l0Block = blocks.find(b => b.name === 'L0');
    if (header && l0Block) {
      const headerBytes = header.body.length + 1;
      const headerLines = header.body.split('\n').length;
      const availableBytes = Math.max(0, bytes - headerBytes - 1);
      const availableLines = Math.max(1, lines - headerLines - 1);
      const marker = '\n[ L0 truncated to model budget ]';
      let body = l0Block.body;
      const maxChars = Math.max(0, availableBytes - marker.length);
      body = body.slice(0, maxChars) + (body.length > maxChars ? marker : '');
      const bodyLines = body.split('\n');
      if (bodyLines.length > availableLines) body = bodyLines.slice(0, availableLines).join('\n');
      current = [header, { name: 'L0', body }];
      bytes_used = measure(current);
      lines_used = lineCount(current);
      while ((bytes_used > bytes || lines_used > lines) && body.length > 0) {
        body = body.slice(0, Math.max(0, body.length - 16));
        current[1].body = body;
        bytes_used = measure(current);
        lines_used = lineCount(current);
      }
    }
  }

  const system = current.map(b => b.body).join('\n\n');
  return {
    system,
    dropped: blocks.filter(b => !current.find(c => c.name === b.name)).map(b => b.name),
    bytes: system.length,
    lines: system.split('\n').length,
    budget: { lines, bytes, bytes_used: system.length, lines_used: system.split('\n').length }
  };
}
