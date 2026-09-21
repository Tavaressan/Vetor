'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { hashFile, readManifest, writeManifest } = require('./manifest.js');

// Decisão de escopo (issue #255): destino nativo por engine é o diretório-âncora já usado
// pela própria detecção (detector.js usa `.claude`/`.opencode` como âncora; `.codex` e
// `.antigravity` seguem a mesma convenção por consistência, mesmo sem detecção por
// diretório própria hoje). Cursor (#256) fica de fora deliberadamente.
//
// Simplificação assumida e documentada (ver handoff da issue): copia-se `skills/`,
// `agents/`, `hooks/` inteiros e agnósticos (#251) para `<destino-da-engine>/<pasta>/...`,
// igual para as 4 engines. Adaptação fina por formato — ex. Codex exige subagentes em
// `.codex/agents/*.toml` (não `agents/*.md`), OpenCode tem árvore-fonte própria em
// `opencode/` (não `skills/`/`agents/`/`hooks/`) — é gap conhecido, fora do escopo deste
// writer (mecanismo de cópia + manifesto); só a política de destino evolui depois.
const ENGINE_DEST_DIR = {
  'claude-code': '.claude',
  codex: '.codex',
  opencode: '.opencode',
  antigravity: '.antigravity',
};

const SOURCE_DIRS = ['skills', 'agents', 'hooks'];

// cli/lib/installer/writer.js -> cli/lib -> cli -> raiz do monorepo (onde skills/agents/
// hooks vivem hoje). Ver nota de escopo no handoff: em produção (pacote npm publicado,
// que só embarca bin/lib/templates) isso precisa apontar para `cli/templates/`, ainda não
// populado — sincronizar `templates/` é gap de um build/publish step futuro, fora deste writer.
function defaultSourceRoot() {
  return path.join(__dirname, '..', '..', '..');
}

function listFilesRecursive(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      result.push(fullPath);
    }
  }
  return result;
}

/**
 * Copia `skills/`, `agents/`, `hooks/` (fonte agnóstica de engine, #251) para o destino
 * nativo de cada engine selecionada, gravando manifesto de hash SHA-256 por arquivo
 * copiado em `.claude/vetor/install-manifest.json` no projeto-alvo.
 *
 * Idempotente e seguro para update:
 * - Arquivo ausente no destino: copia e manifesta.
 * - Arquivo presente e já manifestado com o mesmo hash do destino atual: seguro
 *   sobrescrever (não foi editado pelo usuário desde a última instalação) — sincroniza
 *   com a fonte, mesmo que o conteúdo da fonte tenha mudado (isso é o "update seguro").
 * - Arquivo presente mas SEM entrada no manifesto, ou com hash divergente da entrada
 *   manifestada: não foi gerado por este instalador ou foi editado pelo usuário — NUNCA
 *   sobrescreve, só reporta como `skipped`.
 *
 * Retorna `{ copied, skipped }` com os paths relativos ao projeto-alvo.
 */
function installFiles({ projectRoot, engines, sourceRoot = defaultSourceRoot() } = {}) {
  if (!projectRoot) {
    throw new Error('installFiles: "projectRoot" é obrigatório.');
  }

  const manifest = readManifest(projectRoot);
  const copied = [];
  const skipped = [];

  for (const engine of engines ?? []) {
    const destRootName = ENGINE_DEST_DIR[engine.id];
    if (!destRootName) continue; // engine sem destino conhecido (ex.: Cursor, #256)

    for (const sourceDirName of SOURCE_DIRS) {
      const sourceDir = path.join(sourceRoot, sourceDirName);
      if (!fs.existsSync(sourceDir)) continue;

      for (const sourceFile of listFilesRecursive(sourceDir)) {
        const relativeToSourceDir = path.relative(sourceDir, sourceFile);
        const destFile = path.join(projectRoot, destRootName, sourceDirName, relativeToSourceDir);
        const manifestKey = path.relative(projectRoot, destFile).split(path.sep).join('/');
        const existingEntry = manifest.files[manifestKey];

        if (fs.existsSync(destFile)) {
          if (!existingEntry) {
            // Arquivo existe no destino mas não consta no manifesto: não foi este
            // instalador que o gerou. Nunca sobrescreve nem deleta.
            skipped.push({ path: manifestKey, reason: 'unmanaged' });
            continue;
          }

          const destHash = hashFile(destFile);
          if (destHash !== existingEntry.sha256) {
            // Editado pelo usuário desde a última instalação: nunca sobrescreve sem
            // sinalizar.
            skipped.push({ path: manifestKey, reason: 'user-modified' });
            continue;
          }
        }

        fs.mkdirSync(path.dirname(destFile), { recursive: true });
        fs.copyFileSync(sourceFile, destFile);
        manifest.files[manifestKey] = { sha256: hashFile(sourceFile), engine: engine.id };
        copied.push(manifestKey);
      }
    }
  }

  writeManifest(projectRoot, manifest);
  return { copied, skipped };
}

module.exports = { installFiles, ENGINE_DEST_DIR, SOURCE_DIRS, defaultSourceRoot };
