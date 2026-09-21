'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { install } = require('../lib/commands/install.js');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-install-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function captureInfo(fn) {
  const lines = [];
  const original = console.info;
  console.info = (msg) => lines.push(msg);
  try {
    fn();
  } finally {
    console.info = original;
  }
  return lines.join('\n');
}

// Issue #269 (achado da PR #268): install() usava fs.existsSync('.claude') para detectar a engine,
// que também retorna true quando '.claude' existe como arquivo comum (não diretório) — um falso
// positivo de detecção de engine.
test('install: ".claude" existindo como arquivo comum (não diretório) não é detectado como engine', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '.claude'), 'não é um diretório');
    const output = captureInfo(() => install(dir));
    assert.match(output, /Nenhuma engine detectada/);
  });
});

test('install: ".claude" como diretório é detectado como engine', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, '.claude'));
    const output = captureInfo(() => install(dir));
    assert.match(output, /Engine detectada: Claude Code/);
  });
});
