import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRoutes, generateOpenApi } from '../node/src/openapi.ts';

const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.env.AIDE_VERSION || '0.1.0';
const routes = await buildRoutes(home, version);
const doc = generateOpenApi(routes, { title: 'AIDE Arch Daemon API', version });
const json = JSON.stringify(doc, null, 2) + '\n';
const out = path.join(home, 'common', 'openapi.json');
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, json, 'utf8');
console.log(`wrote ${out} (${Buffer.byteLength(json)} bytes, ${routes.length - 1} documented routes)`);