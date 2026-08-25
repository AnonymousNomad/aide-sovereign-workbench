import { promises as fs } from 'node:fs';
import path from 'node:path';

function passes(task, text) {
  if (task.id === 'code-function') return /function\s+add|const\s+add|=>/.test(text) && /number/.test(text);
  if (task.id === 'unified-diff') return /^diff --git\s/m.test(text) && /^---\s/m.test(text) && /^\+\+\+\s/m.test(text) && !/^```/m.test(text);
  if (task.id === 'plan') return /1\.|2\.|3\./.test(text);
  return false;
}

export class ArenaManager {
  constructor({ modelManager, manifestPath, suitePath } = {}) {
    this.modelManager = modelManager;
    this.manifestPath = manifestPath;
    this.suitePath = suitePath;
    this.running = false;
  }

  async run(approved) {
    if (approved !== true) throw new Error('explicit arena approval required');
    if (this.running) throw new Error('model arena is already running');
    this.running = true;
    try {
      const manifest = JSON.parse(await fs.readFile(this.manifestPath, 'utf8'));
      const suite = JSON.parse(await fs.readFile(this.suitePath, 'utf8'));
      const rows = [];
      for (const model of manifest.models.filter(item => suite.models.includes(item.id))) {
        try {
          await this.modelManager.start(model.id);
          await this.waitReady(model.endpoint);
          for (const task of suite.tasks) {
            const started = Date.now();
            const response = await fetch(`${model.endpoint}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.model, messages: [{ role: 'user', content: task.prompt }], temperature: 0.1, max_tokens: 180 }), signal: AbortSignal.timeout(30000) });
            const data = await response.json();
            const output = data.choices?.[0]?.message?.content || '';
            rows.push({ model: model.id, task: task.id, status: response.ok ? 'measured' : 'error', passed: response.ok && passes(task, output), latency_ms: Date.now() - started, output_bytes: Buffer.byteLength(output), error: response.ok ? undefined : data.error });
          }
        } finally { await this.modelManager.stop(model.id); }
      }
      const ranking = [...new Set(rows.map(row => row.model))].map(model => { const subset = rows.filter(row => row.model === model); return { model, score: subset.filter(row => row.passed).length / subset.length, latency_ms: Math.round(subset.reduce((sum, row) => sum + row.latency_ms, 0) / subset.length) }; }).sort((a, b) => b.score - a.score || a.latency_ms - b.latency_ms);
      return { suite: suite.suite, rows, ranking, winner: ranking[0] || null };
    } finally { this.running = false; }
  }

  async waitReady(endpoint) {
    for (let attempt = 0; attempt < 90; attempt += 1) {
      try { const response = await fetch(`${endpoint}/models`); if (response.ok) return; } catch { /* keep waiting */ }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('model runtime did not become ready');
  }
}
