'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { hashFile, readManifest, writeManifest } = require('./manifest.js');

// Decisão de escopo (issue #255, revisada na #283): destino nativo por engine é o
// diretório-âncora já usado pela própria detecção (detector.js usa `.claude`/`.opencode`/
// `.cursor` como âncora; `.codex` segue a mesma convenção por consistência, mesmo sem
// detecção por diretório própria hoje).
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
// Antigravity (#283): removida de ENGINE_DEST_DIR. `.antigravity` era uma convenção
// assumida sem confirmação (ver detector.js, que já não usa esse diretório como âncora de
// detecção — só o comando `agy` no PATH). Investigação nesta issue com o CLI `agy` real
// instalado (`agy plugin validate .`, `agy plugin list`) confirma que a distribuição de
// plugin do Antigravity não é "copiar skills/agents/hooks para um diretório de projeto":
// é `agy plugin install/import` lendo um `plugin.json` na RAIZ do plugin (mesmo schema
// `antigravity.google/schemas/v1/plugin.json` já usado por este repo) e registrando o
// import num manifesto global do usuário (`~/.gemini/antigravity-cli/settings.json`), não
// num diretório de projeto-alvo. Não existe hoje um segundo mecanismo de "instalação
// project-local" documentado ou observado para o Antigravity equivalente a `.claude/` do
// Claude Code — copiar arquivos para um `.antigravity/` inventado produziria uma pasta que
// o Antigravity nunca lê. Engine sem destino conhecido cai em `enginesSkipped` (ver
// `installFiles`), reportado ao usuário em vez de silenciosamente não fazer nada.
const ENGINE_DEST_DIR = {
  'claude-code': '.claude',
  codex: '.codex',
  opencode: '.opencode',
  cursor: '.cursor',
};

const SOURCE_DIRS = ['skills', 'agents', 'hooks'];

// Diretórios de SOURCE_DIRS que não devem ser copiados para o destino de uma engine
// específica, mesmo existindo na fonte, porque o resultado é comprovadamente inerte.
//
// - Cursor: `hooks/` copiado para `.cursor/hooks/...` (ver comentário acima e
//   wiki/Compatibilidade-Cursor.md) — o Cursor só lê `.cursor/hooks.json` (arquivo único).
// - OpenCode (#283): `skills/`, `agents/`, `hooks/` inteiros, porque o OpenCode tem
//   árvore-fonte própria já traduzida para o seu formato (ver `ENGINE_NATIVE_SOURCE_DIR`
//   abaixo) — copiar os genéricos produziria skills inertes (referenciam
//   `$CLAUDE_PLUGIN_ROOT`, variável que o OpenCode não define), um diretório `agents/`
//   (plural) que o OpenCode não escaneia (ele usa `agent/`, singular) e hooks em JSON
//   declarativo onde o OpenCode espera plugin TS (`tool.execute.before/after`). Ver
//   wiki/Compatibilidade-OpenCode.md.
const ENGINE_EXCLUDED_SOURCE_DIRS = {
  cursor: ['hooks'],
  opencode: ['skills', 'agents', 'hooks'],
};

// OpenCode (#283): em vez dos SOURCE_DIRS agnósticos, copia a árvore `opencode/` (já
// adaptada ao formato nativo — `opencode/agent/*.md`, `opencode/skills/*/SKILL.md`,
// `opencode/plugin/*.ts`, `opencode/scripts/*`) para a raiz do destino, achatada (não
// aninhada em `.opencode/opencode/...`). Mesmo mecanismo de instalação manual documentado
// em wiki/Compatibilidade-OpenCode.md (`cp -r opencode/. <projeto>/.opencode/`), só que
// via `vetor install` com o mesmo controle de manifesto/update seguro das demais engines.
// `opencode/mcp.jsonc` é copiado como referência; o merge do bloco `mcp` em
// `opencode.json` do projeto-alvo continua manual (documentado na wiki) — automatizar
// merge de JSON de config alheio está fora de escopo (YAGNI).
const ENGINE_NATIVE_SOURCE_DIR = {
  opencode: 'opencode',
};

// Formatos de subagente coexistem em `agents/`: `agents/<nome>.md` (Claude Code e Cursor —
// agnóstico de engine desde #251), `agents/<nome>/agent.json` (Antigravity) e
// `agents/<nome>/codex.toml` (Codex — ver wiki/Compatibilidade-Codex.md, ".codex/agents/
// (projeto)"). Cada engine só reconhece o seu formato; copiar os outros junto (comportamento
// anterior à #283) produz arquivo inerte no destino. Este mapa filtra e, quando necessário,
// traduz o path (achata `<nome>/codex.toml` para `<nome>.toml`, que é o path plano que o
// Codex espera em `.codex/agents/`). Engine sem entrada aqui mantém o path original (só
// `SOURCE_DIRS` decide se `agents/` entra em jogo para ela).
const ENGINE_AGENT_FILE_MAP = {
  'claude-code': (relPath) => (relPath.endsWith('.md') ? relPath : null),
  cursor: (relPath) => (relPath.endsWith('.md') ? relPath : null),
  codex: (relPath) => {
    const match = relPath.match(/^([^/\\]+)[/\\]codex\.toml$/);
    return match ? `${match[1]}.toml` : null;
  },
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

// Copia um único arquivo para o destino aplicando a mesma política de update seguro para
// todas as engines/origens (SOURCE_DIRS agnósticos ou árvore nativa de uma engine):
// arquivo ausente copia e manifesta; presente e íntegro (hash bate com o manifesto)
// sincroniza; presente sem entrada no manifesto ou com hash divergente nunca é
// sobrescrito, só reportado em `skipped`.
function copyManagedFile({ sourceFile, destFile, manifestKey, manifest, engineId, copied, skipped }) {
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
  fs.copyFileSync(sourceFile, destFile);
  manifest.files[manifestKey] = { sha256: hashFile(sourceFile), engine: engineId };
  copied.push(manifestKey);
}

/**
 * Copia `skills/`, `agents/`, `hooks/` (fonte agnóstica de engine, #251) para o destino
 * nativo de cada engine selecionada — com tradução de formato/path por engine quando
 * necessário (ver `ENGINE_AGENT_FILE_MAP`, `ENGINE_NATIVE_SOURCE_DIR`,
 * `ENGINE_EXCLUDED_SOURCE_DIRS`) — gravando manifesto de hash SHA-256 por arquivo copiado
 * em `.vetor/install-manifest.json` no projeto-alvo.
 *
 * Idempotente e seguro para update (ver `copyManagedFile`).
 *
 * Engine sem destino conhecido (ex.: Antigravity, #283 — sem âncora de projeto confirmada)
 * não é silenciosamente ignorada: entra em `enginesSkipped` para o chamador reportar ao
 * usuário.
 *
 * Retorna `{ copied, skipped, enginesSkipped }` com os paths relativos ao projeto-alvo.
 */
function installFiles({ projectRoot, engines, sourceRoot = defaultSourceRoot() } = {}) {
  if (!projectRoot) {
    throw new Error('installFiles: "projectRoot" é obrigatório.');
  }

  const manifest = readManifest(projectRoot);
  const copied = [];
  const skipped = [];
  const enginesSkipped = [];

  for (const engine of engines ?? []) {
    const destRootName = ENGINE_DEST_DIR[engine.id];
    if (!destRootName) {
      enginesSkipped.push({
        id: engine.id,
        name: engine.name,
        reason: 'no-verified-project-anchor',
      });
      continue;
    }

    const nativeSourceDirName = ENGINE_NATIVE_SOURCE_DIR[engine.id];
    if (nativeSourceDirName) {
      // Engine com árvore-fonte própria (ex.: OpenCode): copia tudo, achatado, sem passar
      // pelos SOURCE_DIRS agnósticos abaixo.
      const nativeSourceDir = path.join(sourceRoot, nativeSourceDirName);
      if (fs.existsSync(nativeSourceDir)) {
        for (const sourceFile of listFilesRecursive(nativeSourceDir)) {
          const relativeToSourceDir = path.relative(nativeSourceDir, sourceFile);
          const destFile = path.join(projectRoot, destRootName, relativeToSourceDir);
          const manifestKey = path.relative(projectRoot, destFile).split(path.sep).join('/');
          copyManagedFile({
            sourceFile,
            destFile,
            manifestKey,
            manifest,
            engineId: engine.id,
            copied,
            skipped,
          });
        }
      }
      continue;
    }

    const excludedSourceDirs = ENGINE_EXCLUDED_SOURCE_DIRS[engine.id] ?? [];
    const mapAgentFile = ENGINE_AGENT_FILE_MAP[engine.id];

    for (const sourceDirName of SOURCE_DIRS) {
      if (excludedSourceDirs.includes(sourceDirName)) continue;

      const sourceDir = path.join(sourceRoot, sourceDirName);
      if (!fs.existsSync(sourceDir)) continue;

      for (const sourceFile of listFilesRecursive(sourceDir)) {
        const relativeToSourceDir = path.relative(sourceDir, sourceFile);

        let destRelativePath = relativeToSourceDir;
        if (sourceDirName === 'agents' && mapAgentFile) {
          const mapped = mapAgentFile(relativeToSourceDir);
          if (!mapped) continue; // formato de subagente que esta engine não reconhece
          destRelativePath = mapped;
        }

        const destFile = path.join(projectRoot, destRootName, sourceDirName, destRelativePath);
        const manifestKey = path.relative(projectRoot, destFile).split(path.sep).join('/');
        copyManagedFile({
          sourceFile,
          destFile,
          manifestKey,
          manifest,
          engineId: engine.id,
          copied,
          skipped,
        });
      }
    }
  }

  writeManifest(projectRoot, manifest);
  return { copied, skipped, enginesSkipped };
}

module.exports = {
  installFiles,
  ENGINE_DEST_DIR,
  SOURCE_DIRS,
  ENGINE_EXCLUDED_SOURCE_DIRS,
  ENGINE_NATIVE_SOURCE_DIR,
  ENGINE_AGENT_FILE_MAP,
  defaultSourceRoot,
};
