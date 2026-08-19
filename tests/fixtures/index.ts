import type { FileReadResponseT, FileWriteResponseT } from '../../common/contracts/file.ts';
import type { HealthResponseT } from '../../common/contracts/health.ts';
import type { WorkspaceListResponseT } from '../../common/contracts/workspace.ts';
import type { SearchResponseT, SearchReplaceResponseT } from '../../common/contracts/search.ts';
import type { SessionFileT } from '../../common/contracts/session.ts';

export const healthFixtures = {
  healthy: {
    version: 'test',
    uptimeMs: 1234,
    workspace: 'E:\\aide-sovereign-workbench',
    freeMemoryMB: 5120
  } satisfies HealthResponseT
};

export const fileReadFixtures = {
  readNormal: {
    path: 'src/a.ts',
    content: 'export const a = 1;\n',
    too_large: false,
    size: 22
  } satisfies FileReadResponseT,
  readTooLarge: {
    path: 'big.bin',
    content: null,
    too_large: true,
    size: 1560002
  } satisfies FileReadResponseT
};

export const fileWriteFixtures = {
  writeNormal: {
    path: 'src/a.ts',
    bytes: 22
  } satisfies FileWriteResponseT
};

export const workspaceListFixtures = {
  listNormal: {
    workspace: 'E:\\aide-sovereign-workbench',
    entries: [
      { name: 'app.js', kind: 'file' },
      { name: 'daemon', kind: 'directory' }
    ]
  } satisfies WorkspaceListResponseT
};

export const searchFixtures = {
  noMatches: {
    query: 'nothing-here',
    total: 0,
    regex: false,
    caseInsensitive: false,
    wholeWord: false,
    fileMask: '',
    results: []
  } satisfies SearchResponseT,
  withMatches: {
    query: 'monaco',
    total: 3,
    regex: false,
    caseInsensitive: true,
    wholeWord: false,
    fileMask: '',
    results: [
      { path: 'browser/src/main.ts', hits: [{ line: 1, text: 'import monaco from ...' }, { line: 5, text: 'monaco.editor.create' }] },
      { path: 'package.json', hits: [{ line: 47, text: '"monaco-editor": "^0.56.0"' }] }
    ]
  } satisfies SearchResponseT
};

export const searchReplaceFixtures = {
  replaced: {
    files_changed: 2,
    occurrences: 3
  } satisfies SearchReplaceResponseT
};

export const sessionFixtures = {
  empty: {
    version: 1,
    tabs: [],
    splits: ['g1']
  } satisfies SessionFileT,
  withSplits: {
    version: 1,
    activeTab: 'file:///package.json',
    tabs: [
      { uri: 'file:///package.json', splitId: 'g1', dirty: false },
      { uri: 'file:///browser/src/main.ts', splitId: 'g2', dirty: true }
    ],
    splits: ['g1', 'g2']
  } satisfies SessionFileT
};