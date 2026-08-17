import type { FileReadResponseT } from '../../common/contracts/file.ts';
import type { WorkspaceListResponseT } from '../../common/contracts/workspace.ts';

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

export const workspaceListFixtures = {
  listNormal: {
    workspace: 'E:\\aide-sovereign-workbench',
    entries: [
      { name: 'app.js', kind: 'file' },
      { name: 'daemon', kind: 'directory' }
    ]
  } satisfies WorkspaceListResponseT
};