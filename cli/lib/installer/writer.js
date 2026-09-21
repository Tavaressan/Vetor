'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { hashFile, hashContent, readManifest, writeManifest } = require('./manifest.js');
const { translateHooksForCursor } = require('./cursor-hooks.js');

// Decisão de escopo (issue #255): destino nativo por engine é o diretório-âncora já usado
// pela própria detecção (detector.js usa `.claude`/`.opencode`/`.cursor` como âncora;
// `.codex` e `.antigravity` seguem a mesma convenção por consistência, mesmo sem detecção
// por diretório própria hoje).
//
// Cursor (#256, ver wiki/Compatibilidade-Cursor.md): `.cursor/skills/` e `.cursor/agents/`
// são descobertos nativamente pelo Cursor sem tradução de formato (SKILL.md e agents/*.md já
// são agnósticos de engine desde #251) — cópia direta funciona de verdade para essas duas
// pastas. `hooks/` é tratado à parte (ver `installCursorHooks` abaixo, issue #284): o Cursor
// só carrega hooks de projeto em `.cursor/hooks.json` (arquivo único na raiz, schema próprio
// em camelCase), nunca `.cursor/hooks/hooks.json` (diretório, o formato que este writer copia
// para as demais engines) — por isso `hooks/hooks.json` é traduzido em memória
// (`cursor-hooks.js`) e gravado como arquivo único em vez de entrar no loop genérico de
// `SOURCE_DIRS` abaixo.
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

// Diretórios de SOURCE_DIRS que não devem ser copiados (cópia genérica byte-a-byte) para o
// destino de uma engine específica, mesmo existindo na fonte. Vazio hoje: a única exclusão que
// existia (Cursor, `hooks/`) virou tradução dedicada (`installCursorHooks`, issue #284) em vez
// de exclusão pura — `hooks` continua fora do loop genérico para o Cursor (ver o `continue`
// especial abaixo), só que agora produz `.cursor/hooks.json` de verdade, não mais nada.
const ENGINE_EXCLUDED_SOURCE_DIRS = {};

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
 * Núcleo de idempotência compartilhado por cópia genérica de arquivo e por
 * `installCursorHooks` (que grava conteúdo *traduzido*, não uma cópia byte-a-byte da fonte):
 * - Arquivo ausente no destino: escreve e manifesta.
 * - Arquivo presente e já manifestado com o mesmo hash do destino atual: seguro
 *   sobrescrever (não foi editado pelo usuário desde a última instalação) — sincroniza
 *   com a fonte/tradução, mesmo que o conteúdo produzido tenha mudado (isso é o "update
 *   seguro").
 * - Arquivo presente mas SEM entrada no manifesto, ou com hash divergente da entrada
 *   manifestada: não foi gerado por este instalador ou foi editado pelo usuário — NUNCA
 *   sobrescreve, só reporta como `skipped`.
 *
 * `contentHash` é o hash do conteúdo que `write()` vai efetivamente gravar (não
 * necessariamente o hash dos bytes da fonte — ver `installCursorHooks`), para que uma segunda
 * execução compare o destino contra o que este instalador realmente produziu.
 */
function writeManaged({ destFile, manifestKey, contentHash, write, engineId, manifest, copied, skipped }) {
  const existingEntry = manifest.files[manifestKey];

  if (fs.existsSync(destFile)) {
    if (!existingEntry) {
      // Arquivo existe no destino mas não consta no manifesto: não foi este
      // instalador que o gerou. Nunca sobrescreve nem deleta.
      skipped.push({ path: manifestKey, reason: 'unmanaged' });
      return;
    }

    const destHash = hashFile(destFile);
    if (destHash !== existingEntry.sha256) {
      // Editado pelo usuário desde a última instalação: nunca sobrescreve sem sinalizar.
      skipped.push({ path: manifestKey, reason: 'user-modified' });
      return;
    }
  }

  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  write();
  manifest.files[manifestKey] = { sha256: contentHash, engine: engineId };
  copied.push(manifestKey);
}

/**
 * Traduz `<sourceRoot>/hooks/hooks.json` (formato Claude Code) para o schema nativo do Cursor
 * e grava como arquivo único em `<destRootName>/hooks.json` (não `<destRootName>/hooks/...`,
 * que o Cursor não descobre — ver `cursor-hooks.js` e wiki/Compatibilidade-Cursor.md, issue
 * #284). Silenciosamente no-op se a fonte não existir (mesmo comportamento do loop genérico
 * para uma `sourceDir` ausente). Outros arquivos de `hooks/` (ex.: `hooks-codex.json`) não são
 * tocados — só `hooks.json` tem tradução para o Cursor.
 */
function installCursorHooks({ sourceRoot, projectRoot, destRootName, manifest, copied, skipped, warnings }) {
  const sourceFile = path.join(sourceRoot, 'hooks', 'hooks.json');
  if (!fs.existsSync(sourceFile)) return;

  const destFile = path.join(projectRoot, destRootName, 'hooks.json');
  const manifestKey = path.relative(projectRoot, destFile).split(path.sep).join('/');

  let sourceJson;
  try {
    sourceJson = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
  } catch (error) {
    // JSON inválido na fonte não pode derrubar toda a instalação (outras engines/dirs já
    // processados no mesmo loop perderiam a entrada no manifesto, ver writeManifest só no
    // final de installFiles) — reporta e segue.
    skipped.push({ path: manifestKey, reason: 'invalid-source' });
    warnings.push(`${manifestKey}: hooks/hooks.json não é JSON válido (${error.message})`);
    return;
  }

  const { hooks: translated, dropped } = translateHooksForCursor(sourceJson);
  const content = `${JSON.stringify(translated, null, 2)}\n`;

  for (const { event, reason } of dropped) {
    const description = reason === 'no-cursor-equivalent'
      ? `evento "${event}" sem equivalente no Cursor — não incluído em ${manifestKey}`
      : `matcher de "${event}" não é traduzível com fidelidade — hook mantido em ${manifestKey}, mas sem matcher (roda para todos os casos do evento)`;
    warnings.push(`${description} — ver wiki/Compatibilidade-Cursor.md`);
  }

  writeManaged({
    destFile,
    manifestKey,
    contentHash: hashContent(content),
    write: () => fs.writeFileSync(destFile, content, 'utf8'),
    engineId: 'cursor',
    manifest,
    copied,
    skipped,
  });
}

/**
 * Copia `skills/`, `agents/`, `hooks/` (fonte agnóstica de engine, #251) para o destino
 * nativo de cada engine selecionada (exceto exclusões de `ENGINE_EXCLUDED_SOURCE_DIRS`),
 * gravando manifesto de hash SHA-256 por arquivo copiado em `.vetor/install-manifest.json`
 * no projeto-alvo. `hooks/` para o Cursor é tratado à parte por `installCursorHooks` (issue
 * #284): não é uma cópia byte-a-byte, é uma tradução de schema + caminho de destino.
 *
 * Retorna `{ copied, skipped, warnings }` com os paths relativos ao projeto-alvo. `warnings`
 * cobre perdas parciais que não impedem a instalação (ex.: evento de hook sem tradução fiel
 * para uma engine, ver `installCursorHooks`) — vazio quando não há nada a avisar.
 */
function installFiles({ projectRoot, engines, sourceRoot = defaultSourceRoot() } = {}) {
  if (!projectRoot) {
    throw new Error('installFiles: "projectRoot" é obrigatório.');
  }

  const manifest = readManifest(projectRoot);
  const copied = [];
  const skipped = [];
  const warnings = [];

  for (const engine of engines ?? []) {
    const destRootName = ENGINE_DEST_DIR[engine.id];
    if (!destRootName) continue; // engine sem destino conhecido no mapa acima

    const excludedSourceDirs = ENGINE_EXCLUDED_SOURCE_DIRS[engine.id] ?? [];

    for (const sourceDirName of SOURCE_DIRS) {
      if (excludedSourceDirs.includes(sourceDirName)) continue;

      if (engine.id === 'cursor' && sourceDirName === 'hooks') {
        installCursorHooks({ sourceRoot, projectRoot, destRootName, manifest, copied, skipped, warnings });
        continue;
      }

      const sourceDir = path.join(sourceRoot, sourceDirName);
      if (!fs.existsSync(sourceDir)) continue;

      for (const sourceFile of listFilesRecursive(sourceDir)) {
        const relativeToSourceDir = path.relative(sourceDir, sourceFile);
        const destFile = path.join(projectRoot, destRootName, sourceDirName, relativeToSourceDir);
        const manifestKey = path.relative(projectRoot, destFile).split(path.sep).join('/');

        writeManaged({
          destFile,
          manifestKey,
          contentHash: hashFile(sourceFile),
          write: () => fs.copyFileSync(sourceFile, destFile),
          engineId: engine.id,
          manifest,
          copied,
          skipped,
        });
      }
    }
  }

  writeManifest(projectRoot, manifest);
  return { copied, skipped, warnings };
}

module.exports = {
  installFiles,
  ENGINE_DEST_DIR,
  SOURCE_DIRS,
  ENGINE_EXCLUDED_SOURCE_DIRS,
  defaultSourceRoot,
};
