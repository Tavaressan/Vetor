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

test('install: engine detectada + usuário confirma seleção pré-marcada -> reporta selecionadas e copia arquivos', async () => {
  await withTempDir(async (dir) => {
    const detectEngines = () => [{ id: 'claude-code', name: 'Claude Code', detected: true }];
    const runInstallPrompts = async (engines) => engines.filter((e) => e.detected);
    // installFiles é responsabilidade do writer (issue #255, testado isoladamente em
    // installer-writer.test.js) — aqui só verificamos que install() invoca com os
    // parâmetros certos e reporta o resultado.
    let receivedArgs;
    const installFiles = (args) => {
      receivedArgs = args;
      return { copied: ['.claude/skills/foo/SKILL.md'], skipped: [] };
    };

    const output = await captureInfo(() =>
      install(dir, { detectEngines, runInstallPrompts, installFiles }),
    );

    assert.match(output, /Engines detectadas: Claude Code/);
    assert.match(output, /Engines selecionadas: Claude Code/);
    assert.match(output, /1 arquivo\(s\) copiado\(s\)/);
    assert.equal(receivedArgs.projectRoot, dir);
    assert.equal(receivedArgs.engines.length, 1);
    assert.equal(receivedArgs.engines[0].id, 'claude-code');
  });
});

test('install: reporta arquivos não sobrescritos quando o writer sinaliza skipped', async () => {
  await withTempDir(async (dir) => {
    const detectEngines = () => [{ id: 'claude-code', name: 'Claude Code', detected: true }];
    const runInstallPrompts = async (engines) => engines.filter((e) => e.detected);
    const installFiles = () => ({
      copied: [],
      skipped: [{ path: '.claude/skills/foo/SKILL.md', reason: 'user-modified' }],
    });

    const output = await captureInfo(() =>
      install(dir, { detectEngines, runInstallPrompts, installFiles }),
    );

    assert.match(output, /1 arquivo\(s\) não sobrescrito\(s\)/);
  });
});

// Issue #283: engine sem destino de arquivo confirmado (ex.: Antigravity) precisa ser
// reportada ao usuário, não silenciosamente ignorada — ver `enginesSkipped` em writer.js.
test('install: reporta engine sem destino de arquivo confirmado (enginesSkipped)', async () => {
  await withTempDir(async (dir) => {
    const detectEngines = () => [{ id: 'antigravity', name: 'Antigravity', detected: true }];
    const runInstallPrompts = async (engines) => engines.filter((e) => e.detected);
    const installFiles = () => ({
      copied: [],
      skipped: [],
      enginesSkipped: [
        { id: 'antigravity', name: 'Antigravity', reason: 'no-verified-project-anchor' },
      ],
    });

    const output = await captureInfo(() =>
      install(dir, { detectEngines, runInstallPrompts, installFiles }),
    );

    assert.match(output, /Antigravity: nenhum arquivo instalado/);
  });
});

test('install: nunca instala sem a confirmação explícita do runInstallPrompts (seleção vazia = sem side effect)', async () => {
  await withTempDir(async (dir) => {
    const detectEngines = () => [{ id: 'claude-code', name: 'Claude Code', detected: true }];
    // Mesmo com engine detectada, o usuário pode recusar explicitamente (runInstallPrompts
    // retorna vazio) — install() precisa respeitar isso e não seguir adiante.
    const runInstallPrompts = async () => [];
    const installFiles = () => {
      throw new Error('installFiles não deveria ser chamado sem seleção confirmada');
    };

    const output = await captureInfo(() =>
      install(dir, { detectEngines, runInstallPrompts, installFiles }),
    );

    assert.match(output, /Instalação cancelada/);
    assert.doesNotMatch(output, /Engines selecionadas/);
  });
});
