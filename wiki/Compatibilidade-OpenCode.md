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

**Achado colateral da investigação da #306, não corrigido aqui (fora de escopo — precisa issue
própria).** O parágrafo acima descreve `--dir` como verificado — isso é verdade —, mas a combinação
`--agent issue-worker`/`--agent code-review` especificamente **não é**: `issue-worker.md` e
`code-review.md` têm `mode: subagent`, e contra o CLI real (`opencode` v1.18.32) `opencode run
--agent code-review "<msg>"` responde `! agent "code-review" is a subagent, not a primary agent.
Falling back to default agent` e executa a mensagem no agent `build`, não em `code-review` — mesma
classe de sintoma do bug original da #306 (fallback silencioso para `build`), só que por um motivo
diferente (`mode` errado para invocação direta via CLI, não localização errada de arquivo). Isso
sugere que o mecanismo de dispatch de workers documentado aqui e em
`opencode/agent/issue-coordinator.md` (`opencode run --dir <worktree> --agent issue-worker
"<prompt>"`) pode não funcionar como escrito contra o CLI real — **não testado dentro desta
investigação** (o escopo era #306/#307, não uma nova issue); precisa de validação e,
provavelmente, de uma correção própria (talvez `mode: primary` também para `issue-worker`/
`code-review`, já que ambos só são disparados como processo `opencode` isolado via `--dir`, nunca
via `task` in-process do OpenCode — o caso de uso real de "subagent" na acepção do OpenCode não se
aplica a eles).

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
(`opencode/agent/issue-coordinator.md`) roda `opencode/scripts/resolve-model.ts`, que lê a
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

**`issue-coordinator` portado como *agent*, não skill (issue #82, corrigido na #306); as demais 7
skills seguem bloqueadas pelo mesmo motivo do Codex.** Distinção que importa de verdade no OpenCode:
**skills não são invocáveis por `--agent`/CLI, só agents são.** `opencode agent list` e
`opencode run --agent <nome>` só resolvem nomes registrados em `.opencode/agent/*.md` — um arquivo
em `.opencode/skills/<nome>/SKILL.md` é descoberto como skill (ferramenta que outro agent pode
consultar), nunca como agent invocável diretamente. Entre a issue #82 (porte inicial) e a #306
(correção), `opencode/skills/issue-coordinator/SKILL.md` viveu no diretório errado: `opencode agent
list` nunca o listava e `opencode run --agent issue-coordinator "<label>"` caía silenciosamente no
agent `build` default, sem nenhuma fase do coordinator rodar — confirmado contra o CLI real
(`opencode` v1.18.32) na investigação da #306. O arquivo foi movido (não duplicado) para
`opencode/agent/issue-coordinator.md`, com frontmatter de agent (`description`, `mode: primary` — é
o agent de entrada, invocado diretamente pelo usuário, ao contrário de `issue-worker`/`code-review`,
despachados programaticamente pelo próprio coordinator —, `model`, `permission`), no mesmo formato
de `opencode/agent/issue-worker.md` e `opencode/agent/code-review.md`. O corpo do procedimento não
mudou; só o diretório e o frontmatter.

O formato `SKILL.md`/agent `.md` do OpenCode é compatível com o Vetor (frontmatter simples;
campos extras são ignorados) e o OpenCode até escaneia `.claude/skills/*/SKILL.md` nativamente —
mas isso não ajudava por si só, porque as skills do Vetor (`skills/*/SKILL.md`) referenciam
`$CLAUDE_PLUGIN_ROOT` no corpo do texto para localizar `scripts/` e
`skills/shared/references/`, variável que o OpenCode não define. `opencode/agent/
issue-coordinator.md` é uma cópia auto-contida (sem `$CLAUDE_PLUGIN_ROOT` em nenhum ponto) que
resolve todas as referências como caminho relativo à raiz do repositório onde `.opencode/` foi
copiado — inclusive `.opencode/scripts/vetor-status.sh` e `.opencode/scripts/vetor-checks.sh`
(cópias diretas de `scripts/vetor-status.sh`/`vetor-checks.sh`, adicionadas junto com o coordinator).
O modelo de dispatch foi reescrito para o processo `opencode run --dir <worktree> --agent
issue-worker`, já que não há `Agent()`/`isolation: "worktree"` nem `SendMessage` no OpenCode — a
escalação de `BLOCKED_WAITING` e o acompanhamento de progresso acontecem por **polling do status
file** (`.opencode/scripts/vetor-status.sh`), não por canal de mensagens entre processos. Ver
`opencode/agent/issue-coordinator.md`, seção "Validação manual", para o procedimento de teste
contra uma instalação real do OpenCode. Portar as 7 skills restantes (mesmo ajuste de referências,
sem a complexidade adicional do modelo de dispatch multi-processo) segue como trabalho futuro —
igual ao que foi feito para o Codex; nenhuma delas precisa virar agent, já que não são invocadas
diretamente por `--agent`.

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

**Verificado contra o CLI `opencode` real instalado, nos dois layouts de fonte (issue #254, depois
#300):** chamando `installFiles()` diretamente (mesmo código que `vetor install` executa) a partir
de um checkout do monorepo, com OpenCode selecionado, `opencode agent list` dentro do projeto-alvo
resultante lista `issue-worker (subagent)` e `code-review (subagent)` — confirma que o resultado da
cópia é reconhecido pelo OpenCode de verdade, não só que o arquivo foi parar no path esperado.
`installFiles()` copia `opencode/` inteiro genericamente (`ENGINE_NATIVE_SOURCE_DIR`, sem enumerar
arquivo por arquivo — ver `cli/lib/installer/writer.js`), então a mesma verificação vale para
`opencode/agent/issue-coordinator.md` depois da #306: `opencode agent list` passa a listar também
`issue-coordinator (primary)`, confirmado manualmente com o mesmo mecanismo de cópia (`cp -r
opencode/. <dir>/.opencode/` + `opencode agent list` real) durante a investigação da #306 — não
repetido via `installFiles()`/pacote publicado nesta rodada (redundante com a verificação já
descrita aqui para `issue-worker`/`code-review`, que exercitam o mesmo caminho de cópia).

A issue #300 fechou a lacuna que ficava registrada aqui ("verificado só no layout de checkout de
monorepo"). A verificação completa de ponta a ponta — `npm pack` real com o hook `prepack`
rodando de verdade (populando `cli/templates/` a partir de skills/agents/hooks/opencode da raiz),
`npm install <tarball> --prefix <dir-temp>` num diretório **limpo, fora do monorepo** (não `npm
link`, que reaponta para o working tree em vez do conteúdo empacotado), `installFiles()` chamado a
partir do módulo carregado do **pacote instalado** e `opencode agent list` (CLI real, `v1.18.32`
neste ambiente) listando `issue-worker (subagent)` e `code-review (subagent)` a partir do resultado
— foi rodada manualmente uma vez durante a investigação desta issue, confirmando a cadeia completa.

O teste automatizado que ficou (`cli/test/pack.test.js`) decompõe essa cadeia em vez de repeti-la
por inteiro: o `npm pack` real do novo teste usa `--ignore-scripts` e reaproveita o `cli/templates/`
já sincronizado pelos dois testes de conteúdo declarado que rodam antes dele, no mesmo arquivo — os
que já disparam o prepack de verdade. Decisão deliberada, não descuido: rodar prepack uma terceira
vez no mesmo arquivo, contra o `cli/templates/` real (não um fixture), mostrou-se uma corrida real
contra `npm-publish-workflow.test.js` (arquivo diferente, executado em paralelo pelo runner de
testes do Node) — ~50% de falha intermitente em execuções repetidas da suíte completa, medido
durante esta issue. A partir daí o teste chama `defaultSourceRoot()`/`installFiles()` do pacote
recém-instalado — o mesmo branch de `defaultSourceRoot()` que resolve `templates/` (sem
`plugin.json` ao lado) e que antes só tinha cobertura contra fixture sintética — e roda `opencode
agent list` real contra o resultado, para Claude Code, OpenCode e Codex.

**Cobertura em CI:** `npm-publish.yml` roda `npm test` em `cli/` antes de todo publish real
(inclusive o gate de #292) — a mecânica de empacotar/instalar o tarball e copiar para os destinos
das três engines roda automaticamente ali. A validação de **runtime real** (`opencode agent list`)
não: os runners `ubuntu-latest` do GitHub Actions não têm `opencode` nem `codex` no PATH, então
`commandExists()` desvia para o log informativo em vez de rodar o CLI — mesmo comportamento de
quando um dev roda `npm test` localmente sem essas CLIs instaladas. A confirmação com CLI real só
acontece quando alguém roda a suíte (ou o procedimento manual acima) numa máquina com `opencode`
instalado. `ci.yml` (checks de PR) não roda `cli && npm test` de forma alguma — só `deno
fmt/lint/check/test` — comportamento anterior a esta issue, fora de escopo corrigir aqui.

**Gap concreto que permanece (não fechado por #300):** Codex não tem CLI disponível neste
ambiente/sandbox (`codex --version` não resolve no PATH) — a tradução de formato
(`.codex/agents/<nome>.toml`, achatado a partir de `agents/<nome>/codex.toml`) está coberta por
teste automatizado e pelo `installFiles()` real do tarball instalado, mas **nunca foi validada
contra o binário `codex` de verdade reconhecendo o resultado**. Ver `cli/test/pack.test.js` (a
mesma suíte pula essa validação com um log explícito quando `codex` não está no PATH, em vez de
simular o resultado) e o corpo da issue #300 para o procedimento manual pendente.

**Achado colateral registrado nesta issue (#300), não corrigido (fora de escopo, YAGNI):**
`vetor install`, rodado a partir do binário publicado com stdin em pipe (qualquer processo filho
sem TTY — é o caso de qualquer automação não-interativa, incluindo `npx vetor@latest` disparado por
outro script), sempre cai no ramo "sessão não-interativa" de `prompts.js` (`input.isTTY` nunca é
verdadeiro num pipe) e termina sem selecionar nenhuma engine, mesmo com engines detectadas — "Nenhuma
engine selecionada. Instalação cancelada." Comportamento real do binário publicado, verificado
diretamente (`node bin/vetor.js install` com stdin vazio), não uma inferência.

Depois, mescle o bloco `mcp` de `.opencode/mcp.jsonc` (copiado como referência, não fundido
automaticamente — merge de JSON de config alheio fica fora de escopo) no `opencode.json` do
projeto-alvo (ajuste o path do `docker-catalog.yaml` se for usar o servidor `docker`).

**Instalação manual** (alternativa sem o `vetor install`, mesmo resultado):

```bash
cp -r opencode/. <projeto-alvo>/.opencode/
```

**Resumo:** isolamento de worktree por worker (`--dir`) é **verificado e resolvido** contra o CLI
real instalado. Hooks de segurança são **reais e funcionais** (reaproveitando os scripts Deno
existentes). O `issue-coordinator` está **portado como agent** (`opencode/agent/
issue-coordinator.md` — não skill; issue #82, correção de registro na #306) e **confirmado
invocável** via `opencode agent list`/`--agent` contra o CLI real. `issue-worker`/`code-review`
continuam listados corretamente por `opencode agent list`, mas a invocação direta via `--agent`
**não foi confirmada** — achado desta investigação registrado acima ("Achado colateral da
investigação da #306"), pendente de issue própria. As demais 7 skills seguem bloqueadas pela mesma
limitação de path do Codex (permanecem skills de propósito — não precisam de `--agent`, já que não
são invocadas diretamente pelo usuário).

## Validação manual do coordinator

O `issue-coordinator` portado foi confirmado, contra o CLI `opencode` real (v1.18.32) instalado
neste ambiente, em `opencode agent list` (aparece como `issue-coordinator (primary)`) e em `opencode
run --agent issue-coordinator "<mensagem>"` (o header da sessão mostra `> issue-coordinator ·
<model>` em vez de cair no `build` default — investigação da #306). O que **não** foi exercitado de
ponta a ponta contra uma instalação real é o fluxo completo de dispatch (Fases 1-7, worktrees reais,
workers paralelos) — o ambiente usado para portá-lo é o Claude Code, sem sessão interativa longa
disponível no CLI `opencode`. Este é o procedimento para quem for validar o fluxo completo (movido
de `opencode/skills/issue-coordinator/SKILL.md` na
issue #147: é documentação de desenvolvimento, não instrução de runtime).

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

---

[← Wiki do Vetor](Home.md)
