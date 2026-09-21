'use strict';

const { detectEngines: defaultDetectEngines } = require('../installer/detector.js');
const { runInstallPrompts: defaultRunInstallPrompts } = require('../installer/prompts.js');
const { installFiles: defaultInstallFiles } = require('../installer/writer.js');

/**
 * Comando `install`: detecta engines suportadas no projeto-alvo (ver `ENGINES` em
 * `installer/detector.js`) e oferece seleção interativa
 * com as engines detectadas pré-marcadas. A detecção é só sugestão inicial: nenhuma
 * engine é instalada sem confirmação explícita do usuário via `runInstallPrompts`.
 *
 * Após a confirmação, copia `skills/`/`agents/`/`hooks/` (ou a árvore nativa da engine,
 * quando existir) para o destino de cada engine selecionada via `installFiles` (writer,
 * issue #255, tradução de formato por engine revisada na #283), gravando manifesto de hash
 * por arquivo para updates seguros mais tarde. Engine sem destino de arquivo confirmado
 * (`enginesSkipped`) é reportada ao usuário em vez de silenciosamente ignorada.
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

  const {
    copied,
    skipped,
    warnings = [],
    enginesSkipped = [],
  } = installFiles({ projectRoot: cwd, engines: selected });
  console.info(`${copied.length} arquivo(s) copiado(s).`);
  if (skipped.length > 0) {
    console.info(
      `${skipped.length} arquivo(s) não sobrescrito(s) (editado(s) pelo usuário ou não gerado(s) pelo instalador).`,
    );
  }
  for (const warning of warnings) {
    console.info(`Aviso: ${warning}`);
  }
  // Issue #283: engine selecionada sem destino de arquivo confirmado (ex.: Antigravity) não
  // falha nem copia nada — mas precisa ser visível para o usuário, não silenciosa.
  for (const engine of enginesSkipped) {
    console.info(
      `${engine.name}: nenhum arquivo instalado (sem convenção de projeto confirmada para esta engine ainda).`,
    );
  }
}

module.exports = { install };
