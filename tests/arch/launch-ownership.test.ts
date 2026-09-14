import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import viteConfig from '../../browser/vite.config.ts';
import { facadeHttpUrl, facadeWebSocketUrl } from '../../browser/src/services/runtime-config.ts';

test('repository scripts expose typed launch defaults and an explicit legacy compatibility path', async () => {
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts.start, 'node scripts/start.mjs --frontend=typed --build');
  assert.equal(pkg.scripts.dev, 'node scripts/start.mjs --frontend=vite');
  assert.equal(pkg.scripts['dev:frontend'], 'vite --config browser/vite.config.ts');
  assert.equal(pkg.scripts['start:legacy'], 'node scripts/start.mjs --frontend=legacy');
});

test('Vite and typed runtime target the canonical facade, never the TypeScript backend directly', () => {
  const config = viteConfig as {
    base?: string;
    server?: { port?: number; proxy?: Record<string, { target?: string }> };
    preview?: { proxy?: Record<string, { target?: string }> };
  };
  assert.equal(config.base, '/');
  assert.equal(config.server?.port, 5173);
  assert.equal(config.server?.proxy?.['/api']?.target, 'http://127.0.0.1:4777');
  assert.equal(config.server?.proxy?.['/ws']?.target, 'ws://127.0.0.1:4777');
  assert.equal(config.preview?.proxy?.['/api']?.target, 'http://127.0.0.1:4777');
  assert.equal(config.preview?.proxy?.['/ws']?.target, 'ws://127.0.0.1:4777');
  assert.equal(facadeHttpUrl('/api/health'), 'http://127.0.0.1:4777/api/health');
  assert.equal(facadeWebSocketUrl('/ws'), 'ws://127.0.0.1:4777/ws');
  assert.doesNotMatch(facadeHttpUrl('/api/health'), /4778/);
  assert.doesNotMatch(facadeWebSocketUrl('/ws'), /4778/);
});

test('Tauri development and production both select the typed browser architecture', async () => {
  const config = JSON.parse(await fs.readFile('desktop/tauri.conf.json', 'utf8')) as {
    build: {
      frontendDist: string;
      devUrl: string;
      beforeDevCommand: { script: string; cwd: string; wait: boolean };
      beforeBuildCommand: { script: string; cwd: string };
    };
  };
  assert.equal(config.build.frontendDist, '../browser/dist');
  assert.equal(config.build.devUrl, 'http://127.0.0.1:5173');
  assert.deepEqual(config.build.beforeDevCommand, { script: 'npm run dev:frontend', cwd: '..', wait: false });
  assert.deepEqual(config.build.beforeBuildCommand, { script: 'npm run desktop:prepare', cwd: '..' });
});

test('desktop stack launcher has a tracked source authority and legacy frontend remains quarantined', async () => {
  const launcher = await fs.readFile('desktop/stack-launcher.mjs', 'utf8');
  assert.match(launcher, /node[/\\]src[/\\]server\.ts|path\.join\(root, 'node', 'src', 'server\.ts'\)/);
  assert.match(launcher, /scripts[/\\]facade\.mjs|path\.join\(root, 'scripts', 'facade\.mjs'\)/);
  assert.equal(await fs.stat('index.html').then(() => true), true);
  assert.equal(await fs.stat('app.js').then(() => true), true);
  const rootIndex = await fs.readFile('index.html', 'utf8');
  const typedIndex = await fs.readFile(path.join('browser', 'index.html'), 'utf8');
  assert.match(rootIndex, /app\.js/);
  assert.match(typedIndex, /src\/main\.ts/);
});
