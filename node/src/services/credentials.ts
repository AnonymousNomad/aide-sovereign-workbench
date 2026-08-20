import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface CryptService {
  readonly kind: string;
  available(): Promise<boolean>;
  protect(plaintext: string): Promise<string>;
  unprotect(blobB64: string): Promise<string>;
}

const PROTECT_SCRIPT =
  'Add-Type -AssemblyName System.Security; ' +
  '$b=[Convert]::FromBase64String($env:AIDE_DPAPI_IN); ' +
  '$e=[System.Security.Cryptography.ProtectedData]::Protect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); ' +
  '[Convert]::ToBase64String($e)';

const UNPROTECT_SCRIPT =
  'Add-Type -AssemblyName System.Security; ' +
  '$b=[Convert]::FromBase64String($env:AIDE_DPAPI_IN); ' +
  '$e=[System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); ' +
  '[Convert]::ToBase64String($e)';

export class PowerShellCrypt implements CryptService {
  readonly kind = 'dpapi-powershell';

  async available(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    try {
      await this.run('Add-Type -AssemblyName System.Security; [void][System.Security.Cryptography.DataProtectionScope]::CurrentUser; "ok"');
      return true;
    } catch {
      return false;
    }
  }

  async protect(plaintext: string): Promise<string> {
    return this.run(PROTECT_SCRIPT, Buffer.from(plaintext, 'utf8').toString('base64'));
  }

  async unprotect(blobB64: string): Promise<string> {
    const out = await this.run(UNPROTECT_SCRIPT, blobB64);
    return Buffer.from(out, 'base64').toString('utf8');
  }

  private run(script: string, arg?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: arg === undefined ? process.env : { ...process.env, AIDE_DPAPI_IN: arg }
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('credential store timed out'));
      }, 20_000);
      child.stdout.on('data', chunk => {
        stdout += String(chunk);
      });
      child.stderr.on('data', chunk => {
        stderr += String(chunk);
      });
      child.on('error', error => {
        clearTimeout(timer);
        reject(new Error(`credential store unavailable (${error.message})`));
      });
      child.on('close', code => {
        clearTimeout(timer);
        const detail = stderr.trim().slice(-300);
        if (code !== 0) {
          reject(new Error(`credential store failed (exit ${code})${detail.length > 0 ? `: ${detail}` : ''}`));
          return;
        }
        const out = stdout.trim();
        if (out.length === 0) {
          reject(new Error(`credential store returned empty output${detail.length > 0 ? `: ${detail}` : ''}`));
          return;
        }
        resolve(out);
      });
    });
  }
}

export class NullCrypt implements CryptService {
  readonly kind = 'none';

  async available(): Promise<boolean> {
    return false;
  }

  async protect(): Promise<string> {
    throw new Error('credential store unavailable on this platform');
  }

  async unprotect(): Promise<string> {
    throw new Error('credential store unavailable on this platform');
  }
}

export function defaultCrypt(): CryptService {
  return process.platform === 'win32' ? new PowerShellCrypt() : new NullCrypt();
}

interface CredentialFile {
  version: number;
  providers: Record<string, string>;
}

export class CredentialStore {
  private readonly filePath: string;
  private readonly crypt: CryptService;
  private cache: CredentialFile | null = null;

  constructor(workspace: string, crypt: CryptService = defaultCrypt()) {
    this.filePath = path.join(workspace, '.aide', 'credentials.dpapi');
    this.crypt = crypt;
  }

  async available(): Promise<boolean> {
    return this.crypt.available();
  }

  async has(providerId: string): Promise<boolean> {
    return (await this.get(providerId)) !== undefined;
  }

  async get(providerId: string): Promise<string | undefined> {
    if (!(await this.crypt.available())) return undefined;
    const file = await this.load();
    const blob = file.providers[providerId];
    if (blob === undefined) return undefined;
    return this.crypt.unprotect(blob);
  }

  async set(providerId: string, key: string): Promise<void> {
    if (!(await this.crypt.available())) {
      throw new Error('credential store unavailable on this platform');
    }
    const file = await this.load();
    file.providers[providerId] = await this.crypt.protect(key);
    await this.persist(file);
  }

  async delete(providerId: string): Promise<void> {
    const file = await this.load();
    if (file.providers[providerId] !== undefined) {
      delete file.providers[providerId];
      await this.persist(file);
    }
  }

  async ids(): Promise<string[]> {
    const file = await this.load();
    return Object.keys(file.providers);
  }

  private async load(): Promise<CredentialFile> {
    if (this.cache !== null) return this.cache;
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8')) as CredentialFile;
      this.cache = { version: raw.version ?? 1, providers: raw.providers ?? {} };
    } catch {
      this.cache = { version: 1, providers: {} };
    }
    return this.cache;
  }

  private async persist(file: CredentialFile): Promise<void> {
    this.cache = file;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true }).catch(() => {});
    await fs.writeFile(this.filePath, JSON.stringify(file, null, 2), 'utf8');
  }
}

export function scrubKey(text: string, key: string | undefined): string {
  if (key === undefined || key.length === 0) return text;
  return text.split(key).join('[redacted]');
}