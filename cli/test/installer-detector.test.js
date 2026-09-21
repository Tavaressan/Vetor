'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { detectEngines, ENGINES } = require('../lib/installer/detector.js');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-detector-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// PATH vazio garante que nenhum comando é encontrado, isolando a detecção do ambiente real
// da máquina que roda o teste.
const EMPTY_PATH_ENV = { PATH: '', Path: '', PATHEXT: '' };

test('detectEngines: diretório vazio + PATH vazio não detecta nenhuma engine, sem erro', () => {
  withTempDir((dir) => {
    const result = detectEngines(dir, EMPTY_PATH_ENV);
    assert.equal(result.length, ENGINES.length);
    for (const engine of result) {
      assert.equal(engine.detected, false, `${engine.id} não deveria ser detectada`);
    }
  });
});

test('detectEngines: cada entrada expõe id, name e detected', () => {
  withTempDir((dir) => {
    const result = detectEngines(dir, EMPTY_PATH_ENV);
    for (const engine of result) {
      assert.equal(typeof engine.id, 'string');
      assert.equal(typeof engine.name, 'string');
      assert.equal(typeof engine.detected, 'boolean');
    }
  });
});

// Issue #269 (regressão já coberta em install.test.js): '.claude' como arquivo comum
// (não diretório) não deve ser detectado como engine Claude Code.
test('detectEngines: ".claude" como arquivo comum não detecta Claude Code', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '.claude'), 'não é um diretório');
    const result = detectEngines(dir, EMPTY_PATH_ENV);
    const claudeCode = result.find((e) => e.id === 'claude-code');
    assert.equal(claudeCode.detected, false);
  });
});

test('detectEngines: ".claude" como diretório detecta Claude Code', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, '.claude'));
    const result = detectEngines(dir, EMPTY_PATH_ENV);
    const claudeCode = result.find((e) => e.id === 'claude-code');
    assert.equal(claudeCode.detected, true);
  });
});

test('detectEngines: "AGENTS.md" na raiz detecta Codex', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Agents');
    const result = detectEngines(dir, EMPTY_PATH_ENV);
    const codex = result.find((e) => e.id === 'codex');
    assert.equal(codex.detected, true);
  });
});

test('detectEngines: "AGENTS.md" como diretório não detecta Codex (simétrico ao caso .claude)', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, 'AGENTS.md'));
    const result = detectEngines(dir, EMPTY_PATH_ENV);
    const codex = result.find((e) => e.id === 'codex');
    assert.equal(codex.detected, false);
  });
});

test('detectEngines: ".opencode/" na raiz detecta OpenCode', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, '.opencode'));
    const result = detectEngines(dir, EMPTY_PATH_ENV);
    const opencode = result.find((e) => e.id === 'opencode');
    assert.equal(opencode.detected, true);
  });
});

test('detectEngines: comando no PATH detecta a engine mesmo sem arquivo-âncora', () => {
  withTempDir((dir) => {
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'agy'), '#!/bin/sh\n');
    const env = { PATH: binDir, Path: binDir, PATHEXT: '' };
    const result = detectEngines(dir, env);
    const antigravity = result.find((e) => e.id === 'antigravity');
    assert.equal(antigravity.detected, true);
  });
});

// Issue #256: Cursor usa `.cursor/` como diretório-âncora (rules/skills/agents/hooks
// vivem todos ali — ver wiki/Compatibilidade-Cursor.md).
test('detectEngines: ".cursor/" na raiz detecta Cursor', () => {
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, '.cursor'));
    const result = detectEngines(dir, EMPTY_PATH_ENV);
    const cursor = result.find((e) => e.id === 'cursor');
    assert.equal(cursor.detected, true);
  });
});

test('detectEngines: ".cursor" como arquivo comum não detecta Cursor (simétrico ao caso .claude)', () => {
  withTempDir((dir) => {
    fs.writeFileSync(path.join(dir, '.cursor'), 'não é um diretório');
    const result = detectEngines(dir, EMPTY_PATH_ENV);
    const cursor = result.find((e) => e.id === 'cursor');
    assert.equal(cursor.detected, false);
  });
});

// `cursor-agent` (não `agent`, genérico demais e propenso a colisão — ver wiki) é o sinal
// de comando confirmado contra o script real de instalação do Cursor.
test('detectEngines: "cursor-agent" no PATH detecta Cursor mesmo sem ".cursor/"', () => {
  withTempDir((dir) => {
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'cursor-agent'), '#!/bin/sh\n');
    const env = { PATH: binDir, Path: binDir, PATHEXT: '' };
    const result = detectEngines(dir, env);
    const cursor = result.find((e) => e.id === 'cursor');
    assert.equal(cursor.detected, true);
  });
});
