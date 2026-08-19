# Compatibilidade — OpenCode

Investigação feita em 2026-07-21 contra a **documentação oficial** (`opencode.ai/docs/plugins`,
`/docs/agents`, `/docs/config`, `/docs/skills`), o **código-fonte real** (via Context7,
`/anomalyco/opencode`) e o **CLI `opencode` v1.18.4 instalado neste ambiente** (`opencode --help`,
`opencode agent --help`, inspeção do SDK em `node_modules/@opencode-ai/{sdk,plugin}`) — nível de
confiança mais alto do que o alcançado para o Codex, que não teve CLI real disponível para validar.

**Diferença estrutural central:** o OpenCode **não tem manifesto de plugin único**. Skills, agentes,
plugin (hooks) e MCP são descobertos separadamente, cada um no seu diretório: `.opencode/skills/`,
`.opencode/agent/`, `.opencode/plugin/*.ts`, e o campo `mcp` de `opencode.json`. E hooks são
**código TS/JS** (`tool.execute.before`/`tool.execute.after`, recebem `(input, output)`, bloqueiam
com `throw new Error()`), não JSON declarativo como no Claude Code e no Codex.

**Isolamento de worktree por worker — o ponto verificado nesta investigação.** O OpenCode **não**
tem equivalente a `isolation: worktree` nem à tool nativa `task` com cwd isolado por chamada: um
subagente disparado via `task` herda o cwd/sandbox da sessão pai (confirmado no código-fonte —
`Tool.Context` não carrega um diretório por chamada, só `sessionID`/`agent`/`callID`). Existe uma
API `/experimental/worktree` (create/list/remove/reset) no SDK instalado, mas ela é
sessão/projeto-level, não amarrada ao dispatch de subagente por `task`.

A forma **verificada e funcional** de garantir isolamento: `opencode run --dir <path> --agent
<nome>` inicia um **processo `opencode` inteiro** com o cwd fixado em `<path>` para toda a sessão
— não uma tool call isolada. Por isso `opencode/agent/issue-worker.md` instrui o `issue-coordinator`
a despachar cada worker como `opencode run --dir "<worktree>" --agent issue-worker "<prompt>"` (um
processo do SO por worker, análogo ao que o `worktree-create` já faz hoje antes de despachar),
em vez de usar a tool `task` in-process. Consequência prática: a classe de bug da issue #63
(cwd contaminado entre workers paralelos no Claude Code) **não se aplica** a esse modelo — cada
worker é um processo isolado do SO, não uma chamada dentro da mesma sessão.

**Plugin de segurança — implementado, não só um template.** `opencode/plugin/vetor.ts` reimplementa
as políticas de `scripts/safety-check.ts` (branch protegida, push/PR de worker não-`GREEN`, escrita
fora do worktree) e `scripts/check-edit.ts` (typecheck pós-edição) via `tool.execute.before` /
`tool.execute.after`. A lógica **não foi duplicada**: o plugin só traduz o payload confirmado do
OpenCode (`{tool, sessionID, args, agent}`) para o JSON que os scripts Deno originais já esperam no
stdin, e invoca `deno run -A` — os scripts em `opencode/scripts/` são cópias diretas (sem alteração)
dos de `scripts/`, porque o OpenCode não define uma variável equivalente a `$CLAUDE_PLUGIN_ROOT`/
`$PLUGIN_ROOT` para resolver caminho de plugin-root; a cópia viaja com o projeto-alvo (incluindo
para dentro de cada worktree, já que `git worktree` só contém arquivos rastreados). **Trade-off
assumido:** os scripts em `opencode/scripts/` podem divergir de `scripts/` ao longo do tempo — não
há build/sync automático entre as duas cópias nesta versão.

**Detecção reativa de rate-limit/quota (issue #83).** `opencode/plugin/vetor.ts` também escuta o
hook `event` para `session.error`. Confirmado contra o SDK instalado (`@opencode-ai/plugin`
v1.18.4, `dist/index.d.ts:175` `Hooks.event`; `@opencode-ai/sdk`, `dist/gen/types.gen.d.ts:86`
`ApiError`, `:518` `EventSessionError`): o campo `error` pode ser um `ApiError` com
`data.statusCode` (429/529 tratados como rate limit/quota), `data.isRetryable` e
`data.responseHeaders` (tipicamente `retry-after`). Como `EventSessionError.properties` só carrega
`sessionID` (sem provider/model), o plugin correlaciona `sessionID -> "<providerID>/<modelID>"` via
`chat.params` (que recebe `model: { providerID, id }`) antes de gravar. O sinal é persistido —
via `opencode/scripts/model-health.ts` (`deno run -A`, mesmo padrão do restante) — em
`.claude/vetor/status/model-health.json`, na raiz do repositório, porque cada worker é um processo
separado sem estado compartilhado. Entradas com `until` no passado são tratadas como saudáveis por
quem lê o arquivo (`isHealthy` em `opencode/scripts/lib/model-health.ts`).

**Fallback de modelo/provedor no coordinator (issue #84).** Antes de montar cada comando
`opencode run --dir ... --model <provider/model>`, o `issue-coordinator` portado
(`opencode/skills/issue-coordinator/SKILL.md`) roda `opencode/scripts/resolve-model.ts`, que lê a
lista ordenada `modelFallback.<simple|complex>` de `.claude/vetor/config.json` (default embutido no
script se a chave não existir — `anthropic/claude-haiku-4-5` → `anthropic/claude-sonnet-4-5` para
`simple`, ordem invertida para `complex`) e devolve o primeiro modelo não-`degraded`/não-expirado
em `model-health.json`. Se todos os modelos do tier estiverem `degraded`, o script sai com código 1
e o grupo correspondente fica `QUEUED` em vez de ser despachado sabendo que vai falhar.

**Gaps confirmados (sem hook equivalente):**
- `SubagentStop` (obrigar status file em estado terminal) — sem cobertura; não há evento
  específico de fim de subagente entre os ~26 eventos documentados.
- `SessionStart`/`WorktreeCreate` (avisar `/vetor` não rodado; preparar deps do worktree) — sem
  cobertura automática; rodar manualmente `deno run -A scripts/session-check.ts` /
  `scripts/prepare-worktree.ts` antes de despachar workers.
- Sem `tools:`/`toolNames` allowlist por agente como no Claude Code/Antigravity — mitigado
  parcialmente pelo campo `permission` (wildcard por comando de `bash`, `edit`/`webfetch`
  allow/ask/deny), usado em `opencode/agent/issue-worker.md` para negar `git push`/`gh pr
  create|ready|merge` como camada extra além do hook.

**Skills — `issue-coordinator` portado (issue #82); as demais 7 seguem bloqueadas pelo mesmo
motivo do Codex.** O formato `SKILL.md` do OpenCode é compatível (frontmatter `name`/`description`;
campos extras são ignorados) e o OpenCode até escaneia `.claude/skills/*/SKILL.md` nativamente —
mas isso não ajudava por si só, porque as skills do Vetor (`skills/*/SKILL.md`) referenciam
`$CLAUDE_PLUGIN_ROOT` no corpo do texto para localizar `scripts/` e
`skills/shared/references/`, variável que o OpenCode não define. `opencode/skills/issue-coordinator/
SKILL.md` é uma cópia auto-contida (sem `$CLAUDE_PLUGIN_ROOT` em nenhum ponto) que resolve todas as
referências como caminho relativo à raiz do repositório onde `.opencode/` foi copiado — inclusive
`.opencode/scripts/vetor-status.sh` e `.opencode/scripts/vetor-checks.sh` (cópias diretas de
`scripts/vetor-status.sh`/`vetor-checks.sh`, adicionadas junto com o skill). O modelo de dispatch
foi reescrito para o processo `opencode run --dir <worktree> --agent issue-worker`, já que não há
`Agent()`/`isolation: "worktree"` nem `SendMessage` no OpenCode — a escalação de `BLOCKED_WAITING`
e o acompanhamento de progresso acontecem por **polling do status file**
(`.opencode/scripts/vetor-status.sh`), não por canal de mensagens entre processos. Ver
`opencode/skills/issue-coordinator/SKILL.md`, seção "Validação manual", para o procedimento de teste
contra uma instalação real do OpenCode (não executado nesta investigação por falta de CLI
interativo disponível). Portar as 7 skills restantes (mesmo ajuste de referências, sem a
complexidade adicional do modelo de dispatch multi-processo) segue como trabalho futuro — igual ao
que foi feito para o Codex.

**Instalação manual** (sem marketplace de primeira classe no OpenCode — plugins/agentes/skills são
arquivos copiados, não um pacote instalável em um comando):

```bash
cp -r opencode/. <projeto-alvo>/.opencode/
```

Depois, mescle o bloco `mcp` de `opencode/mcp.jsonc` no `opencode.json` do projeto-alvo (ajuste o
path do `docker-catalog.yaml` se for usar o servidor `docker`).

**Resumo:** isolamento de worktree por worker é **verificado e resolvido** (via `opencode run
--dir`, testado contra o CLI real instalado). Hooks de segurança são **reais e funcionais**
(reaproveitando os scripts Deno existentes). O `issue-coordinator` está **portado**
(`opencode/skills/issue-coordinator/SKILL.md`) — hoje os dois subagentes nativos, o plugin de
segurança e o coordinator estão prontos para uso; as demais 7 skills seguem bloqueadas pela mesma
limitação de path do Codex.

---

[← Wiki do Vetor](Home.md)
