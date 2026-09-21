'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { hashFile, readManifest, writeManifest } = require('./manifest.js');

// Decisão de escopo (issue #255): destino nativo por engine é o diretório-âncora já usado
// pela própria detecção (detector.js usa `.claude`/`.opencode`/`.cursor` como âncora;
// `.codex` e `.antigravity` seguem a mesma convenção por consistência, mesmo sem detecção
// por diretório própria hoje).
//
// Cursor (#256, ver wiki/Compatibilidade-Cursor.md): `.cursor/skills/` e `.cursor/agents/`
// são descobertos nativamente pelo Cursor sem tradução de formato (SKILL.md e agents/*.md já
// são agnósticos de engine desde #251) — cópia direta funciona de verdade para essas duas
// pastas. `hooks/` NÃO é copiado para o destino do Cursor (ver `ENGINE_EXCLUDED_SOURCE_DIRS`
// abaixo): a wiki confirma que o Cursor só carrega hooks de projeto em `.cursor/hooks.json`
// (arquivo único na raiz), nunca `.cursor/hooks/hooks.json` (diretório, o formato que este
// writer produz para as demais engines) — copiar e reportar como `copied` seria enganoso,
// já que o arquivo copiado é inerte. Tradução de schema de payload (camelCase, campos por
// evento diferentes do Claude Code) e de caminho fica para trabalho futuro.
//
// Redundância conhecida e aceita (YAGNI, achado #4 do code-review da PR #282): quando
// Claude Code E Cursor estão ambos selecionados, `skills/`/`agents/` são copiados tanto
// para `.claude/` quanto para `.cursor/`, mesmo a wiki confirmando que o Cursor já lê
// `.claude/skills/`/`.claude/agents/` nativamente para compatibilidade (ver
// wiki/Compatibilidade-Cursor.md). Deduplicar exigiria decidir qual engine é a "fonte da
// verdade" em disco e como reagir a edição de só uma das cópias — complexidade/risco maior
// que o custo de ter uma cópia extra em disco. Não implementado de propósito.
//
// Simplificação assumida e documentada (ver handoff da issue): copia-se `skills/`,
// `agents/`, `hooks/` inteiros e agnósticos (#251) para `<destino-da-engine>/<pasta>/...`,
// igual para todas as engines (exceto as exclusões declaradas em
// `ENGINE_EXCLUDED_SOURCE_DIRS`). Adaptação fina por formato — ex. Codex exige subagentes em
// `.codex/agents/*.toml` (não `agents/*.md`), OpenCode tem árvore-fonte própria em
// `opencode/` (não `skills/`/`agents/`/`hooks/`) — é gap conhecido, fora do escopo deste
// writer (mecanismo de cópia + manifesto); só a política de destino evolui depois.
const ENGINE_DEST_DIR = {
  'claude-code': '.claude',
  codex: '.codex',
  opencode: '.opencode',
  antigravity: '.antigravity',
  cursor: '.cursor',
};

const SOURCE_DIRS = ['skills', 'agents', 'hooks'];

// Diretórios de SOURCE_DIRS que não devem ser copiados para o destino de uma engine
// específica, mesmo existindo na fonte. Hoje só o Cursor: `hooks/` copiado para
// `.cursor/hooks/...` é comprovadamente inerte (ver comentário acima e
// wiki/Compatibilidade-Cursor.md) — reportar como `copied` seria enganoso.
const ENGINE_EXCLUDED_SOURCE_DIRS = {
  cursor: ['hooks'],
};

// cli/lib/installer/writer.js -> cli/lib -> cli (raiz do pacote, tanto em dev quanto no
// pacote npm publicado, onde "cli/" é achatado para a raiz do pacote).
//
// Decide entre a raiz do monorepo e `templates/` (populado por
// `cli/scripts/sync-templates.js` via hook `prepack` do npm, ver #255 redespacho) por um
// marcador, não por "templates/ tem conteúdo": `plugin.json` só existe na raiz do monorepo
// Vetor, nunca no pacote publicado nem em node_modules de um projeto-alvo qualquer. Isso
// evita dois problemas:
// - Falso-positivo: checar só "skills/ existe um nível acima" arriscaria ler o `skills/`
//   do próprio projeto-alvo do usuário como se fosse a fonte do Vetor.
// - Deriva em dev: se a decisão fosse "usa templates/ quando tiver conteúdo", um
//   dev editando `skills/` na raiz e rodando `vetor install` logo depois de qualquer
//   `npm test` (que já roda o sync via prepack) leria o snapshot congelado de
//   templates/, não a edição viva — o mesmo tipo de deriva que a automação do sync
//   existe para evitar, só que realocada para o runtime do installer.
// Em dev, a raiz do monorepo (sempre viva) vence. Só no pacote publicado, sem o marcador,
// cai para `templates/`.
//
// `packageRoot` é injetável só para teste (evita depender do `cli/templates/` real, que
// outros testes também sincronizam via prepack — ver sync-templates.test.js).
function defaultSourceRoot({ packageRoot = path.join(__dirname, '..', '..') } = {}) {
  const monorepoRoot = path.join(packageRoot, '..');
  const isMonorepoCheckout = fs.existsSync(path.join(monorepoRoot, 'plugin.json'));
  if (isMonorepoCheckout) return monorepoRoot;

  return path.join(packageRoot, 'templates');
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
 * nativo de cada engine selecionada (exceto exclusões de `ENGINE_EXCLUDED_SOURCE_DIRS`),
 * gravando manifesto de hash SHA-256 por arquivo copiado em `.vetor/install-manifest.json`
 * no projeto-alvo.
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
    if (!destRootName) continue; // engine sem destino conhecido no mapa acima

    const excludedSourceDirs = ENGINE_EXCLUDED_SOURCE_DIRS[engine.id] ?? [];

    for (const sourceDirName of SOURCE_DIRS) {
      if (excludedSourceDirs.includes(sourceDirName)) continue;

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

module.exports = {
  installFiles,
  ENGINE_DEST_DIR,
  SOURCE_DIRS,
  ENGINE_EXCLUDED_SOURCE_DIRS,
  defaultSourceRoot,
};
