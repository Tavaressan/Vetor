'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { ENGINES } = require('../installer/detector.js');
const { readManifest: defaultReadManifest, hashFile: defaultHashFile } = require('../installer/manifest.js');

const ENGINE_NAME_BY_ID = new Map(ENGINES.map((engine) => [engine.id, engine.name]));

const STATE_LABEL = {
  ok: '[ok]',
  missing: '[ausente]',
  modified: '[modificado]',
};

function classify(cwd, key, entry, hashFile) {
  const filePath = path.join(cwd, ...key.split('/'));
  if (!fs.existsSync(filePath)) return 'missing';
  return hashFile(filePath) === entry.sha256 ? 'ok' : 'modified';
}

/**
 * Comando `status` (issue #302): classifica cada arquivo do manifesto de instalação
 * (`.vetor/install-manifest.json`) comparando o hash atual em disco com o hash gravado —
 * `ok` (íntegro), `modificado` (hash diverge do manifesto) ou `ausente` (arquivo sumiu do
 * disco). Somente leitura: nenhum arquivo é criado, alterado ou apagado.
 *
 * `readManifest`/`hashFile` são injetáveis para testes.
 */
function status(cwd = process.cwd(), options = {}) {
  const readManifest = options.readManifest ?? defaultReadManifest;
  const hashFile = options.hashFile ?? defaultHashFile;

  const manifest = readManifest(cwd);
  const entries = Object.entries(manifest.files);

  if (entries.length === 0) {
    console.info('Vetor não está instalado neste projeto.');
    return;
  }

  const byEngine = new Map();
  for (const [key, entry] of entries) {
    const engineName = ENGINE_NAME_BY_ID.get(entry.engine) ?? entry.engine;
    const state = classify(cwd, key, entry, hashFile);
    if (!byEngine.has(engineName)) byEngine.set(engineName, []);
    byEngine.get(engineName).push({ key, state });
  }

  for (const [engineName, files] of byEngine) {
    console.info(`${engineName}:`);
    for (const { key, state } of files) {
      console.info(`  ${STATE_LABEL[state]} ${key}`);
    }
  }
}

module.exports = { status };
