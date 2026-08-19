import { test } from 'node:test';
import assert from 'node:assert/strict';
import { languageForPath } from '../../browser/src/editor/languages.ts';

test('languageForPath maps extensions', () => {
  assert.equal(languageForPath('src/main.js'), 'javascript');
  assert.equal(languageForPath('src\\server.mjs'), 'javascript');
  assert.equal(languageForPath('src/app.ts'), 'typescript');
  assert.equal(languageForPath('train.py'), 'python');
  assert.equal(languageForPath('package.json'), 'json');
  assert.equal(languageForPath('index.html'), 'html');
  assert.equal(languageForPath('styles.css'), 'css');
  assert.equal(languageForPath('README.md'), 'markdown');
  assert.equal(languageForPath('config.yaml'), 'yaml');
  assert.equal(languageForPath('run.sh'), 'shell');
  assert.equal(languageForPath('setup.ps1'), 'powershell');
});

test('languageForPath handles special filenames and unknown extensions', () => {
  assert.equal(languageForPath('.gitignore'), 'plaintext');
  assert.equal(languageForPath('Dockerfile'), 'dockerfile');
  assert.equal(languageForPath('Makefile'), 'makefile');
  assert.equal(languageForPath('noext'), 'plaintext');
  assert.equal(languageForPath('archive.xyz'), 'plaintext');
  assert.equal(languageForPath('UPPER.CSS'), 'css');
});