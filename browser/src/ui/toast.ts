/// <reference lib="dom" />

export const MESSAGES: Record<string, string> = {
  BAD_REQUEST: 'Invalid request',
  FORBIDDEN: 'Access denied',
  NOT_FOUND: 'Not found',
  CONFLICT: 'Conflict',
  PAYLOAD_TOO_LARGE: 'File too large to open',
  INTERNAL: 'Daemon error',
  NOT_READY: 'Still warming up',
  TIMEOUT: 'Timed out',
  CHILD_FAILED: 'Background process failed',
  BAD_RESPONSE: 'Unexpected daemon response',
  COMMIT_FAILED: 'Save failed'
};

export function translateError(code: string, message: string): string {
  return MESSAGES[code] ?? message;
}

export function showToast(root: HTMLElement, code: string, message: string): void {
  root.textContent = translateError(code, message);
  root.dataset.level = code === 'INTERNAL' || code === 'BAD_RESPONSE' ? 'err' : 'warn';
}