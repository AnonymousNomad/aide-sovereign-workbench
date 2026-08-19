const EXTENSION_MAP: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  jsx: 'javascript',
  py: 'python',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'shell',
  ps1: 'powershell',
  bat: 'bat',
  cmd: 'bat',
  sql: 'sql',
  xml: 'xml',
  svg: 'xml',
  toml: 'ini',
  ini: 'ini',
  txt: 'plaintext',
  log: 'plaintext'
};

const FILENAME_MAP: Record<string, string> = {
  '.gitignore': 'plaintext',
  'Dockerfile': 'dockerfile',
  'Makefile': 'makefile',
  'README': 'markdown',
  'LICENSE': 'plaintext'
};

export function languageForPath(relPath: string): string {
  const name = relPath.replace(/\\/g, '/').split('/').pop() ?? '';
  const exact = FILENAME_MAP[name];
  if (exact !== undefined) return exact;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'plaintext';
  return EXTENSION_MAP[name.slice(dot + 1).toLowerCase()] ?? 'plaintext';
}