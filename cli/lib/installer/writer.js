'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { hashFile, hashContent, readManifest, writeManifest } = require('./manifest.js');
const { translateHooksForCursor } = require('./cursor-hooks.js');
const { version: packageVersion } = require('../../package.json');

// Decisão de escopo (issue #255, revisada na #283): destino nativo por engine é o
// diretório-âncora já usado pela própria detecção (detector.js usa `.claude`/`.opencode`/
// `.cursor` como âncora; `.codex` segue a mesma convenção por consistência, mesmo sem
// detecção por diretório própria hoje).
//
// Cursor (#256, ver wiki/Compatibilidade-Cursor.md): `.cursor/skills/` e `.cursor/agents/`
// são descobertos nativamente pelo Cursor (`SKILL.md` é copiado direto; em `agents/*.md`,
// `model: haiku|sonnet` no frontmatter é traduzido para `model: inherit` — issue #396).
// `hooks/` é tratado à parte (ver `installCursorHooks` abaixo, issue #284): o Cursor
// só carrega hooks de projeto em `.cursor/hooks.json` (arquivo único na raiz, schema próprio
// em camelCase), nunca `.cursor/hooks/hooks.json` (diretório, o formato que este writer copia
// para as demais engines) — por isso `hooks/hooks.json` é traduzido em memória
// (`cursor-hooks.js`) e gravado como arquivo único em vez de entrar no loop genérico de
// `SOURCE_DIRS` abaixo.
//
// Skills do Cursor em diretório compartilhado (#479, revisa a "redundância aceita" do achado #4
// do code-review da PR #282): o Cursor lê skills de `.agents/skills/`, `.cursor/skills/` e,
// por compatibilidade, de `.claude/skills/` e `.codex/skills/` (cursor.com/docs/skills,
// consultada em 2026-10-23; a página não define precedência entre as raízes). Para não gravar
// uma terceira cópia, `resolveCursorSkillsRoot` manda as skills do Cursor para `.agents/` quando
// há Codex ou Antigravity, para `.claude/` quando há Claude Code, e só então para `.cursor/`.
// `.claude/skills/` continua sendo do Claude Code quando também há Codex/Antigravity. As skills
// são cópia byte-a-byte, então o dono extra entra na mesma entrada do manifesto
// (`engines`); agents e hooks do Cursor não mudam de lugar (formato próprio, ver abaixo).
//
// Antigravity (#283, revisada na #397): `.antigravity` era uma convenção assumida sem
// confirmação e foi removida na #283. A documentação oficial (`antigravity.google/docs/subagents`,
// consultada em 2026-10-15 e reconfirmada em 2026-10-19) e o binário `agy` (v1.2.10+/1.4.1)
// confirmam `.agents/` na raiz do workspace como destino project-local para customizações
// (`.agents/agents/<name>.md` para subagentes em Markdown com `model: inherit` e
// `.agents/skills/<name>/SKILL.md` para skills).
const ENGINE_DEST_DIR = {
  'claude-code': '.claude',
  codex: '.codex',
  opencode: '.opencode',
  antigravity: '.agents',
  cursor: '.cursor',
};

const SOURCE_DIRS = ['skills', 'agents', 'hooks'];

// Diretórios de SOURCE_DIRS que não devem ser copiados (cópia genérica byte-a-byte) para o
// destino de uma engine específica, mesmo existindo na fonte, porque o resultado é
// comprovadamente inerte.
//
// - Cursor: `hooks/` NÃO entra aqui — virou tradução dedicada (`installCursorHooks`, issue
//   #284) em vez de exclusão pura. O loop genérico de SOURCE_DIRS trata `cursor`+`hooks`
//   como caso especial (ver o `continue` dedicado abaixo) antes mesmo de chegar a esta
//   lista, produzindo `.cursor/hooks.json` de verdade — colocar `cursor` aqui excluiria
//   `hooks` antes desse caso especial rodar.
// - OpenCode (#283): `skills/`, `agents/`, `hooks/` inteiros, porque o OpenCode tem
//   árvore-fonte própria já traduzida para o seu formato (ver `ENGINE_NATIVE_SOURCE_DIR`
//   abaixo) — copiar os genéricos produziria skills inertes (referenciam
//   `$CLAUDE_PLUGIN_ROOT`, variável que o OpenCode não define), um diretório `agents/`
//   (plural) que o OpenCode não escaneia (ele usa `agent/`, singular) e hooks em JSON
//   declarativo onde o OpenCode espera plugin TS (`tool.execute.before/after`). Ver
//   wiki/Compatibilidade-OpenCode.md.
// - Antigravity (#397): `hooks/` (cujo `hooks/hooks.json` usa schema Claude Code e
//   `${CLAUDE_PLUGIN_ROOT}`; no Antigravity o arquivo de workspace é `.agents/hooks.json`
//   na raiz de `.agents/`, nunca o diretório `.agents/hooks/hooks.json`).
const ENGINE_EXCLUDED_SOURCE_DIRS = {
  opencode: ['skills', 'agents', 'hooks'],
  antigravity: ['hooks'],
};

const ENGINE_SOURCE_DIR_DEST = {
  // Codex descobre skills locais em `.agents/skills` (https://learn.chatgpt.com/docs/build-skills;
  // consultada em 2026-10-21); agentes e hooks continuam sob `.codex/`.
  codex: { skills: '.agents' },
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

// Formatos de subagente coexistem em `agents/`: `agents/<nome>.md` (Claude Code, Cursor e
// Antigravity — Markdown nativo com `model: inherit`, #397) e
// `agents/<nome>/codex.toml` (Codex — ver wiki/Compatibilidade-Codex.md, ".codex/agents/
// (projeto)"). Cada engine só reconhece o seu formato; copiar os outros junto (comportamento
// anterior à #283) produz arquivo inerte no destino. Este mapa filtra e, quando necessário,
// traduz o path (achata `<nome>/codex.toml` para `<nome>.toml`, que é o path plano que o
// Codex espera em `.codex/agents/`). Engine sem entrada aqui mantém o path original (só
// `SOURCE_DIRS` decide se `agents/` entra em jogo para ela).
const ENGINE_AGENT_FILE_MAP = {
  'claude-code': (relPath) => (relPath.endsWith('.md') ? relPath : null),
  cursor: (relPath) => (relPath.endsWith('.md') ? relPath : null),
  antigravity: (relPath) => (relPath.endsWith('.md') ? relPath : null),
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

function ownersOf(entry) {
  return entry.engines ?? [entry.engine];
}

// Arquivo compartilhado por várias engines é tentado uma vez por dono: reporta uma vez só.
function pushSkipped(skipped, key, reason) {
  if (!skipped.some((entry) => entry.path === key)) skipped.push({ path: key, reason });
}

// Raiz (`.agents`, `.claude` ou `.cursor`) onde as skills do Cursor são gravadas, dado o
// conjunto de engines presentes (seleção atual mais as já registradas no manifesto, para que
// `install` e `update` cheguem ao mesmo destino).
function resolveCursorSkillsRoot(engineIds) {
  if (engineIds.has('codex') || engineIds.has('antigravity')) return '.agents';
  if (engineIds.has('claude-code')) return '.claude';
  return '.cursor';
}

// Remove diretórios vazios de `startDir` até `stopDir` (inclusive), sem subir além dele.
function removeEmptyDirsUpTo(startDir, stopDir) {
  let dir = startDir;
  while (dir === stopDir || dir.startsWith(stopDir + path.sep)) {
    if (fs.readdirSync(dir).length) return;
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
}

const SKILLS_KEY_PATTERN = /^(\.cursor|\.agents|\.claude)\/skills\/(.+)$/;

/**
 * Leva para `targetRoot` as skills que só o Cursor usa e que estão em outra raiz de skills
 * (legado `.cursor/skills/`, ou `.agents/`/`.claude/` depois de um `uninstall --engines` que
 * deixou o Cursor como único dono). Só migra arquivo íntegro (hash igual ao do manifesto):
 * - editado pelo usuário: preservado, com aviso, e a entrada antiga continua no manifesto;
 * - destino já existente que não é gerenciado nem íntegro: nada é sobrescrito, ambos ficam,
 *   com aviso, e o Cursor não é registrado como dono do destino (dono não verificado);
 * - destino gerenciado e íntegro: a cópia antiga é descartada e o Cursor vira dono do destino;
 * - destino ausente: o arquivo é movido.
 * Retorna os pares `{ from, to }` migrados.
 */
function migrateCursorSkills({ projectRoot, manifest, targetRoot, warnings, skipped }) {
  const migrated = [];

  for (const [oldKey, entry] of Object.entries(manifest.files)) {
    const match = oldKey.match(SKILLS_KEY_PATTERN);
    if (!match || match[1] === targetRoot) continue;
    const owners = ownersOf(entry);
    if (owners.length !== 1 || owners[0] !== 'cursor') continue;
    if (match[2].split(/[\\/]/).includes('..')) continue;

    const newKey = `${targetRoot}/skills/${match[2]}`;
    const oldFile = path.join(projectRoot, ...oldKey.split('/'));
    const newFile = path.join(projectRoot, ...newKey.split('/'));

    if (!fs.existsSync(oldFile)) {
      delete manifest.files[oldKey];
      continue;
    }
    if (hashFile(oldFile) !== entry.sha256) {
      warnings.push(`${oldKey}: arquivo editado pelo usuário; migração para ${targetRoot}/skills/ ignorada (o Cursor lê as duas cópias).`);
      skipped.push({ path: oldKey, reason: 'user-modified' });
      continue;
    }

    const targetEntry = manifest.files[newKey];
    if (fs.existsSync(newFile)) {
      if (!targetEntry || hashFile(newFile) !== targetEntry.sha256) {
        warnings.push(`${newKey}: destino existente não gerenciado ou editado; migração de ${oldKey} ignorada.`);
        skipped.push({ path: oldKey, reason: 'migration-blocked' });
        continue;
      }
      fs.rmSync(oldFile);
      targetEntry.engines = [...new Set([...ownersOf(targetEntry), 'cursor'])];
    } else {
      const targetOwners = targetEntry ? ownersOf(targetEntry) : [];
      fs.mkdirSync(path.dirname(newFile), { recursive: true });
      fs.renameSync(oldFile, newFile);
      manifest.files[newKey] = {
        sha256: entry.sha256,
        engine: targetOwners[0] ?? 'cursor',
        engines: [...new Set([...targetOwners, 'cursor'])],
      };
    }

    delete manifest.files[oldKey];
    removeEmptyDirsUpTo(path.dirname(oldFile), path.join(projectRoot, match[1], 'skills'));
    migrated.push({ from: oldKey, to: newKey });
  }

  return migrated;
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
      pushSkipped(skipped, manifestKey, 'unmanaged');
      return;
    }

    const destHash = hashFile(destFile);
    if (destHash !== existingEntry.sha256) {
      // Editado pelo usuário desde a última instalação: nunca sobrescreve sem sinalizar.
      pushSkipped(skipped, manifestKey, 'user-modified');
      return;
    }
    const owners = existingEntry.engines ?? [existingEntry.engine];
    if (destHash === hashFile(sourceFile) && !owners.includes(engineId)) {
      existingEntry.engines = [...new Set([...owners, engineId])];
      return;
    }
  }

  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.copyFileSync(sourceFile, destFile);
  const existingEngines = existingEntry?.engines ?? (existingEntry?.engine ? [existingEntry.engine] : []);
  manifest.files[manifestKey] = {
    sha256: hashFile(sourceFile),
    engine: existingEngines[0] ?? engineId,
    engines: [...new Set([...existingEngines, engineId])],
  };
  if (!copied.includes(manifestKey)) copied.push(manifestKey);
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
      pushSkipped(skipped, manifestKey, 'unmanaged');
      return;
    }

    const destHash = hashFile(destFile);
    if (destHash !== existingEntry.sha256) {
      // Editado pelo usuário desde a última instalação: nunca sobrescreve sem sinalizar.
      pushSkipped(skipped, manifestKey, 'user-modified');
      return;
    }
    const owners = existingEntry.engines ?? [existingEntry.engine];
    if (destHash === contentHash && !owners.includes(engineId)) {
      existingEntry.engines = [...new Set([...owners, engineId])];
      return;
    }
  }

  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  write();
  const existingEngines = existingEntry?.engines ?? (existingEntry?.engine ? [existingEntry.engine] : []);
  manifest.files[manifestKey] = {
    sha256: contentHash,
    engine: existingEngines[0] ?? engineId,
    engines: [...new Set([...existingEngines, engineId])],
  };
  if (!copied.includes(manifestKey)) copied.push(manifestKey);
}

// Cursor (#396, ver wiki/Compatibilidade-Cursor.md): `cursor.com/docs/subagents` (consultada em
// 2026-10-15) lista só `inherit` ou um ID específico para `model` no frontmatter de `.cursor/agents/*.md`,
// enquanto os `agents/*.md` da fonte usam os aliases `haiku`/`sonnet` do Claude Code.
function translateAgentForCursor(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---/, (frontmatter) =>
    frontmatter.replace(/^model:[ \t]*(?:haiku|sonnet)(?=\r?$)/gm, 'model: inherit'),
  );
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
 * nativo de cada engine selecionada — com tradução de formato/path por engine quando
 * necessário (ver `ENGINE_AGENT_FILE_MAP`, `ENGINE_NATIVE_SOURCE_DIR`,
 * `ENGINE_EXCLUDED_SOURCE_DIRS`) — gravando manifesto de hash SHA-256 por arquivo copiado
 * em `.vetor/install-manifest.json` no projeto-alvo. `hooks/` para o Cursor é tratado à
 * parte por `installCursorHooks` (issue #284): não é uma cópia byte-a-byte, é uma tradução
 * de schema + caminho de destino.
 *
 * Idempotente e seguro para update (ver `copyManagedFile`/`writeManaged`).
 *
 * Engine sem destino conhecido (ex.: Antigravity, #283 — sem âncora de projeto confirmada)
 * não é silenciosamente ignorada: entra em `enginesSkipped` para o chamador reportar ao
 * usuário.
 *
 * Retorna `{ copied, skipped, warnings, enginesSkipped, migrated }` com os paths relativos ao
 * projeto-alvo. `warnings` cobre perdas parciais que não impedem a instalação (ex.: evento
 * de hook sem tradução fiel para uma engine, ver `installCursorHooks`) — vazio quando não há
 * nada a avisar. `migrated` lista os `{ from, to }` de skills do Cursor movidas para a raiz de
 * skills compartilhada (ver `migrateCursorSkills`).
 */
function installFiles({ projectRoot, engines, sourceRoot = defaultSourceRoot() } = {}) {
  if (!projectRoot) {
    throw new Error('installFiles: "projectRoot" é obrigatório.');
  }

  const manifest = readManifest(projectRoot);
  manifest.packageVersion = packageVersion;
  const copied = [];
  const skipped = [];
  const warnings = [];
  const enginesSkipped = [];
  const migrationBlockedTargets = new Set();
  const migrated = [];

  // Engines presentes = seleção desta chamada + as já registradas no manifesto, para que
  // `install` e `update` (que parte só do manifesto) escolham a mesma raiz de skills do Cursor.
  const presentEngineIds = new Set([
    ...(engines ?? []).map((engine) => engine.id),
    ...Object.values(manifest.files).flatMap(ownersOf),
  ]);
  const cursorSkillsRoot = resolveCursorSkillsRoot(presentEngineIds);

  // Migra somente skills legadas intactas, identificadas pelo hash do manifesto.
  // Se foram alteradas, preserva a cópia antiga e não cria uma duplicata gerenciada.
  const codexSelected = (engines ?? []).some((engine) => engine.id === 'codex');
  if (codexSelected) {
    for (const [oldKey, entry] of Object.entries(manifest.files)) {
      if (!oldKey.startsWith('.codex/skills/')) continue;
      const relativeOld = oldKey.slice('.codex/skills/'.length);
      if (path.posix.isAbsolute(oldKey) || relativeOld.split(/[\\/]/).includes('..')) continue;
      const oldFile = path.join(projectRoot, ...oldKey.split('/'));
      if (!fs.existsSync(oldFile)) { delete manifest.files[oldKey]; continue; }
      if (hashFile(oldFile) !== entry.sha256) {
        warnings.push(`${oldKey}: arquivo editado pelo usuário; migração para .agents/skills/ ignorada.`);
        migrationBlockedTargets.add(oldKey.replace(/^\.codex\/skills\//, '.agents/skills/'));
        continue;
      }
      const newKey = oldKey.replace(/^\.codex\/skills\//, '.agents/skills/');
      const newFile = path.join(projectRoot, ...newKey.split('/'));
      if (fs.existsSync(newFile)) {
        const targetEntry = manifest.files[newKey];
        if (targetEntry && hashFile(newFile) === targetEntry.sha256 && hashFile(oldFile) === entry.sha256) {
          fs.rmSync(oldFile);
          targetEntry.engines = [...new Set([...(targetEntry.engines ?? [targetEntry.engine]), 'codex'])];
          delete manifest.files[oldKey];
          let oldDir = path.dirname(oldFile);
          const oldSkillsRoot = path.join(projectRoot, '.codex', 'skills');
          while (oldDir.startsWith(oldSkillsRoot)) {
            if (fs.readdirSync(oldDir).length) break;
            fs.rmdirSync(oldDir);
            if (oldDir === oldSkillsRoot) break;
            oldDir = path.dirname(oldDir);
          }
        } else {
          warnings.push(`${newKey}: destino existente; migração de ${oldKey} ignorada.`);
          migrationBlockedTargets.add(newKey);
        }
        continue;
      }
      fs.mkdirSync(path.dirname(newFile), { recursive: true });
      fs.renameSync(oldFile, newFile);
      manifest.files[newKey] = entry;
      delete manifest.files[oldKey];
      let oldDir = path.dirname(oldFile);
      const oldSkillsRoot = path.join(projectRoot, '.codex', 'skills');
      while (oldDir.startsWith(oldSkillsRoot)) {
        if (fs.readdirSync(oldDir).length) break;
        fs.rmdirSync(oldDir);
        if (oldDir === oldSkillsRoot) break;
        oldDir = path.dirname(oldDir);
      }
    }
  }

  // Depois da migração do Codex: ambas podem ter `.agents/skills/` como destino.
  if ((engines ?? []).some((engine) => engine.id === 'cursor')) {
    migrated.push(...migrateCursorSkills({
      projectRoot, manifest, targetRoot: cursorSkillsRoot, warnings, skipped,
    }));
  }

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

      if (engine.id === 'cursor' && sourceDirName === 'hooks') {
        installCursorHooks({ sourceRoot, projectRoot, destRootName, manifest, copied, skipped, warnings });
        continue;
      }

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

        const sourceDestRoot = engine.id === 'cursor' && sourceDirName === 'skills'
          ? cursorSkillsRoot
          : ENGINE_SOURCE_DIR_DEST[engine.id]?.[sourceDirName] ?? destRootName;
        const destFile = path.join(projectRoot, sourceDestRoot, sourceDirName, destRelativePath);
        const manifestKey = path.relative(projectRoot, destFile).split(path.sep).join('/');
        if (engine.id === 'codex' && migrationBlockedTargets.has(manifestKey)) {
          skipped.push({ path: manifestKey, reason: 'migration-blocked' });
          continue;
        }
        if (engine.id === 'cursor' && sourceDirName === 'agents') {
          const content = translateAgentForCursor(fs.readFileSync(sourceFile, 'utf8'));
          writeManaged({
            destFile,
            manifestKey,
            contentHash: hashContent(content),
            write: () => fs.writeFileSync(destFile, content, 'utf8'),
            engineId: engine.id,
            manifest,
            copied,
            skipped,
          });
          continue;
        }
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
  return { copied, skipped, warnings, enginesSkipped, migrated };
}

module.exports = {
  installFiles,
  ENGINE_DEST_DIR,
  ENGINE_SOURCE_DIR_DEST,
  SOURCE_DIRS,
  ENGINE_EXCLUDED_SOURCE_DIRS,
  ENGINE_NATIVE_SOURCE_DIR,
  ENGINE_AGENT_FILE_MAP,
  defaultSourceRoot,
};
