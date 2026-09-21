'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const binPath = path.join(__dirname, '..', 'bin', 'vetor.js');

// Issue #269 (achado da PR #268): comandos com nome de propriedade herdada de Object.prototype
// (toString, constructor, valueOf, ...) resolviam para um valor truthy herdado em COMMANDS[command],
// escapando do guard `if (!entry)` e caindo em `entry.fn()` com `entry.fn === undefined` — TypeError
// não tratado em vez do fluxo limpo "Comando desconhecido".
test('vetor toString reporta comando desconhecido em vez de lançar TypeError', () => {
  const result = spawnSync(process.execPath, [binPath, 'toString'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /TypeError/);
  assert.match(result.stderr, /Comando desconhecido: toString/);
});

test('vetor constructor reporta comando desconhecido em vez de lançar TypeError', () => {
  const result = spawnSync(process.execPath, [binPath, 'constructor'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /TypeError/);
  assert.match(result.stderr, /Comando desconhecido: constructor/);
});
