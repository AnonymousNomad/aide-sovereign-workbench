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

  // ---- Effective-filesystem containment (mirrors the accepted eval-export /
  // modelhub / experts / workbench doctrine). Lexical joins are not
  // sufficient: every read, write, and enumeration must prove the effective
  // target stays inside the canonical handoff root, and link-like or
  // hard-linked bundle objects fail closed.
  function containmentFailure(message) {
    return Object.assign(new Error(`handoff storage: ${message}`), { code: 'VALIDATION' });
  }

  function isContained(candidateReal, rootReal) {
    return candidateReal === rootReal || candidateReal.startsWith(`${rootReal}${path.sep}`);
  }

  // Deepest-existing-ancestor real resolution: non-existent leaf segments
  // cannot contain a reparse object and are appended lexically after resolving.
  function realResolveSync(target) {
    const absolute = path.resolve(target);
    const missing = [];
    let current = absolute;
    for (;;) {
      try {
        const real = fs.realpathSync(current);
        return path.join(real, ...missing.reverse());
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        const parent = path.dirname(current);
        if (parent === current) throw error;
        missing.push(path.basename(current));
        current = parent;
      }
    }
  }

  function canonicalHandoffRootSync() {
    const workspaceReal = realResolveSync(workspace);
    const rootReal = realResolveSync(handoffDir);
    if (!isContained(rootReal, workspaceReal)) {
      throw containmentFailure('root resolves outside the canonical workspace');
    }
    const info = fs.lstatSync(handoffDir, { throwIfNoEntry: false });
    if (info && !info.isDirectory()) throw containmentFailure('root is not a directory');
    return { root: handoffDir, rootReal };
  }

  function canonicalImportedRootSync() {
    const parent = canonicalHandoffRootSync();
    const rootReal = realResolveSync(importedDir);
    if (!isContained(rootReal, parent.rootReal)) {
      throw containmentFailure('imported root resolves outside the handoff root');
    }
    const info = fs.lstatSync(importedDir, { throwIfNoEntry: false });
    if (info && !info.isDirectory()) throw containmentFailure('imported root is not a directory');
    return { root: importedDir, rootReal };
  }

  function assertContainedRealSync(rootReal, target, what) {
    const real = realResolveSync(target);
    if (!isContained(real, rootReal)) throw containmentFailure(`${what} resolves outside the storage root`);
  }

  // Existing bundle objects must be plain single-link regular files. Missing
  // leaves are proven via their deepest existing ancestor so a junctioned
  // parent can never redirect a read or write target.
  function assertSafeBundleObjectSync(file, rootReal, what) {
    const info = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!info) {
      assertContainedRealSync(rootReal, file, `${what} target`);
      return false;
    }
    if (info.isSymbolicLink()) throw containmentFailure(`refusing link-like ${what}`);
    if (!info.isFile()) throw containmentFailure(`refusing non-file ${what}`);
    if (typeof info.nlink === 'number' && info.nlink > 1) throw containmentFailure(`refusing hard-linked ${what}`);
    const real = fs.realpathSync(file);
    if (!isContained(real, rootReal)) throw containmentFailure(`${what} resolves outside the storage root`);
    return true;
  }

  function assertGeneratedBundleName(filename, what) {
    if (typeof filename !== 'string' || !/^(import-)?[0-9a-f-]{36}\.json$/.test(filename)) {
      throw containmentFailure(`refusing non-canonical ${what} name`);
    }
  }

  // Publication doctrine: fresh exclusive temp file in the verified parent,
  // full content, parent recheck, destination-object check, atomic rename. A
  // pre-existing link-like or hard-linked destination is never written
  // through, and failed temps are cleaned only at their proven-contained path.
  function publishBundleSync(rootReal, dir, filename, data, what) {
    assertGeneratedBundleName(filename, what);
    fs.mkdirSync(dir, { recursive: true });
    assertContainedRealSync(rootReal, dir, `${what} parent`);
    const finalPath = path.join(dir, filename);
    assertSafeBundleObjectSync(finalPath, rootReal, `${what} destination`);
    const tempPath = path.join(dir, `.handoff-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
    assertSafeBundleObjectSync(tempPath, rootReal, `${what} temp`);
    try {
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 1), { encoding: 'utf8', flag: 'wx' });
      assertContainedRealSync(rootReal, dir, `${what} parent`);
      assertSafeBundleObjectSync(finalPath, rootReal, `${what} destination`);
      fs.renameSync(tempPath, finalPath);
    } catch (error) {
      try { fs.rmSync(tempPath, { force: true }); } catch { /* contained cleanup best effort */ }
      throw error;
    }
  }

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

    const { root: bundleRoot, rootReal: bundleRootReal } = canonicalHandoffRootSync();
    publishBundleSync(bundleRootReal, bundleRoot, `${id}.json`, bundle, 'handoff bundle');
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
    for (const spec of [{ imported: false }, { imported: true }]) {
      const { root, rootReal } = spec.imported ? canonicalImportedRootSync() : canonicalHandoffRootSync();
      let entries = [];
      try {
        entries = fs.readdirSync(root);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.endsWith('.json')) continue;
        const file = path.join(root, name);
        try {
          if (!assertSafeBundleObjectSync(file, rootReal, 'bundle')) continue;
        } catch {
          // Never surface entries that cannot prove containment.
          continue;
        }
        const bundle = readBundleFile(file);
        if (!bundle || bundle.version !== 1) continue;
        out.push({
          id: bundle.id,
          created_at: bundle.created_at,
          tier: bundle.tier,
          message_count: bundle.transcript?.length ?? 0,
          imported: spec.imported
        });
      }
    }
    out.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { bundles: out };
  }

  function getBundle(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw Object.assign(new Error('invalid bundle id'), { code: 'VALIDATION' });
    for (const { root, rootReal } of [canonicalHandoffRootSync(), canonicalImportedRootSync()]) {
      const file = path.join(root, `${id}.json`);
      if (!assertSafeBundleObjectSync(file, rootReal, 'bundle')) continue;
      const candidate = readBundleFile(file);
      if (candidate) return candidate;
    }
    throw Object.assign(new Error(`no such bundle: ${id}`), { code: 'NOT_FOUND' });
  }

  function importBundle(rawBundle) {
    const receivedAt = new Date().toISOString();
    const contextId = `import-${crypto.randomUUID()}`;
    const bundle = { ...rawBundle, imported_at: receivedAt, context_id: contextId };
    const { root, rootReal } = canonicalImportedRootSync();
    publishBundleSync(rootReal, root, `${contextId}.json`, bundle, 'imported bundle');
    return {
      context_id: contextId,
      message_count: Array.isArray(rawBundle?.transcript) ? rawBundle.transcript.length : 0,
      adopted_at: receivedAt
    };
  }

  return { exportBundle, listBundles, getBundle, importBundle };
}
