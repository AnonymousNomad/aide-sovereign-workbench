import { promises as fs } from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

export class Logger {
  private readonly file: string;
  private readonly maxBytes: number;
  private pending: Promise<void> = Promise.resolve();

  constructor(file: string, maxBytes = 5 * 1024 * 1024) {
    this.file = file;
    this.maxBytes = maxBytes;
  }

  log(level: LogLevel, msg: string, meta: Record<string, unknown> = {}): void {
    const entry: LogEntry = { ts: new Date().toISOString(), level, msg, ...meta };
    const line = JSON.stringify(entry) + '\n';
    this.pending = this.pending.then(async () => {
      try {
        await this.appendWithRotation(line);
      } catch (error) {
        console.error(`[logger] write failed: ${(error as Error).message}`);
      }
    });
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    this.log('debug', msg, meta);
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    this.log('info', msg, meta);
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    this.log('warn', msg, meta);
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    this.log('error', msg, meta);
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  private async appendWithRotation(line: string): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const stat = await fs.stat(this.file).catch(() => null);
    if (stat && stat.size + Buffer.byteLength(line) > this.maxBytes) {
      await fs.rename(this.file, `${this.file}.1`).catch(() => {});
    }
    await fs.appendFile(this.file, line, 'utf8');
  }
}