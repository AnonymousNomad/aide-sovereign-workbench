#!/usr/bin/env node
/**
 * Diff repair battery — verifies SEARCH/REPLACE parser tolerance:
 * exact match, loose match, fence repair, marker normalization.
 */
import { parseSearchReplaceBlocks, applySearchReplace } from '../node/src/services/agent-tools.mjs';
// Note: import path is relative to CWD, not to this file

let pass = 0;
let fail = 0;
const total = 7;

function probe(name, fn) {
  try {
    const ok = fn();
    if (ok) { pass++; console.log(`PASS ${name}`); }
    else { fail++; console.log(`FAIL ${name}`); }
  } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`); }
}

// 1. Exact match
probe('exact-match', () => {
  const blocks = parseSearchReplaceBlocks('<<<<<<< SEARCH\nfoo\n=======\nbar\n>>>>>>> REPLACE\n');
  const { content } = applySearchReplace('foo', blocks);
  return content === 'bar';
});

// 2. Loose match (trailing whitespace)
probe('loose-match-trailing-ws', () => {
  const blocks = parseSearchReplaceBlocks('<<<<<<< SEARCH\nfoo  \n=======\nbar\n>>>>>>> REPLACE\n');
  const { content } = applySearchReplace('foo', blocks);
  return content === 'bar';
});

// 3. Fence repair (3-char fences instead of 7)
probe('fence-repair-3char', () => {
  const blocks = parseSearchReplaceBlocks('<<< SEARCH\nfoo\n===\nbar\n>>> REPLACE\n');
  const { content } = applySearchReplace('foo', blocks);
  return content === 'bar';
});

// 4. Marker normalization (extra spaces)
probe('marker-normalization', () => {
  const blocks = parseSearchReplaceBlocks('<<<<<<<   SEARCH\nfoo\n=======\nbar\n>>>>>>>   REPLACE\n');
  const { content } = applySearchReplace('foo', blocks);
  return content === 'bar';
});

// 5. Missing trailing newline on REPLACE
probe('missing-trailing-newline', () => {
  const blocks = parseSearchReplaceBlocks('<<<<<<< SEARCH\nfoo\n=======\nbar\n>>>>>>> REPLACE');
  const { content } = applySearchReplace('foo', blocks);
  return content === 'bar';
});

// 6. Multiple blocks
probe('multiple-blocks', () => {
  const input = '<<<<<<< SEARCH\nfoo\n=======\nbar\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nbaz\n=======\nqux\n>>>>>>> REPLACE\n';
  const blocks = parseSearchReplaceBlocks(input);
  const { content } = applySearchReplace('foo\nbaz', blocks);
  return content === 'bar\nqux';
});

// 7. Empty search throws
probe('empty-search-throws', () => {
  try {
    const blocks = parseSearchReplaceBlocks('<<<<<<< SEARCH\n\n=======\nbar\n>>>>>>> REPLACE\n');
    applySearchReplace('test', blocks);
    return false;
  } catch (e) {
    return e.message.includes('empty SEARCH');
  }
});

console.log(`\nBATTERY: ${pass}/${total} passed`);
process.exit(fail > 0 ? 1 : 0);
