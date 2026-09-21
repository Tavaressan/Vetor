'use strict';

const { detectEngines: defaultDetectEngines } = require('../installer/detector.js');
const { runInstallPrompts: defaultRunInstallPrompts } = require('../installer/prompts.js');
const { installFiles: defaultInstallFiles } = require('../installer/writer.js');

/**
 * Comando `install`: detecta engines suportadas no projeto-alvo (Claude Code, Codex,
 * OpenCode, Antigravity — Cursor fica para a issue #256) e oferece seleção interativa
 * com as engines detectadas pré-marcadas. A detecção é só sugestão inicial: nenhuma
 * engine é instalada sem confirmação explícita do usuário via `runInstallPrompts`.
 *
 * Após a confirmação, copia `skills/`/`agents/`/`hooks/` para o destino nativo de cada
 * engine selecionada via `installFiles` (writer, issue #255), gravando manifesto de hash
 * por arquivo para updates seguros mais tarde.
 *
 * `detectEngines`/`runInstallPrompts`/`installFiles`/`input`/`output` são injetáveis para
 * testes.
 */
async function install(cwd = process.cwd(), options = {}) {
  const detectEngines = options.detectEngines ?? defaultDetectEngines;
  const runInstallPrompts = options.runInstallPrompts ?? defaultRunInstallPrompts;
  const installFiles = options.installFiles ?? defaultInstallFiles;
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

  const { copied, skipped } = installFiles({ projectRoot: cwd, engines: selected });
  console.info(`${copied.length} arquivo(s) copiado(s).`);
  if (skipped.length > 0) {
    console.info(
      `${skipped.length} arquivo(s) não sobrescrito(s) (editado(s) pelo usuário ou não gerado(s) pelo instalador).`,
    );
  }
}

module.exports = { install };
