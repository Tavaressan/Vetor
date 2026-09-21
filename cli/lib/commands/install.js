'use strict';

const { detectEngines: defaultDetectEngines } = require('../installer/detector.js');
const { runInstallPrompts: defaultRunInstallPrompts } = require('../installer/prompts.js');

/**
 * Comando `install`: detecta engines suportadas no projeto-alvo (Claude Code, Codex,
 * OpenCode, Antigravity — Cursor fica para a issue #256) e oferece seleção interativa
 * com as engines detectadas pré-marcadas. A detecção é só sugestão inicial: nenhuma
 * engine é instalada sem confirmação explícita do usuário via `runInstallPrompts`.
 *
 * Cópia de arquivos/skills por engine é escopo da issue #255 (writer) — este comando
 * só detecta e confirma a seleção.
 *
 * `detectEngines`/`runInstallPrompts`/`input`/`output` são injetáveis para testes.
 */
async function install(cwd = process.cwd(), options = {}) {
  const detectEngines = options.detectEngines ?? defaultDetectEngines;
  const runInstallPrompts = options.runInstallPrompts ?? defaultRunInstallPrompts;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  const engines = detectEngines(cwd);
  const detectedNames = engines.filter((engine) => engine.detected).map((engine) => engine.name);

  if (detectedNames.length > 0) {
    console.info(`Engines detectadas: ${detectedNames.join(', ')}.`);
  } else {
    console.info('Nenhuma engine detectada no diretório atual.');
  }

  const selected = await runInstallPrompts(engines, { input, output });

  if (selected.length === 0) {
    console.info('Nenhuma engine selecionada. Instalação cancelada.');
    return;
  }

  console.info(`Engines selecionadas: ${selected.map((engine) => engine.name).join(', ')}.`);
  console.info('Cópia de arquivos/skills por engine chega na issue #255.');
}

module.exports = { install };
