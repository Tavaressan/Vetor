'use strict';

const { ENGINES } = require('../installer/detector.js');
const { installFiles: defaultInstallFiles } = require('../installer/writer.js');
const { readManifest: defaultReadManifest } = require('../installer/manifest.js');

const ENGINE_NAME_BY_ID = new Map(ENGINES.map((engine) => [engine.id, engine.name]));

/**
 * Comando `update`: sincroniza a instalação existente sem repetir a detecção/seleção de
 * engines do `install` (issue #301) — as engines a atualizar são derivadas do próprio
 * manifesto (`.vetor/install-manifest.json`, campo `engine` de cada entrada), nunca de
 * `detectEngines()`, para não arriscar instalar numa engine que o usuário nunca selecionou
 * (ou deixar de atualizar uma que ele selecionou).
 *
 * A política de "update seguro" por arquivo (ausente copia, hash bate sincroniza,
 * unmanaged/user-modified nunca sobrescreve) já vive em `installFiles`/`copyManagedFile` —
 * este comando só monta os argumentos e reporta o resultado.
 *
 * Arquivo que constava no manifesto antes desta rodada e não aparece em `copied` nem
 * `skipped` depois é órfão (fonte removeu o arquivo, ex.: skill descontinuada): reportado,
 * nunca apagado — deleção fica reservada ao comando `uninstall`.
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

  const engineIds = [...new Set(Object.values(manifestBefore.files).map((entry) => entry.engine))];
  const engines = engineIds.map((id) => ({ id, name: ENGINE_NAME_BY_ID.get(id) ?? id }));

  console.info(`Atualizando engines: ${engines.map((engine) => engine.name).join(', ')}.`);

  const { copied, skipped, warnings = [] } = installFiles({ projectRoot: cwd, engines });

  console.info(`${copied.length} arquivo(s) sincronizado(s).`);
  if (skipped.length > 0) {
    console.info(
      `${skipped.length} arquivo(s) não sobrescrito(s) (editado(s) pelo usuário ou não gerado(s) pelo instalador).`,
    );
  }
  for (const warning of warnings) {
    console.info(`Aviso: ${warning}`);
  }

  const touched = new Set([...copied, ...skipped.map((entry) => entry.path)]);
  for (const key of keysBefore) {
    if (!touched.has(key)) {
      console.info(`${key}: não existe mais na fonte (não removido — use "vetor uninstall" se quiser limpar).`);
    }
  }
}

module.exports = { update };
