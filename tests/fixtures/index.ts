import type { FileReadResponseT, FileWriteResponseT } from '../../common/contracts/file.ts';
import type { HealthResponseT } from '../../common/contracts/health.ts';
import type { WorkspaceListResponseT } from '../../common/contracts/workspace.ts';
import type { SearchResponseT, SearchReplaceResponseT } from '../../common/contracts/search.ts';
import type { SessionFileT } from '../../common/contracts/session.ts';
import type { LspStatusResponseT, LspStartResponseT, LspOpenResponseT, LspCloseResponseT, LspChangeResponseT } from '../../common/contracts/lsp.ts';
import type { LogEventT, ModelStatusEventT, DiagnosticsEventT, TrainingProgressEventT } from '../../common/contracts/events.ts';

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

export const lspFixtures = {
  statusAvailable: {
    servers: [
      { languageId: 'typescript', name: 'TypeScript', status: 'available' },
      { languageId: 'javascript', name: 'JavaScript', status: 'available' }
    ]
  } satisfies LspStatusResponseT,
  statusRunning: {
    servers: [
      { languageId: 'typescript', name: 'TypeScript', status: 'running' },
      { languageId: 'javascript', name: 'JavaScript', status: 'available' }
    ]
  } satisfies LspStatusResponseT,
  startRunning: {
    languageId: 'typescript',
    status: 'running'
  } satisfies LspStartResponseT,
  openOpened: {
    opened: true
  } satisfies LspOpenResponseT,
  closeClosed: {
    closed: true
  } satisfies LspCloseResponseT,
  changeChanged: {
    changed: true
  } satisfies LspChangeResponseT
};

export const eventFixtures = {
  log: {
    ok: { level: 'info', message: 'request ok', method: 'GET', path: '/api/health', ms: 12 } satisfies LogEventT,
    warn: { level: 'warn', message: 'route not found', method: 'GET', path: '/api/nope', code: 'NOT_FOUND' } satisfies LogEventT,
    invalid: { level: 'bogus', message: 'x' } as unknown as LogEventT
  },
  model: {
    ok: { id: 'smollm2-360m', status: 'ready', detail: 'warmup done' } satisfies ModelStatusEventT,
    loading: { id: 'qwen-1.5b', status: 'loading' } satisfies ModelStatusEventT,
    invalid: { id: 'x', status: 'gone' } as unknown as ModelStatusEventT
  },
  diagnostics: {
    ok: {
      uri: 'file:///src/a.ts',
      markers: [
        { severity: 8, message: 'cannot find name "a"', startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 },
        { severity: 2, message: 'unused variable', startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 4 }
      ]
    } satisfies DiagnosticsEventT,
    empty: { uri: 'file:///src/a.ts', markers: [] } satisfies DiagnosticsEventT,
    invalid: { uri: 'file:///src/a.ts', markers: [{ severity: 99, message: 'x', startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }] } as unknown as DiagnosticsEventT
  },
  training: {
    ok: { job: 'veritas-01', step: 1200, loss: 2.341, status: 'running', epoch: 3 } satisfies TrainingProgressEventT,
    done: { job: 'veritas-01', step: 5000, status: 'done' } satisfies TrainingProgressEventT,
    invalid: { job: 'veritas-01', step: -1, status: 'running' } as unknown as TrainingProgressEventT
  }
};