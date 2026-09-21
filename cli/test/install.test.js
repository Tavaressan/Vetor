'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { install } = require('../lib/commands/install.js');

// Regressão da issue #269 (".claude" como arquivo comum não é falso-positivo de engine) migrou
// para test/installer-detector.test.js, onde a lógica de detecção agora vive (detector.js).
// Este arquivo testa a orquestração do comando install() em cima de detectEngines/runInstallPrompts.

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-install-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function captureInfo(fn) {
  const lines = [];
  const original = console.info;
  console.info = (msg) => lines.push(msg);
  try {
    await fn();
  } finally {
    console.info = original;
  }
  return lines.join('\n');
}

test('install: nenhuma engine detectada + usuário confirma seleção vazia -> cancela sem erro', async () => {
  await withTempDir(async (dir) => {
    const detectEngines = () => [
      { id: 'claude-code', name: 'Claude Code', detected: false },
      { id: 'codex', name: 'Codex', detected: false },
    ];
    const runInstallPrompts = async (engines) => {
      // Simula que o usuário não marcou nenhuma engine (checkbox nasceu vazio, pois
      // nenhuma engine foi detectada) e confirmou assim mesmo.
      assert.equal(engines.every((e) => e.detected === false), true);
      return [];
    };

    const output = await captureInfo(() =>
      install(dir, { detectEngines, runInstallPrompts }),
    );

    assert.match(output, /Nenhuma engine detectada/);
    assert.match(output, /Instalação cancelada/);
  });
});

test('install: engine detectada + usuário confirma seleção pré-marcada -> reporta selecionadas', async () => {
  await withTempDir(async (dir) => {
    const detectEngines = () => [{ id: 'claude-code', name: 'Claude Code', detected: true }];
    const runInstallPrompts = async (engines) => engines.filter((e) => e.detected);

    const output = await captureInfo(() =>
      install(dir, { detectEngines, runInstallPrompts }),
    );

    assert.match(output, /Engines detectadas: Claude Code/);
    assert.match(output, /Engines selecionadas: Claude Code/);
  });
});

test('install: nunca instala sem a confirmação explícita do runInstallPrompts (seleção vazia = sem side effect)', async () => {
  await withTempDir(async (dir) => {
    const detectEngines = () => [{ id: 'claude-code', name: 'Claude Code', detected: true }];
    // Mesmo com engine detectada, o usuário pode recusar explicitamente (runInstallPrompts
    // retorna vazio) — install() precisa respeitar isso e não seguir adiante.
    const runInstallPrompts = async () => [];

    const output = await captureInfo(() =>
      install(dir, { detectEngines, runInstallPrompts }),
    );

    assert.match(output, /Instalação cancelada/);
    assert.doesNotMatch(output, /Engines selecionadas/);
  });
});
