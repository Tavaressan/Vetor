# Compatibilidade — OpenAI Codex

Investigação feita em 2026-07-20/21 contra a documentação pública do Codex CLI
([`developers.openai.com/codex`](https://developers.openai.com/codex/cli), espelhada em
`learn.chatgpt.com/docs/*`), o CLI `codex` v0.144.6 instalado nesta máquina, e logs locais em
`~/.codex/logs_2.sqlite`. Trate o que segue como verificado **contra a doc e comportamento observado
em máquina local**; valide a cobertura de eventos do hook contra uma sessão real antes de mergear em
um projeto que dependa de `/vetor:coordinator` com Codex.

Ao contrário do Antigravity, o Codex tem hooks de ciclo de vida com o **mesmo formato de arquivo**
do Claude Code (`hooks.json` com `hooks.<Evento>[].matcher`/`hooks[].type: "command"`) e uma lista
de eventos mais completa — inclusive `SubagentStop`, que falta no Antigravity:

- ✅ `SessionStart`, `PreToolUse`, `PostToolUse`, `SubagentStop`, `SubagentStart`, `Stop`,
  `UserPromptSubmit`, `PermissionRequest`, `PreCompact`, `PostCompact`
- ❌ `WorktreeCreate` (não existe equivalente — nenhum evento cobre "worktree acabou de ser
  criado")
- `PreToolUse` bloqueia de fato: exit code `2` (mesmo contrato do Claude Code) ou JSON
  `{"hookSpecificOutput": {"permissionDecision": "deny"}}`

**Reuso dos scripts.** `hooks/hooks-codex.json` reaproveita os mesmos scripts Deno do Claude Code
(`safety-check.ts`, `check-edit.ts`, `check-status.ts`, `session-check.ts`) sem duplicar lógica —
só troca `${CLAUDE_PLUGIN_ROOT}` por `${PLUGIN_ROOT}` (variável equivalente que o Codex expõe para
hooks de plugin). **Não verificado:** se o JSON que o Codex envia no stdin usa os mesmos nomes de
campo que o Claude Code (`tool_name`, `tool_input.command`, `tool_input.file_path`, `cwd`,
`agent_type`, `agent_id`) — a doc pública não detalha o schema campo a campo. Sem isso confirmado
contra uma sessão real, os scripts podem rodar sem erro e simplesmente não encontrar os campos
esperados (fail-open, não fail-closed — os scripts saem com código 0 em JSON não reconhecido).

**Skills.** O formato é idêntico ao Claude Code (`SKILL.md` com frontmatter `name`/`description`),
e o manifesto do plugin Codex (`.codex-plugin/plugin.json`) tem um campo `skills` que aceita
apontar para um diretório — em tese, o mesmo `skills/` deste repositório serviria sem duplicação.
**Na prática, isso está bloqueado**: 8 dos 9 arquivos de skill (todos exceto `fix-loop-agent`, que
tem esse problema por dependência) referenciam `$CLAUDE_PLUGIN_ROOT` no corpo do texto, variável
que o Codex não define. `.codex-plugin/plugin.json` **deliberadamente não declara** o campo
`skills` até essa referência ser tornada agnóstica de runtime (issue de acompanhamento) — declarar
teria dado falsa impressão de skills funcionais que na verdade falham ao resolver um path.

**Subagentes.** Definidos como arquivos TOML (`name`, `description`, `developer_instructions`,
`model`, `sandbox_mode`, `mcp_servers`, `skills.config`) em `.codex/agents/` (projeto) ou
`~/.codex/agents/` (pessoal) — não em Markdown como `agents/issue-worker.md`. Dois gaps reais:

- **Sem lista de tools por agente.** O Claude Code restringe `tools:` por subagente; o Antigravity
  tem `toolNames`. O Codex não documenta um allowlist equivalente — o subagente herda todas as
  tools da sessão pai.
- **Sem isolamento de worktree nativo.** `isolation: worktree` (Claude Code) não tem equivalente —
  subagentes herdam o cwd/sandbox da sessão pai. O template `agents/issue-worker/codex.toml`
  instrui o worker a `cd` para o worktree recebido no prompt, mas isso é reforçado só por
  instrução, nunca por hook (nenhum evento de hook carrega o cwd do subagente antes dele agir).

**Bundling via plugin.** O manifesto `.codex-plugin/plugin.json` tem campos para `skills`,
`hooks`, `mcpServers` e `apps`, mas **nenhum para subagentes** — não há como o plugin instalar um
`.toml` de agente automaticamente. `agents/issue-worker/codex.toml` e
`agents/code-review/codex.toml` neste repositório são **templates de referência**: para usar, copie
manualmente para `.codex/agents/` no projeto-alvo. O `/vetor` (porta de entrada) ainda não
automatiza essa cópia.

**Resumo da proteção:** guards de segurança têm parceridade estrutural com o Claude Code (mesmo
formato de hook, mesmos scripts, cobertura de eventos igual ou maior), mas dependem de validação
de payload não feita nesta investigação. Skills não funcionam sem edição prévia. Subagentes
funcionam, mas sem tool allowlist e sem isolamento de worktree garantido por hook — a mesma classe
de risco documentada para o Antigravity (issue #57: cwd mal resolvido contaminando a raiz
compartilhada), só que sem o guard `PreToolUse` de escrita fora do worktree para pegar o caso,
porque esse guard depende do payload não verificado. **Não usar `/vetor:coordinator` com dispatch
em background no Codex** até essa validação ser feita contra uma sessão real.

**Rate-limit/quota — nenhum sinal observável (investigação #85).** Explorados comandos `codex --help`,
`codex exec --help`, `codex debug --help`, `codex doctor --help`, `codex features --help` e o banco
de logs em `~/.codex/logs_2.sqlite`. Achados:
- JSONL events do `codex exec --json` incluem tipos: `thread.started`, `turn.started`,
  `item.completed`, `turn.completed`
- `turn.completed` expõe `usage` com `input_tokens`, `cached_input_tokens`, `output_tokens`,
  `reasoning_output_tokens` — informação de consumo, mas **não há limite ou quota nesse event**
- HTTP logs registram requests/responses com headers completos (status code, x-oai-request-id,
  etc.), mas **nenhum header de rate-limit** (`x-ratelimit-*` ou similar) observado
- `codex doctor` não expõe stats de rate-limit ou quota
- Nenhum comando de CLI para `stats` ou `quota` descoberto (diferente do esperado na OpenCode/OpenAI
  SDK)
- Limitação de plataforma: **Codex não expõe sinal viável de rate-limit ou quota ao cliente** —
  diferente da OpenAI API que inclui headers `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`,
  `retry-after` em respostas HTTP. Se o Codex exceder quota, o CLI retorna um error na websocket ou
  uma resposta HTTP 429/503, mas sem contexto útil de "quantos requests me restam" —
  recomendação: **não é viável implementar detecção de rate-limit/quota no Vetor sem mudança no
  Codex CLI ou API** (issue para OpenAI abrir, não escopo do Vetor).

---

[← Wiki do Vetor](Home.md)
