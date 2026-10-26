'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const {
  manifestPathFor,
  readManifest: defaultReadManifest,
  writeManifest: defaultWriteManifest,
  hashFile: defaultHashFile,
  ownersOf,
} = require('../installer/manifest.js');
const { ENGINE_NAME_BY_ID } = require('../installer/detector.js');

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
 * Com `options.engines` (IDs separados por vírgula, ou array), desinstala só essas engines
 * (#479): cada arquivo perde as engines informadas da lista de donos e só é removido quando
 * nenhum dono resta — arquivo em diretório compartilhado (ex.: `.agents/skills/` usado por
 * Codex, Antigravity e Cursor) continua no disco, com os donos restantes no manifesto, enquanto
 * outra engine o usar. Quando o último dono sai, valem as regras acima (íntegro remove,
 * editado preserva e continua registrado). Nesse caso a entrada preservada mantém os donos
 * originais, mas ganha `uninstalled: true`: `update`/`install` não tratam a engine como
 * instalada por causa dela, e uma nova tentativa de `--engines` a considera sem donos vivos.
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

  let selectedIds;
  if (options.engines !== undefined) {
    const rawIds = typeof options.engines === 'string' ? options.engines.split(',') : options.engines;
    selectedIds = new Set(rawIds.map((id) => String(id).trim()));
    const invalidId = [...selectedIds].find((id) => !ENGINE_NAME_BY_ID.has(id));
    if (invalidId !== undefined) {
      console.error(`Engine inválida: ${invalidId}. Engines disponíveis: ${[...ENGINE_NAME_BY_ID.keys()].join(', ')}`);
      process.exitCode = 1;
      return;
    }
  }

  const manifest = readManifest(cwd);
  const entries = Object.entries(manifest.files);

  if (entries.length === 0) {
    console.info('Nada para desinstalar: Vetor não está instalado neste projeto.');
    return;
  }

  const inScope = selectedIds
    ? entries.filter(([, entry]) => ownersOf(entry).some((id) => selectedIds.has(id)))
    : entries;
  if (inScope.length === 0) {
    console.info('Nada para desinstalar: nenhum arquivo do manifesto pertence às engines informadas.');
    return;
  }

  console.info(`${inScope.length} arquivo(s) gerenciado(s) encontrado(s).`);
  const confirmMessage = selectedIds
    ? `Remover os arquivos instalados pelo Vetor para: ${[...selectedIds].map((id) => ENGINE_NAME_BY_ID.get(id)).join(', ')}?`
    : 'Remover todos os arquivos instalados pelo Vetor?';
  const confirmed = options.yes
    ? true
    : await confirm(confirmMessage, { input, output });
  if (!confirmed) {
    console.info('Desinstalação cancelada.');
    return;
  }

  const removed = [];
  const preserved = [];
  const kept = [];
  const remainingFiles = {};

  for (const [key, entry] of entries) {
    // Entrada que continuará no manifesto quando o arquivo for preservado.
    let retainedEntry = entry;
    if (selectedIds) {
      const owners = ownersOf(entry);
      const remainingOwners = owners.filter((id) => !selectedIds.has(id));
      if (remainingOwners.length === owners.length) {
        remainingFiles[key] = entry;
        continue;
      }
      // Entrada já marcada como desinstalada não tem dono vivo: os donos listados são os que
      // saíram antes, então esta tentativa a trata como a última.
      if (remainingOwners.length > 0 && !entry.uninstalled) {
        remainingFiles[key] = { ...entry, engine: remainingOwners[0], engines: remainingOwners };
        kept.push(key);
        continue;
      }
      retainedEntry = { ...entry, uninstalled: true };
    }

    const destFile = path.resolve(cwd, ...key.split('/'));
    const relative = path.relative(cwd, destFile);
    const isInsideProject = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);

    if (!isInsideProject) {
      preserved.push({ path: key, reason: 'outside-project-root' });
      remainingFiles[key] = retainedEntry;
      continue;
    }

    if (!fs.existsSync(destFile)) {
      preserved.push({ path: key, reason: 'already-missing' });
      continue;
    }

    if (hashFile(destFile) !== entry.sha256) {
      preserved.push({ path: key, reason: 'user-modified' });
      remainingFiles[key] = retainedEntry;
      continue;
    }

    fs.unlinkSync(destFile);
    removed.push(key);
  }

  console.info(`${removed.length} arquivo(s) removido(s).`);
  if (kept.length > 0) {
    console.info(`${kept.length} arquivo(s) mantido(s) (em uso por outra engine).`);
  }
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
