import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('desktop/target/release/bundle');
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full);
    else files.push(full);
  }
}

await walk(root).catch(error => {
  throw new Error(`desktop bundle directory is missing: ${root} (${error.message})`);
});

const extensions = files.map(file => path.extname(file).toLowerCase());
const expected = process.platform === 'win32'
  ? ['.msi', '.exe']
  : process.platform === 'darwin'
    ? ['.dmg', '.app']
    : ['.deb', '.appimage'];
const installers = files.filter(file => expected.includes(path.extname(file).toLowerCase()));
if (!installers.length) throw new Error(`no ${expected.join(' or ')} desktop installer found; emitted extensions: ${[...new Set(extensions)].sort().join(', ') || '(none)'}`);

for (const file of installers) {
  const details = await stat(file);
  if (!details.size) throw new Error(`desktop installer is empty: ${file}`);
}

console.log(`desktop artifact smoke passed: ${installers.map(file => path.relative(process.cwd(), file)).join(', ')}`);
