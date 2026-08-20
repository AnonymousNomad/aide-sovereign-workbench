export const JSONRPC_HEADER = 'Content-Length: ';
export const JSONRPC_MAX_FRAME_BYTES = 64 * 1024 * 1024;
export const JSONRPC_MAX_HEADER_BYTES = 64 * 1024;

export function encodeJsonRpc(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.from(
    `${JSONRPC_HEADER}${body.length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n`,
    'utf8'
  );
  return Buffer.concat([header, body]);
}

export class JsonRpcDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer | string): unknown[] {
    const incoming = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    this.buffer = this.buffer.length === 0 ? incoming : Buffer.concat([this.buffer, incoming]);
    const messages: unknown[] = [];
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        if (this.buffer.length > JSONRPC_MAX_HEADER_BYTES) throw new Error('jsonrpc header exceeds limit without terminator');
        return messages;
      }
      const header = this.buffer.subarray(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      if (!Number.isFinite(length) || length < 0 || length > JSONRPC_MAX_FRAME_BYTES) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const start = headerEnd + 4;
      if (this.buffer.length < start + length) return messages;
      const raw = this.buffer.subarray(start, start + length).toString('utf8');
      this.buffer = this.buffer.subarray(start + length);
      try {
        messages.push(JSON.parse(raw));
      } catch {
        // malformed body: dropped, framing continues
      }
    }
  }
}