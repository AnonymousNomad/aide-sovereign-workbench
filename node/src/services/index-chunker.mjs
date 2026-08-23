import path from 'node:path';

export const CHUNK_BUDGET_CHARS = 1800;

const UNIT_ANCHORS = [
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b/,
  /^(?:export\s+)?(?:abstract\s+)?class\b/,
  /^(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?(?:\(|function\b)/,
  /^(?:export\s+)(?:type|interface|enum)\b/,
  /^(?:async\s+)?def\s+\w+/,
  /^class\s+\w+/,
  /^func\s+\w+/,
  /^fn\s+\w+/,
  /^public\s+[\w<>\[\]]+\s+\w+\s*\(/,
  /^#{1,3}\s+\S/,
];

function isUnitStart(line) {
  return UNIT_ANCHORS.some(re => re.test(line));
}

function nonWsLength(text) {
  return text.replace(/\s+/g, '').length;
}

function splitOversized(unitLines) {
  const pieces = [];
  let cur = [];
  for (const line of unitLines) {
    cur.push(line);
    if (line.trim() === '' && nonWsLength(cur.join('\n')) >= CHUNK_BUDGET_CHARS / 2) {
      pieces.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) {
    if (pieces.length > 0 && nonWsLength(cur.map(l => l).join('\n')) < CHUNK_BUDGET_CHARS / 4) {
      pieces[pieces.length - 1].push(...cur);
    } else {
      pieces.push(cur);
    }
  }
  return pieces;
}

export function chunkFile(relPath, content, { budget = CHUNK_BUDGET_CHARS } = {}) {
  const lines = String(content).split(/\r?\n/);
  const units = [];
  let cur = [];
  for (const line of lines) {
    if (cur.length > 0 && isUnitStart(line)) {
      units.push(cur);
      cur = [];
    }
    cur.push(line);
  }
  if (cur.length > 0) units.push(cur);

  const chunks = [];
  let pack = [];
  const flushPack = () => {
    if (pack.length === 0) return;
    const bodyLines = pack.flatMap(u => u.lines);
    const sig = pack[0].sig;
    chunks.push(makeChunk(relPath, bodyLines, sig, chunks.length));
    pack = [];
  };

  for (const unitLines of units) {
    while (unitLines.length > 0 && unitLines[0].trim() === '') unitLines.shift();
    if (unitLines.length === 0) continue;
    const sig = (unitLines.find(l => l.trim() !== '') ?? '').trim().slice(0, 120);
    const size = nonWsLength(unitLines.join('\n'));
    if (size > budget) {
      flushPack();
      for (const piece of splitOversized(unitLines)) {
        chunks.push(makeChunk(relPath, piece, sig, chunks.length));
      }
      continue;
    }
    const packedSize = pack.reduce((n, u) => n + u.size, 0);
    if (pack.length > 0 && packedSize + size > budget) flushPack();
    pack.push({ lines: unitLines, sig, size });
  }
  flushPack();

  return chunks.filter(c => nonWsLength(c.body) > 0 || c.header.length > 0);
}

function makeChunk(relPath, bodyLines, sig, index) {
  const body = bodyLines.join('\n');
  const header = `${relPath} | ${sig}`;
  return {
    id: `${relPath.split(path.sep).join('/')}#${index}`,
    path: relPath.split(path.sep).join('/'),
    line: 1,
    header,
    text: `${header}\n${body}`,
    body,
  };
}
