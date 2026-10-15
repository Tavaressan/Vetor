'use strict';

const { detectEngines: defaultDetectEngines, ENGINES } = require('../installer/detector.js');
const { runInstallPrompts: defaultRunInstallPrompts } = require('../installer/prompts.js');
const { installFiles: defaultInstallFiles } = require('../installer/writer.js');
const { printBanner: defaultPrintBanner } = require('../banner.js');

/**
 * Comando `install`: detecta engines suportadas no projeto-alvo (ver `ENGINES` em
 * `installer/detector.js`) e oferece seleção interativa
 * com as engines detectadas pré-marcadas. A detecção é só sugestão inicial: nenhuma
 * engine é instalada sem confirmação explícita do usuário via `runInstallPrompts` ou
 * via flags não-interativas (`--engines <ids> --yes`, issue #359).
 *
 * Após a confirmação, copia `skills/`/`agents/`/`hooks/` (ou a árvore nativa da engine,
 * quando existir) para o destino de cada engine selecionada via `installFiles` (writer,
 * issue #255, tradução de formato por engine revisada na #283), gravando manifesto de hash
 * por arquivo para updates seguros mais tarde. Engine sem destino de arquivo confirmado
 * (`enginesSkipped`) é reportada ao usuário em vez de silenciosamente ignorada.
 *
 * `detectEngines`/`runInstallPrompts`/`installFiles`/`printBanner`/`input`/`output` são
 * injetáveis para testes.
 */
async function install(cwd = process.cwd(), options = {}) {
  const detectEngines = options.detectEngines ?? defaultDetectEngines;
  const runInstallPrompts = options.runInstallPrompts ?? defaultRunInstallPrompts;
  const installFiles = options.installFiles ?? defaultInstallFiles;
  const printBanner = options.printBanner ?? defaultPrintBanner;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  printBanner();

  let selected;

  if (options.yes && options.engines !== undefined) {
    const availableEngines = options.availableEngines ?? ENGINES;
    const rawEngines = typeof options.engines === 'string'
      ? options.engines.split(',')
      : (Array.isArray(options.engines) ? options.engines : [String(options.engines)]);
    const parsedIds = rawEngines.map((id) => String(id).trim());

    if (parsedIds.length === 0 || (parsedIds.length === 1 && parsedIds[0] === '')) {
      const validIds = availableEngines.map((e) => e.id);
      console.error(`Engine inválida: . Engines disponíveis: ${validIds.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    const validIds = availableEngines.map((e) => e.id);
    for (const id of parsedIds) {
      if (!validIds.includes(id)) {
        console.error(`Engine inválida: ${id}. Engines disponíveis: ${validIds.join(', ')}`);
        process.exitCode = 1;
        return;
      }
    }

    const uniqueIds = [...new Set(parsedIds)];
    selected = uniqueIds.map((id) => availableEngines.find((e) => e.id === id));
  } else {
    const engines = detectEngines(cwd);
    const detectedNames = engines.filter((engine) => engine.detected).map((engine) => engine.name);

    if (detectedNames.length > 0) {
      console.info(`Engines detectadas: ${detectedNames.join(', ')}.`);
    } else {
      console.info('Nenhuma engine detectada no diretório atual.');
    }

    selected = await runInstallPrompts(engines, { input, output });

    if (selected.length === 0) {
      console.info('Nenhuma engine selecionada. Instalação cancelada.');
      return;
    }
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
