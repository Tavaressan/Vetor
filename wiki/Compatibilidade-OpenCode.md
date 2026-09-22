# Compatibilidade — OpenCode

> **Nota (2026-09-21):** a afirmação abaixo de que "as skills do Vetor (`skills/*/SKILL.md`)
> referenciam `$CLAUDE_PLUGIN_ROOT` no corpo do texto" — usada para justificar manter as demais
> skills bloqueadas para o OpenCode — **não é mais verdade**. A issue #251 (fechada em 2026-09-17,
> depois desta investigação) removeu essas referências de todos os `SKILL.md`; confirmado por grep
> nesta data (0 ocorrências). O bloqueio das 7+ skills restantes precisa ser revalidado contra a
> razão real (o modelo de dispatch multi-processo do OpenCode, não mais o path de `$CLAUDE_PLUGIN_ROOT`)
> antes de assumir que portar as demais é tão simples quanto foi para o Codex.

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

**Instalação automatizada via `vetor install` (issue #283).** `installFiles()`
(`cli/lib/installer/writer.js`) agora copia a árvore `opencode/` inteira, achatada, para
`.opencode/` no projeto-alvo quando o OpenCode é selecionado — equivalente ao `cp -r opencode/.
<projeto>/.opencode/` manual documentado abaixo, mas com o mesmo controle de manifesto/update seguro
(SHA-256 por arquivo, nunca sobrescreve edição do usuário) que as demais engines já tinham.
`skills/`, `agents/`, `hooks/` (os SOURCE_DIRS agnósticos genéricos) são **excluídos** do destino do
OpenCode — copiá-los produziria skills inertes (`$CLAUDE_PLUGIN_ROOT` não definido), um `agents/`
(plural) que o OpenCode não escaneia (ele usa `agent/`, singular) e hooks em JSON onde o OpenCode
espera plugin TS.

**Por que cópia direta em vez de pacote instalável (git+https) — decisão, não acidente.** O OpenCode
também suporta registrar um plugin via spec de pacote em `opencode.json`
(`"plugin"`/`"plugins": ["pkg@git+https://..."]`), resolvido em runtime por `Npm.add()` — confirmado
via Context7 contra o código-fonte real (`anomalyco/opencode`,
`packages/opencode/src/plugin/shared.ts`, consultado em 2026-09-21). O Vetor não usa esse caminho:
`.opencode/plugin/*.ts` é descoberto por diretório, sem passar pelo resolver de pacote em nenhum
momento (`packages/web/src/content/docs/plugins.mdx`, mesmo repo, mesma data — arquivos em
`.opencode/plugin/`/`.opencode/plugins/` são carregados automaticamente, sem entrada em
`opencode.json`). Isso evita, por construção, uma classe de bug de instalação específica do Windows
documentada pelo projeto superpowers (`obra/superpowers`, `.opencode/INSTALL.md`, seção "Windows
install issues", consultado em 2026-09-21): cache de URLs `git+https` e o Bun não encontrando
`git.exe` no PATH mesmo funcionando em terminal normal — problema real o bastante para exigir um
workaround documentado (`npm install --prefix` + path absoluto em vez do spec `git+https`) num
projeto com base de usuários grande o suficiente para o padrão aparecer com frequência. Se o Vetor
algum dia migrar a distribuição para OpenCode de cópia de arquivo para spec de pacote (ex.: para
simplificar updates), reavaliar esta classe de bug antes — não é hipotético.

**Verificado nesta issue contra o CLI `opencode` real instalado:** chamando `installFiles()`
diretamente (mesmo código que `vetor install` executa) a partir de um checkout do monorepo, com
OpenCode selecionado, `opencode agent list` dentro do projeto-alvo resultante lista `issue-worker
(subagent)` e `code-review (subagent)` — confirma que o resultado da cópia é reconhecido pelo
OpenCode de verdade, não só que o arquivo foi parar no path esperado. **Verificado só no layout de
checkout de monorepo** (`defaultSourceRoot()` resolvendo a raiz do monorepo, via `plugin.json`) — o
layout de pacote publicado (`templates/opencode/...`, sincronizado por
`cli/scripts/sync-templates.js`) tem cobertura só por teste automatizado
(`cli/test/pack.test.js`, `cli/test/sync-templates.test.js`,
`cli/test/installer-writer.test.js`), não por execução do `opencode` real contra um pacote `npm
pack`ado de verdade.

Depois, mescle o bloco `mcp` de `.opencode/mcp.jsonc` (copiado como referência, não fundido
automaticamente — merge de JSON de config alheio fica fora de escopo) no `opencode.json` do
projeto-alvo (ajuste o path do `docker-catalog.yaml` se for usar o servidor `docker`).

**Instalação manual** (alternativa sem o `vetor install`, mesmo resultado):

```bash
cp -r opencode/. <projeto-alvo>/.opencode/
```

**Resumo (atualizado 2026-09-22 com resultado verificado da issue #299 — ver "Validação manual do
coordinator" abaixo):** isolamento de worktree por worker é **verificado e resolvido** (via
`opencode run --dir`, testado contra o CLI real instalado). Hooks de segurança são **reais e
funcionais** — confirmado end-to-end no Windows contra o CLI real: `git push` bloqueado em branch
protegida e escrita fora do worktree bloqueada, ambos via `opencode/plugin/vetor.ts`. Os dois
subagentes nativos (`issue-worker`, `code-review`) estão **prontos para uso**. O `issue-coordinator`
está **escrito** (`opencode/skills/issue-coordinator/SKILL.md`) mas **não está pronto para uso**: o
CLI real não o reconhece como `--agent` (é uma skill, não um agent — [issue
#306](https://github.com/Tavaressan/Vetor/issues/306)) e o fallback de modelo que ele invoca
(`resolve-model.ts`) tem um bug de path específico do Windows que o faz ignorar `config.json`
silenciosamente ([issue #307](https://github.com/Tavaressan/Vetor/issues/307)). As demais 7 skills
seguem bloqueadas pela mesma limitação de path do Codex.

## Validação manual do coordinator

> **Resultado verificado (2026-09-22, issue #299) — `opencode` v1.18.32, Windows 11 (win32), Git
> Bash.** Executado contra um repositório de teste jogável
> (`Tavaressan/vetor-opencode-e2e-test-299`, não removível — o token `gh` em uso não tem escopo
> `delete_repo`; documentado aqui em vez de removido). **Achado principal: `opencode run --agent
> issue-coordinator "backlog"` não invoca o coordinator.** O CLI real imprime `! agent
> "issue-coordinator" not found. Falling back to default agent` e executa o agente `build` genérico
> em vez do procedimento portado — porque `opencode/skills/issue-coordinator/SKILL.md` vive em
> `.opencode/skills/`, um diretório que o OpenCode descobre como **skill**, não como **agent**
> (`opencode agent list` só lista o que está em `.opencode/agent/*.md`: `issue-worker`,
> `code-review`). Isso não é específico do Windows — reproduziria em qualquer SO — mas é a razão
> pela qual o item 3 abaixo (fluxo completo do coordinator) nunca chegou a rodar. Rastreado em
> [issue #306](https://github.com/Tavaressan/Vetor/issues/306). Por causa disso, o critério de
> aceite "procedimento executado de ponta a ponta" **não foi atingido**; o que segue é o resultado
> item a item, incluindo o que foi possível validar isoladamente.
>
> | Item | Resultado | Evidência |
> |---|---|---|
> | 1. Setup do repositório de teste (`.opencode/` copiado + 2 issues com label `backlog`) | ✅ PASS | `Tavaressan/vetor-opencode-e2e-test-299`, issues #1 (Lead) e #2 (Sequential) |
> | 2. `opencode run --agent issue-coordinator "backlog"` | ❌ FAIL | `! agent "issue-coordinator" not found. Falling back to default agent` — ver #306 |
> | 3. Plano exibido antes do worktree / `git worktree add` serializado / dispatch de `issue-worker` por grupo / status file / `Ctrl+C` + `--resume` sem duplicar / merge na Fase 6 | ⛔ NOT_EXECUTED | Bloqueado pelo item 2 — sem o agent real invocado, nenhuma fase do procedimento roda. O sub-item `Ctrl+C` + `--resume` especificamente também seria de execução duvidosa neste ambiente (worker headless em `win32`, sem garantia de que um `SIGINT` via Git Bash chega como Ctrl+C real ao processo `opencode`) — não confirmado de nenhuma forma. |
> | 4. Plugin de segurança (`opencode/plugin/vetor.ts`) bloqueia `git push` para branch protegida a partir de um worker não-`GREEN` | ✅ PASS | `opencode run --agent build -m opencode/nemotron-3.5-lightning-free "git push origin main"` dentro de um worktree real (`git worktree add`) com status file `Status: RUNNING` → `Error: ERROR: Push to protected branches (main, master, production) is prohibited by Vetor Safety Hook.` (via `tool.execute.before` → `deno run -A safety-check.ts`, não pela allowlist de `permission.bash` do agent — testado com o agent `build` genérico, sem a negação de `git push*` que `issue-worker.md` já tem embutida, para isolar o plugin) |
> | 5. Plugin de segurança bloqueia escrita fora do worktree | ✅ PASS | Mesmo processo, tool `write` com path relativo `../../fora-do-worktree.txt` → `Error: ERROR: escrita fora do worktree bloqueada pelo Vetor Safety Hook: ../../fora-do-worktree.txt` |
> | 6. Fallback de modelo (`resolve-model.ts`) — preferencial saudável / degraded / `until` expirado / todos degraded | ✅ PASS (com ressalva) | Ver bloco "Fallback de modelo/provedor" abaixo — os 4 casos passaram, mas só depois de corrigir um bug real descoberto no processo: [issue #307](https://github.com/Tavaressan/Vetor/issues/307) (`resolve-model.ts` ignora `config.json` quando `cwd` é POSIX-style, formato que `$(pwd)` no Git Bash produz por padrão no Windows — exatamente o comando documentado no `SKILL.md`; mecanismo confirmado por probe direto contra `Deno.Command`/`Deno.statSync`, [comentário na issue](https://github.com/Tavaressan/Vetor/issues/307#issuecomment-5777794992): `Deno.Command` com `cwd` POSIX-style lança `NotFound: Failed to spawn '...\git.exe': No such cwd 'C:\c\Users\...'`, exceção engolida pelo `try/catch` de `run()`, cascateando em `resolveWorktree` → `null` → fallback embutido) |
> | 7. Cleanup do worktree de teste (`git worktree remove`, equivalente ao `safe-remove-worktree` da Fase 6) | ⚠️ Desvio Windows | `git worktree remove ".claude/worktrees/test-1-contributing" --force` → `error: failed to delete '...': Filename too long`. O diretório foi parcialmente apagado e a entrada some de `git worktree list`, mas arquivos residuais ficam para trás. Path do worktree de teste tinha ~190 caracteres (aninhado sob o diretório de scratchpad da sessão) — mais perto do limite de 260 caracteres do Windows (`MAX_PATH`) do que um worktree normal em `.claude/worktrees/<slug>` na raiz do repo, então pode não reproduzir em todo setup; registrado como observação, não como issue própria, por não ter isolado se o limite viria de qualquer jeito com paths de projeto mais profundos. |
>
> **Conclusão:** os dois subagentes nativos (`issue-worker`, `code-review`) e o plugin de segurança
> funcionam de ponta a ponta no Windows contra o CLI real. O `issue-coordinator` — a peça central do
> fluxo — não é invocável como documentado; corrigir #306 é pré-requisito para uma validação
> completa do item 3. `resolve-model.ts` funciona corretamente uma vez corrigido o formato de path
> (#307), mas falha silenciosamente (sem erro, sem aviso) no caminho documentado hoje no `SKILL.md`
> — risco concreto de o coordinator escolher um modelo/provider errado em produção no Windows sem
> ninguém perceber.

O `issue-coordinator` portado nunca havia sido executado de ponta a ponta contra uma instalação
real do OpenCode antes da validação acima — o ambiente usado para portá-lo foi o Claude Code, sem
CLI `opencode` interativo. Este é o procedimento original para quem for revalidá-lo após #306/#307
(movido de `opencode/skills/issue-coordinator/SKILL.md` na issue #147: é documentação de
desenvolvimento, não instrução de runtime).

1. Crie/escolha um repositório de teste com `.opencode/` copiado (`cp -r opencode/. <repo>/.opencode/`)
   e ao menos 2 issues GitHub abertas com o label `backlog` (ou outro label de teste), idealmente uma
   Lead + uma Sequential relacionada, para exercitar o agrupamento de afinidade.
2. Rode `opencode run --agent issue-coordinator "backlog"` na raiz do repositório de teste.
3. Confirme que:
   - o plano é exibido no chat e o coordenador aguarda uma resposta textual afirmativa antes de
     criar qualquer worktree;
   - `git worktree add` roda uma vez por grupo (serializado — sem `index lock`);
   - `opencode run --dir <worktree> --agent issue-worker "..."` é disparado como processo
     independente por grupo, respeitando o teto de workers perguntado na Fase 2;
   - `.claude/vetor/status/<branch>.md` é criado/atualizado pelo worker e a tabela de
     `bash .opencode/scripts/vetor-status.sh` reflete o progresso real;
   - interrompendo o processo coordenador (Ctrl+C) e rodando `opencode run --agent issue-coordinator
     "--resume"` reconstrói a tabela de status sem duplicar dispatch das issues já em andamento;
   - ao atingir `GREEN`, a Fase 6 localiza o worktree correto via `git worktree list` e completa o
     merge.
4. Registre desvios encontrados como issue de acompanhamento (mesmo padrão usado para o gap do Codex
   documentado em `codex_plugin_hook_gap.md`).

**Fallback de modelo/provedor (issue #84)** — a lógica de escolha em si já tem cobertura
automatizada (`deno task test`, `opencode/scripts/resolve-model_test.ts` e
`opencode/scripts/lib/model-health_test.ts`), sem depender de um ambiente OpenCode real. Para
validar a integração completa (hook `event` → `model-health.json` → `resolve-model.ts` →
`opencode run --dir --model`) contra uma instalação real:
1. Force uma entrada `degraded` sintética: `echo '{"anthropic/claude-haiku-4-5":{"status":
   "degraded","until":9999999999999,"lastError":"teste manual"}}' >
   .claude/vetor/status/model-health.json` no repositório de teste.
2. Rode `opencode run --agent issue-coordinator "backlog"` e confirme no log/chat que o comando
   de dispatch monta `--model anthropic/claude-sonnet-4-5` (ou o próximo saudável do tier) em vez
   do preferencial degraded.
3. Zere `model-health.json` (ou aguarde `until` expirar) e confirme que o próximo dispatch volta a
   escolher o preferencial original.
4. Force **todos** os modelos do tier como `degraded` e confirme que o grupo fica `QUEUED` em vez
   de despachar — sem processo `opencode run` para ele até uma entrada expirar.

**Resultado verificado (2026-09-22, issue #299)** — os 4 casos rodados diretamente contra
`opencode/scripts/resolve-model.ts` (`deno run -A`, sem passar pelo coordinator — inviável por
#306) no repositório de teste, com `.claude/vetor/config.json` configurando `modelFallback.simple:
["openrouter/anthropic/claude-haiku-4.5", "openrouter/anthropic/claude-sonnet-4.5"]` (ajustado para
o provider real disponível na credencial usada — `opencode auth list` mostrou só `OpenRouter`
configurado neste ambiente, não `anthropic` direto):

| Caso | `cwd` no payload | Resultado |
|---|---|---|
| Preferencial saudável | `C:/Users/.../vetor-opencode-e2e-test-299` | ✅ `openrouter/anthropic/claude-haiku-4.5` |
| Preferencial `degraded` (`until` no futuro) | idem | ✅ `openrouter/anthropic/claude-sonnet-4.5` |
| Entrada `degraded` com `until` expirado (`until: 1`) | idem | ✅ volta a `openrouter/anthropic/claude-haiku-4.5` |
| Todos os modelos do tier `degraded` | idem | ✅ `exit 1` + `Todos os modelos da lista de fallback estão degraded: ...` no stderr |
| Preferencial saudável | `/c/Users/.../vetor-opencode-e2e-test-299` (POSIX-style, o que `$(pwd)` no Git Bash devolve) | ❌ `anthropic/claude-haiku-4-5` (`DEFAULT_MODEL_FALLBACK` embutido — ignora silenciosamente o `config.json` real) |

A última linha é o bug rastreado em [issue #307](https://github.com/Tavaressan/Vetor/issues/307):
com `cwd` em formato POSIX-style (o que o comando documentado no `SKILL.md`, `"cwd": "'"$(pwd)"'"`,
produz por padrão no Windows/Git Bash), o script cai silenciosamente no default embutido em vez do
`config.json` real do projeto — sem erro, sem aviso.

---

[← Wiki do Vetor](Home.md)
