'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const {
  manifestPathFor,
  readManifest: defaultReadManifest,
  writeManifest: defaultWriteManifest,
  hashFile: defaultHashFile,
} = require('../installer/manifest.js');

/**
 * Confirmação simples (s/N) antes da remoção. Sessão não-interativa (sem TTY) não tem como
 * obter confirmação explícita — cancela por padrão, mesma postura de `runInstallPrompts`
 * (installer/prompts.js) para seleção vazia em ambiente não-interativo.
 */
function confirmUninstall(message, { input = process.stdin, output = process.stdout, isTTY } = {}) {
  const interactive = isTTY ?? input.isTTY ?? false;

  if (!interactive) {
    output.write(`${message} Sessão não-interativa: cancelado (confirmação explícita é obrigatória).\n`);
    return Promise.resolve(false);
  }

  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) => {
    rl.question(`${message} [s/N]: `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 's');
    });
  });
}

/**
 * Comando `uninstall` (issue #303): remove do projeto-alvo os arquivos gerenciados pelo
 * manifesto de instalação (`.vetor/install-manifest.json`) — única operação destrutiva dos
 * três comandos pendentes de `router.js`, por isso pede confirmação antes de apagar algo.
 *
 * Só remove entrada cujo hash atual em disco ainda bate com o manifestado (não editada pelo
 * usuário desde a instalação). Entrada com hash divergente, ou cujo path resolvido cai fora
 * de `projectRoot` (manifesto corrompido/adulterado), é preservada — nunca apagada
 * silenciosamente — e continua registrada no manifesto. Entrada já ausente do disco é só
 * descartada do manifesto (nada físico para preservar).
 *
 * Se nenhuma entrada sobrar após a rodada, o próprio arquivo de manifesto é removido — não
 * um manifesto com `files: {}` — para que `status`/`update` voltem a reportar "não
 * instalado" em vez de uma instalação vazia.
 *
 * `readManifest`/`writeManifest`/`hashFile`/`confirm`/`input`/`output` são injetáveis para
 * testes.
 */
async function uninstall(cwd = process.cwd(), options = {}) {
  const readManifest = options.readManifest ?? defaultReadManifest;
  const writeManifest = options.writeManifest ?? defaultWriteManifest;
  const hashFile = options.hashFile ?? defaultHashFile;
  const confirm = options.confirm ?? confirmUninstall;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;

  const manifest = readManifest(cwd);
  const entries = Object.entries(manifest.files);

  if (entries.length === 0) {
    console.info('Nada para desinstalar: Vetor não está instalado neste projeto.');
    return;
  }

  console.info(`${entries.length} arquivo(s) gerenciado(s) encontrado(s).`);
  const confirmed = await confirm('Remover todos os arquivos instalados pelo Vetor?', { input, output });
  if (!confirmed) {
    console.info('Desinstalação cancelada.');
    return;
  }

  const removed = [];
  const preserved = [];
  const remainingFiles = {};

  for (const [key, entry] of entries) {
    const destFile = path.resolve(cwd, ...key.split('/'));
    const relative = path.relative(cwd, destFile);
    const isInsideProject = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);

    if (!isInsideProject) {
      preserved.push({ path: key, reason: 'outside-project-root' });
      remainingFiles[key] = entry;
      continue;
    }

    if (!fs.existsSync(destFile)) {
      preserved.push({ path: key, reason: 'already-missing' });
      continue;
    }

    if (hashFile(destFile) !== entry.sha256) {
      preserved.push({ path: key, reason: 'user-modified' });
      remainingFiles[key] = entry;
      continue;
    }

    fs.unlinkSync(destFile);
    removed.push(key);
  }

  console.info(`${removed.length} arquivo(s) removido(s).`);
  if (preserved.length > 0) {
    console.info(`${preserved.length} arquivo(s) preservado(s) (editado(s) pelo usuário ou já ausente(s)).`);
  }

  if (Object.keys(remainingFiles).length > 0) {
    writeManifest(cwd, { ...manifest, files: remainingFiles });
  } else {
    fs.rmSync(manifestPathFor(cwd), { force: true });
  }
}

module.exports = { uninstall, confirmUninstall };
