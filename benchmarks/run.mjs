import { promises as fs } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || process.cwd());
const suite = JSON.parse(await fs.readFile(path.join(root, 'benchmarks/manifest.json'), 'utf8'));
const models = JSON.parse(await fs.readFile(path.join(root, 'models/manifest.json'), 'utf8')).models;
const dryRun = process.argv.includes('--dry-run');

function check(task, text) {
  if (task.id === 'code-function') return /function\s+add|const\s+add|=>/.test(text) && /number/.test(text);
  if (task.id === 'unified-diff') return /^diff --git\s/m.test(text) && !/^```/m.test(text);
  if (task.id === 'plan') return /1\.|2\.|3\./.test(text);
  return false;
}

const rows = [];
for (const model of models.filter(item => suite.models.includes(item.id))) {
  for (const task of suite.tasks) {
    const row = { model: model.id, task: task.id, status: 'unavailable', passed: false };
    if (!dryRun) {
      try {
        const response = await fetch(`${model.endpoint}/chat/completions`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ model: model.model, messages: [{ role: 'user', content: task.prompt }], temperature: 0.1, max_tokens: 180 }) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const content = (await response.json()).choices?.[0]?.message?.content || '';
        row.status = 'measured'; row.passed = check(task, content); row.output_bytes = Buffer.byteLength(content);
      } catch (error) { row.error = error.message; }
    }
    rows.push(row);
  }
}
const result = { suite: suite.suite, mode: dryRun ? 'dry-run' : 'live', rows, measured_models: [...new Set(rows.filter(row => row.status === 'measured').map(row => row.model))] };
console.log(JSON.stringify(result, null, 2));
