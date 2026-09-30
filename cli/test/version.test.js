'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const pkg = require('../package.json');

const binPath = path.join(__dirname, '..', 'bin', 'vetor.js');

test('vetor --version imprime apenas a versão do pacote e sai com exit 0', () => {
  const result = spawnSync(process.execPath, [binPath, '--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), pkg.version);
  assert.equal(result.stderr, '');
});

test('vetor -v imprime apenas a versão do pacote e sai com exit 0', () => {
  const result = spawnSync(process.execPath, [binPath, '-v'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), pkg.version);
  assert.equal(result.stderr, '');
});
