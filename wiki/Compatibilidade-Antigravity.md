# Compatibilidade — Antigravity

Fontes consultadas:
- Documentação oficial de subagentes (`https://antigravity.google/docs/subagents` / `https://antigravity.google/docs/subagents.md`, consultada em 2026-10-15 no spike da #337 e reconfirmada em 2026-10-19 na #397).
- Documentação oficial de plugins (`https://antigravity.google/docs/plugins` / `https://antigravity.google/docs/plugins.md`, consultada em 2026-10-19 na #397).
- CLI `agy` instalado localmente (`agy plugin validate .`, v1.4.1, verificado em 2026-10-19).

## Instalação e Atualização

### 1. Global (Plugin do Antigravity via `agy`)
Ideal para ter as skills e subagentes disponíveis globalmente em todas as sessões do Antigravity:

```bash
# Instalação inicial (clone temporário e registro global):
git clone https://github.com/Tavaressan/Vetor.git /tmp/vetor-plugin && agy plugin install /tmp/vetor-plugin

# No Windows (PowerShell):
git clone https://github.com/Tavaressan/Vetor.git "$env:TEMP\vetor-plugin"; agy plugin install "$env:TEMP\vetor-plugin"
```

Para atualizar para a versão mais recente:
```bash
cd /tmp/vetor-plugin && git pull && agy plugin install .
# ou desinstalar e reinstalar:
agy plugin remove vetor && agy plugin install /tmp/vetor-plugin
```

### 2. Projeto Local (Workspace via CLI `vetor`)
Para projetos individuais onde skills e subagentes devem residir no próprio repositório em `.agents/`:

```bash
# Instalação não-interativa (ideal para agentes e pipelines CI):
npx @tavaressan/vetor install --engines antigravity --yes

# Atualização segura a partir do manifesto do projeto:
npx @tavaressan/vetor update
```

## Hooks

**Claude Code** (`hooks/hooks.json`):
- ✅ `PreToolUse`, `PostToolUse`, `SubagentStop`, `SessionStart`, `WorktreeCreate`
- **Proteção**: completa. Bloqueia escrita fora do worktree, obriga status file em estado terminal, injeta diagnostics de edição

**Antigravity** (`hooks.json` na raiz):
- ✅ `PreToolUse` (suportado e configurado para `run_command` via `deno run -A ./scripts/safety-check-antigravity.ts`)
- ⚠️ `PostToolUse` (evento existe no Antigravity, mas **não está configurado** no `hooks.json`)
- ❌ `SubagentStop` (não existe. Antigravity tem um evento `Stop` genérico, mas não específico a subagentes; não é equivalente)
- ❌ `SessionStart` (não suportado)
- ❌ `WorktreeCreate` (não suportado)
- **Proteção**: focada em segurança de comandos. Implementada em Deno (`scripts/safety-check-antigravity.ts`), que aplica a mesma política do hook do Claude Code (`scripts/lib/safety-policy.ts`, uma única implementação) e:
  - Executa com o Deno que o Vetor já exige, sem depender de Node.js, Bash ou WSL; precisa de `deno` e `git` no `PATH`.
  - Implementa o contrato JSON estrito do Antigravity (`{"decision": "allow"}` ou `{"decision": "deny", "reason": "..."}`), sempre com exit code 0 e com o JSON como única saída em `stdout`.
  - Bloqueia pushes diretos para branches protegidas (`main`, `master`, `production`).
  - Bloqueia comandos git destrutivos (`git reset --hard`, `git clean -f*`, `git branch -D`, `git checkout .`).
  - Bloqueia push/PR de workers em estado não-GREEN dentro de worktrees linkados (o diretório é resolvido pelo `toolCall.args.Cwd` do payload).
  - Resiliente a falhas internas: JSON inválido e erros imprevistos emitem `{"decision": "allow"}` para não travar execuções do agente em loops bloqueantes, com o diagnóstico em `stderr` (classe e mensagem do erro, nunca o payload nem o comando).
  - Limites: só `toolCall.args.CommandLine` é avaliado (payload válido sem `CommandLine` string é liberado) e, sem `toolCall.args.Cwd`, vale o diretório do processo do hook. Não há guard de escrita (o matcher só cobre `run_command`). A documentação oficial do Antigravity não informa de qual diretório o caminho relativo `./scripts/...` do `hooks.json` é resolvido; essa verificação é feita no Antigravity real, no Windows, e registrada na PR da #476.

Para usar o Vetor com Antigravity, a restrição crítica remanescente é que workers podem escrever fora do worktree (o Antigravity não possui evento de pré-escrita como o Claude Code), encerrar sem preencher o status file, e não recebem feedback de tipo. Recomenda-se manter a invocação manual (`/vetor:fix`, `/vetor:ship`) e **não usar `/vetor:coordinator`** com dispatch em background até que Antigravity suporte os eventos faltantes.

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
