import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';

export async function sha256File(file, cache = null) {
  const stat = await fs.stat(file);
  const cached = cache?.get(file);
  if (cached?.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.hash;
  const digest = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('data', chunk => digest.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const hash = digest.digest('hex');
  cache?.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, hash });
  return hash;
}

export async function verifySha256(file, expected, cache = null) {
  try {
    const actual = await sha256File(file, cache);
    return {
      status: actual === String(expected).toLowerCase() ? 'verified' : 'checksum-mismatch',
      expected: String(expected).toLowerCase(),
      actual
    };
  } catch {
    return { status: 'missing', expected: String(expected).toLowerCase(), actual: null };
  }
}
