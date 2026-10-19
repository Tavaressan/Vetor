# Compatibilidade — Antigravity

Fontes consultadas:
- Documentação oficial de subagentes (`https://antigravity.google/docs/subagents` / `https://antigravity.google/docs/subagents.md`, consultada em 2026-10-15 no spike da #337 e reconfirmada em 2026-10-19 na #397).
- Documentação oficial de plugins (`https://antigravity.google/docs/plugins` / `https://antigravity.google/docs/plugins.md`, consultada em 2026-10-19 na #397).
- CLI `agy` instalado localmente (`agy plugin validate .`, v1.4.1, verificado em 2026-10-19).

## Hooks

**Claude Code** (`hooks/hooks.json`):
- ✅ `PreToolUse`, `PostToolUse`, `SubagentStop`, `SessionStart`, `WorktreeCreate`
- **Proteção**: completa. Bloqueia escrita fora do worktree, obriga status file em estado terminal, injeta diagnostics de edição

**Antigravity** (`hooks.json` na raiz):
- ✅ `PreToolUse` (suportado e configurado)
- ⚠️ `PostToolUse` (evento existe no Antigravity, mas **não está configurado** no `hooks.json`)
- ❌ `SubagentStop` (não existe. Antigravity tem um evento `Stop` genérico, mas não específico a subagentes; não é equivalente)
- ❌ `SessionStart` (não suportado)
- ❌ `WorktreeCreate` (não suportado)
- **Proteção**: reduzida. Apenas prévia de push/escrita via `PreToolUse`; **sem** diagnostics de edição ou garantia de status file

Para usar o Vetor com Antigravity, a restrição crítica é que workers podem escrever fora do worktree (além do `status file`), encerrar sem preenchê-lo, e não recebem feedback de tipo. Recomenda-se manter a invocação manual (`/vetor:fix`, `/vetor:ship`) e **não usar `/vetor:coordinator`** com dispatch em background até que Antigravity suporte os eventos faltantes.

## Subagentes em Markdown nativo e `model: inherit` (issues #337 e #397)

Confirmado em `https://antigravity.google/docs/subagents` e `https://antigravity.google/docs/plugins` (consultadas em 2026-10-15 e 2026-10-19) e validado contra `agy plugin validate .` (v1.4.1):

- **Formato nativo:** arquivos Markdown (`.md`) com frontmatter YAML (`name`, `description`, `tools` como `string[]`, `skills`/`plugins` como `string[]`, `model` como `inherit` | `flash` | `pro`, `subagent`, `mainAgent`, `commandExecutionPolicy`, `mcpServers`).
- **Aposentadoria de `agents/*/agent.json`:** builds públicas/externas do Antigravity ignoram `agent.json` (`⚠ agents/<name>/agent.json: never loaded by this build: only internal builds read agent.json; write the agent as agent.md`). Os arquivos `agents/issue-worker/agent.json` e `agents/code-review/agent.json` foram removidos na #397.
- **Locais de descoberta oficiais:**
  - **Workspace / Projeto:** `.agents/agents/<name>.md` ou `.agents/agents/<name>/agent.md` (na raiz do repositório). Skills de workspace seguem a mesma raiz em `.agents/skills/<name>/SKILL.md`.
  - **Global (usuário):** `~/.gemini/config/agents/<name>.md` ou `~/.gemini/config/agents/<name>/agent.md`.
  - **Plugin (`plugin.json` na raiz):** `agents/<name>.md` (ou `agents/<name>/agent.md`), validado por `agy plugin validate .`. Quando `agents/<name>.md` e `agents/<name>/agent.md` coexistem no mesmo diretório `agents/`, o loader carrega `<name>.md` e emite `skipped` para `<name>/agent.md` por duplicidade de `name`.
- **Frontmatter compartilhado em `agents/issue-worker.md` e `agents/code-review.md`:**
  - `model: inherit` é o padrão adotado para os agentes do Vetor (decisão da #337 em 2026-10-15). O Antigravity não escala modelo dinamicamente por despacho e rejeita aliases do Claude Code (`haiku`, `sonnet`) no `agy plugin validate .` (`Invalid model tier`). As variantes estáticas `flash`/`pro` do Antigravity ficam apenas como opt-in manual no frontmatter. No Claude Code, `coordinator` e `ship` já passam `model` explicitamente na chamada de `Agent()`, que tem precedência sobre o frontmatter.
  - `tools` e `skills` usam sintaxe de lista YAML (`[...]`), exigida pelo parser YAML do Antigravity (`[]string`) e também aceita pelo Claude Code e pelo Cursor.

## Destino de instalação no `vetor install` (`cli/lib/installer/writer.js`, revisado na #397)

Na issue #283, a convenção assumida `.antigravity/` foi removida por não ser lida pela engine, e o Antigravity entrava em `enginesSkipped`. Com a confirmação documental e empírica de `.agents/` na #397 (`https://antigravity.google/docs/subagents`, consultada em 2026-10-19):

- `ENGINE_DEST_DIR.antigravity = '.agents'`.
- Selecionar Antigravity em `vetor install` copia:
  - `skills/` para `.agents/skills/<nome>/SKILL.md`
  - `agents/*.md` (`issue-worker.md` e `code-review.md`, com `model: inherit`) para `.agents/agents/<nome>.md` (via `ENGINE_AGENT_FILE_MAP.antigravity`, excluindo `agents/*/codex.toml`).
- `hooks/` permanece em `ENGINE_EXCLUDED_SOURCE_DIRS.antigravity`: `hooks/hooks.json` usa schema e eventos do Claude Code (`${CLAUDE_PLUGIN_ROOT}`), enquanto o Antigravity espera `.agents/hooks.json` (arquivo único na raiz de `.agents/`, mesmo formato do `hooks.json` da raiz do plugin).

---

[← Wiki do Vetor](Home.md)
