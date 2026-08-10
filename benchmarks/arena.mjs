import { promises as fs } from 'node:fs';
import path from 'node:path';
const file = process.argv[2] || path.join(process.cwd(), 'benchmarks/live-results-2026-08-10.json');
const data = JSON.parse(await fs.readFile(file, 'utf8'));
const ranking = data.results.map(row => ({ model: row.model, score: row.score, failed: row.failed })).sort((a, b) => b.score - a.score);
console.log(JSON.stringify({ suite: data.suite, ranking, winner: ranking[0] || null, rule: 'Winner is benchmark-local only; never infer general intelligence from this smoke suite.' }, null, 2));
