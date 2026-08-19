export type Eol = 'lf' | 'crlf';

export function sniffEol(content: string): Eol {
  const first = content.indexOf('\n');
  if (first > 0 && content.charCodeAt(first - 1) === 13) return 'crlf';
  return 'lf';
}

export function hasBom(content: string): boolean {
  return content.length > 0 && content.charCodeAt(0) === 0xfeff;
}

export function stripBom(content: string): string {
  return hasBom(content) ? content.slice(1) : content;
}

export function applyEol(content: string, eol: Eol): string {
  if (eol === 'crlf') return content.replace(/\r?\n/g, '\r\n');
  return content.replace(/\r\n/g, '\n');
}

export function restoreBom(content: string, bom: boolean): string {
  return bom && !hasBom(content) ? `\uFEFF${content}` : content;
}