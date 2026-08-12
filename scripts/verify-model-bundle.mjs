import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const manifest = JSON.parse(await readFile('models/manifest.json', 'utf8'));
const results = [];
for (const pack of manifest.packs) {
  if (!pack.file) continue;
  const file = path.join('models', pack.file);
  try { await access(file); } catch { results.push({ id: pack.id, status: 'missing', file }); continue; }
  const hash = await new Promise((resolve, reject) => { const digest = createHash('sha256'); const stream = createReadStream(file); stream.on('data', chunk => digest.update(chunk)); stream.on('end', () => resolve(digest.digest('hex'))); stream.on('error', reject); });
  results.push({ id: pack.id, status: hash === pack.sha256 ? 'verified' : 'checksum-mismatch', file, sha256: hash });
}
console.log(JSON.stringify({ bundle: results }, null, 2));
if (results.some(result => result.status !== 'verified')) process.exitCode = 1;
