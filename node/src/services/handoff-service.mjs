import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/
];

const USERNAME_PATTERN = /[A-Za-z]:\\Users\\[^\\\s"':]+/g;
const UNIX_HOME_PATTERN = /\/home\/[^/\s"']+/g;

export function scanForSecrets(text) {
  const found = [];
  for (const re of SECRET_PATTERNS) {
    const m = text.match(re);
    if (m) found.push(m[0].slice(0, 8) + '...');
  }
  return found;
}

function scrubPaths(text, homeDir) {
  let out = String(text);
  if (homeDir) out = out.split(homeDir).join('<home>');
  out = out.replace(USERNAME_PATTERN, '<user-dir>');
  out = out.replace(UNIX_HOME_PATTERN, '<home>');
  return out;
}

function distillBrief(messages, scrub) {
  const userMessages = messages.filter(m => m.role === 'user');
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  const task = userMessages.find(m => !m.content.startsWith('<tool_result') && !m.content.startsWith('ERROR:') && !m.content.startsWith('[mode notice]'));
  const decisions = [];
  const openQuestions = [];
  for (const message of assistantMessages.slice(-6)) {
    const sentences = message.content.split(/(?<=[.!?])\s+/).filter(s => s.length > 20 && s.length < 400);
    for (const sentence of sentences) {
      if (/^(I'll|I will|Let me|The plan|Using|Switched)/i.test(sentence)) decisions.push(sentence.trim());
      else if (/\?$|should I|do you want|unclear/i.test(sentence)) openQuestions.push(sentence.trim());
    }
  }
  return {
    task: task ? scrub(task.content.slice(0, 2000)) : '(no task message found)',
    decisions: [...new Set(decisions)].slice(0, 10).map(scrub),
    open_questions: [...new Set(openQuestions)].slice(0, 10).map(scrub),
    constraints: []
  };
}

export function createHandoffService(options) {
  const workspace = options.workspace;
  const generator = options.generator ?? 'aide-sovereign-workbench';
  const agentLoop = options.agentLoop ?? null;
  const handoffDir = path.join(workspace, '.aide', 'handoff');
  const importedDir = path.join(handoffDir, 'imported');

  function readBundleFile(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  function captureConversation(requestedId) {
    if (!agentLoop) return [];
    let sessionId = requestedId;
    if (!sessionId && typeof agentLoop.list === 'function') {
      const all = agentLoop.list();
      sessionId = all.length === 1 ? all[0].session_id : undefined;
    }
    if (!sessionId) return [];
    try {
      return agentLoop.transcriptOf(sessionId);
    } catch {
      return [];
    }
  }

  async function exportBundle(request = {}) {
    const tier = request.tier ?? 'brief';
    if ((tier === 'transcript' || tier === 'full') && request.confirmed !== true) {
      throw Object.assign(new Error('tier beyond brief requires confirmed: true'), { code: 'VALIDATION' });
    }
    const messages = captureConversation(request.session_id);
    const truncated = typeof request.up_to_message_index === 'number'
      ? messages.slice(0, request.up_to_message_index)
      : messages;

    const scrub = text => scrubPaths(text, os.homedir());

    if (tier !== 'brief') {
      const joined = truncated.map(m => m.content).join('\n').slice(0, 500_000);
      const secrets = scanForSecrets(joined);
      if (secrets.length > 0 && request.confirmed_secret_scan !== true) {
        throw Object.assign(new Error(`possible secrets detected (${secrets.join(', ')}) — strip them or pass confirmed_secret_scan`), { code: 'SECRET_DETECTED' });
      }
    }

    const id = crypto.randomUUID();
    const bundle = {
      version: 1,
      id,
      created_at: new Date().toISOString(),
      generator,
      tier,
      brief: distillBrief(truncated, scrub),
      distillation: 'auto'
    };
    if ((tier === 'transcript' || tier === 'full') && truncated.length > 0) {
      bundle.transcript = truncated.map(m => ({
        role: ['system', 'user', 'assistant', 'tool'].includes(m.role) ? m.role : 'user',
        content: scrub(m.content),
        tool_name: m.tool_name ?? null,
        ts: m.ts ?? null
      }));
    }

    fs.mkdirSync(handoffDir, { recursive: true });
    const filePath = path.join(handoffDir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(bundle, null, 1), 'utf8');
    return {
      bundle_id: id,
      tier,
      message_count: bundle.transcript?.length ?? 0,
      file_path: `.aide/handoff/${id}.json`,
      created_at: bundle.created_at
    };
  }

  function listBundles() {
    const out = [];
    for (const dir of [{ base: handoffDir, imported: false }, { base: importedDir, imported: true }]) {
      let entries = [];
      try {
        entries = fs.readdirSync(dir.base);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.endsWith('.json')) continue;
        const bundle = readBundleFile(path.join(dir.base, name));
        if (!bundle || bundle.version !== 1) continue;
        out.push({
          id: bundle.id,
          created_at: bundle.created_at,
          tier: bundle.tier,
          message_count: bundle.transcript?.length ?? 0,
          imported: dir.imported
        });
      }
    }
    out.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { bundles: out };
  }

  function getBundle(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Object.assign(new Error('invalid bundle id'), { code: 'VALIDATION' });
    for (const base of [handoffDir, importedDir]) {
      const candidate = readBundleFile(path.join(base, `${id}.json`));
      if (candidate) return candidate;
    }
    throw Object.assign(new Error(`no such bundle: ${id}`), { code: 'NOT_FOUND' });
  }

  function importBundle(rawBundle) {
    const receivedAt = new Date().toISOString();
    const contextId = `import-${crypto.randomUUID()}`;
    const bundle = { ...rawBundle, imported_at: receivedAt, context_id: contextId };
    fs.mkdirSync(importedDir, { recursive: true });
    fs.writeFileSync(path.join(importedDir, `${contextId}.json`), JSON.stringify(bundle, null, 1), 'utf8');
    return {
      context_id: contextId,
      message_count: Array.isArray(rawBundle?.transcript) ? rawBundle.transcript.length : 0,
      adopted_at: receivedAt
    };
  }

  return { exportBundle, listBundles, getBundle, importBundle };
}
