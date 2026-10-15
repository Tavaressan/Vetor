'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const binPath = path.join(__dirname, '..', 'bin', 'vetor.js');

test('vetor --help lista os comandos disponíveis', () => {
  const output = execFileSync(process.execPath, [binPath, '--help'], { encoding: 'utf8' });
  assert.match(output, /install/);
  assert.match(output, /update/);
  assert.match(output, /status/);
  assert.match(output, /uninstall/);
});

test('vetor sem argumentos também lista os comandos', () => {
  const output = execFileSync(process.execPath, [binPath], { encoding: 'utf8' });
  assert.match(output, /install/);
  assert.match(output, /update/);
  assert.match(output, /status/);
  assert.match(output, /uninstall/);
});

test('vetor --help lista as opções globais incluindo --version e -v', () => {
  const output = execFileSync(process.execPath, [binPath, '--help'], { encoding: 'utf8' });
  assert.match(output, /--version/);
  assert.match(output, /-v/);
});

