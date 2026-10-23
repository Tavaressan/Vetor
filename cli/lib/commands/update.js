'use strict';

const { ENGINES } = require('../installer/detector.js');
const { installFiles: defaultInstallFiles } = require('../installer/writer.js');
const { readManifest: defaultReadManifest } = require('../installer/manifest.js');
const { version: cliVersion } = require('../../package.json');

const ENGINE_NAME_BY_ID = new Map(ENGINES.map((engine) => [engine.id, engine.name]));

/**
 * Comando `update`: sincroniza a instalação existente sem repetir a detecção/seleção de
 * engines do `install` (issue #301) — as engines a atualizar são derivadas do próprio
 * manifesto (`.vetor/install-manifest.json`, campos `engines`/`engine` de cada entrada), nunca de
 * `detectEngines()`, para não arriscar instalar numa engine que o usuário nunca selecionou
 * (ou deixar de atualizar uma que ele selecionou).
 *
 * A política de "update seguro" por arquivo (ausente copia, hash bate sincroniza,
 * unmanaged/user-modified nunca sobrescreve) já vive em `installFiles`/`copyManagedFile` —
 * este comando só monta os argumentos e reporta o resultado.
 *
 * Arquivo que constava no manifesto antes desta rodada e não aparece em `copied` nem
 * `skipped` depois é órfão (fonte removeu o arquivo, ex.: skill descontinuada): reportado,
 * nunca apagado — deleção fica reservada ao comando `uninstall`. Chave que `installFiles`
 * migrou de `.cursor/skills/` para a raiz de skills compartilhada (`migrated`, #479) não é
 * órfã: deixou o manifesto de propósito.
 *
 * `readManifest`/`installFiles` são injetáveis para testes.
 */
function update(cwd = process.cwd(), options = {}) {
  const readManifest = options.readManifest ?? defaultReadManifest;
  const installFiles = options.installFiles ?? defaultInstallFiles;

  const manifestBefore = readManifest(cwd);
  const keysBefore = Object.keys(manifestBefore.files);

  if (keysBefore.length === 0) {
    console.info('Nenhuma instalação encontrada neste projeto. Rode "vetor install" primeiro.');
    return;
  }

  const engineIds = [...new Set(Object.values(manifestBefore.files).flatMap((entry) => entry.engines ?? [entry.engine]))];
  const engines = engineIds.map((id) => ({ id, name: ENGINE_NAME_BY_ID.get(id) ?? id }));

  console.info(`Atualizando engines: ${engines.map((engine) => engine.name).join(', ')}.`);

  const { copied, skipped, warnings = [], migrated = [] } = installFiles({ projectRoot: cwd, engines });

  console.info(`${manifestBefore.packageVersion ?? 'desconhecida'} → ${cliVersion}`);

  console.info(`${copied.length} arquivo(s) sincronizado(s).`);
  if (skipped.length > 0) {
    console.info(
      `${skipped.length} arquivo(s) não sobrescrito(s) (editado(s) pelo usuário ou não gerado(s) pelo instalador).`,
    );
  }
  if (migrated.length > 0) {
    console.info(`${migrated.length} arquivo(s) de skills do Cursor migrado(s) para o diretório de skills compartilhado.`);
  }
  for (const warning of warnings) {
    console.info(`Aviso: ${warning}`);
  }

  // Chave migrada saiu do manifesto de propósito: não é órfã da fonte.
  const touched = new Set([...copied, ...skipped.map((entry) => entry.path), ...migrated.map((entry) => entry.from)]);
  for (const key of keysBefore) {
    if (key.startsWith('.codex/skills/') && manifestBefore.files[key].engine === 'codex') continue;
    if (!touched.has(key)) {
      console.info(`${key}: não existe mais na fonte (não removido — use "vetor uninstall" se quiser limpar).`);
    }
  }
}

module.exports = { update };
