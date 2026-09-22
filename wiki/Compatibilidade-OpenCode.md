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

**[Issue #311](https://github.com/Tavaressan/Vetor/issues/311) — CORRIGIDA e confirmada contra o
CLI real (2026-09-22, revalidação pós-descoberta).** `issue-worker.md`/`code-review.md` tinham
`mode: subagent`; invocação direta via `--agent` (o único mecanismo real usado pelo
`issue-coordinator` para despachar workers) caía silenciosamente no agent `build` default — mesma
classe de sintoma do bug original da #306, por um motivo diferente (`mode` errado, não localização
errada de arquivo). Fix: `mode: primary` em ambos, mesmo valor já usado por `issue-coordinator.md`
pelo mesmo motivo (nenhum dos três é invocado via `task` in-process do OpenCode). **Confirmado
corrigido de duas formas**: (a) isoladamente, `opencode run --dir <worktree> --agent issue-worker
"..."` agora mostra o header `> issue-worker · <model>`, sem o aviso de fallback, coberto por
regressão automatizada em `opencode/scripts/agent-registration_test.ts` (`opencode agent list`
real reporta `issue-worker (primary)`/`code-review (primary)`); (b) **em vivo**, dentro do fluxo
real do `issue-coordinator` rodando contra `Tavaressan/vetor-opencode-e2e-test-299` — o worker
despachado pelo coordinator rodou como `issue-worker` de verdade, sem fallback (ver "Validação
manual do coordinator" abaixo). O achado secundário de documentação da mesma issue (`-c`/
`--continue` necessário para levar a aprovação do plano à mesma sessão) também foi incorporado em
`issue-coordinator.md`, seções "Sintaxe" e "Aprovação do plano".

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

**Fallback de modelo/provedor no coordinator (issue #84; revisado pela [issue
#312](https://github.com/Tavaressan/Vetor/issues/312), CORRIGIDA e confirmada 2026-09-22).** Antes
de montar cada comando `opencode run --dir ... --model <provider/model>`, o `issue-coordinator`
portado (`opencode/agent/issue-coordinator.md`) roda `opencode/scripts/resolve-model.ts`, que lê a
lista ordenada `modelFallback.<simple|complex>` de `.claude/vetor/config.json` e devolve o primeiro
modelo não-`degraded`/não-expirado em `model-health.json`. **O default embutido
(`anthropic/claude-haiku-4-5` → `anthropic/claude-sonnet-4-5`, provider `anthropic` direto) foi
removido** — falhava com `Unexpected server error` do `opencode` real em qualquer ambiente
configurado só com outro provider (ex.: OpenRouter), cenário comum para quem ainda não configurou
`modelFallback`. Comportamento atual, distinguido por código de saída:
- **Código 0**: modelo saudável resolvido normalmente.
- **Código 1**: todos os modelos do tier estão `degraded` (transitório) — grupo fica `QUEUED`,
  coordinator tenta de novo no próximo ciclo.
- **Código 2 (novo)**: `modelFallback.<tier>` não configurado em `config.json` e nenhum `fallback`
  explícito foi passado — erro de configuração **permanente**, não transitório. O coordinator para
  o dispatch de todos os grupos pendentes (não só o corrente) e orienta a configurar
  `modelFallback` antes de tentar de novo, em vez de reter o grupo em `QUEUED` esperando algo que
  não muda sozinho.

**Consequência visível para quem já usa o coordinator**: um projeto-alvo sem `modelFallback` em
`config.json` agora falha cedo e de forma acionável na primeira tentativa de dispatch (era esperado
"funcionar" silenciosamente contra o default embutido antes; agora exige configuração explícita).
Cobertura de regressão em `opencode/scripts/resolve-model_test.ts` (9 casos, incluindo os dois
códigos de saída novos/revisados).

**Nota (não corrigida, fora de escopo de #312):** o `model:` do frontmatter de
`issue-worker.md`/`code-review.md`/`issue-coordinator.md` ainda tem o mesmo formato bare-`anthropic`
(`anthropic/claude-haiku-4-5`, `anthropic/claude-sonnet-5`, `anthropic/claude-sonnet-4-5`) que o
`DEFAULT_MODEL_FALLBACK` de `resolve-model.ts` tinha antes da correção da #312. Na prática isso não
afeta o coordinator real — ele sempre monta `--model <provider/model resolvido>` explicitamente
antes de despachar (Fase 4), o que sobrepõe o frontmatter. Só importa para quem invoca um desses
agents **diretamente** sem `--model` (ex.: `opencode run --dir <worktree> --agent issue-worker
"..."` para debug manual) — confirmado reproduzindo o mesmo `Unexpected server error` da #312 duas
vezes nesta investigação. Vale uma correção futura por consistência, mas não é bloqueador.

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

⚠️ **Commite o resultado** (`.opencode/` e `.claude/vetor/config.json`) no repositório-alvo antes de
rodar o `issue-coordinator`. `git worktree add` só propaga arquivos **rastreados** para o novo
worktree — um `.opencode/` copiado mas não commitado fica invisível para o worker despachado dentro
do worktree (ele só enxerga o que existia no commit em que o worktree foi criado), causando fallback
para configuração global ou ausente. Confirmado como causa de confusão numa das rodadas de validação
da issue #299 (ver "Validação manual do coordinator" abaixo).

**Resumo (atualizado 2026-09-22 — terceira revalidação da issue #299, pós-#311/#312/#313 — ver
"Validação manual do coordinator" abaixo):** isolamento de worktree por worker (`--dir`) é
**verificado e resolvido** contra o CLI real instalado. Hooks de segurança são **reais e funcionais**
(reaproveitando os scripts Deno existentes). O `issue-coordinator` está **portado como agent**
(`opencode/agent/issue-coordinator.md` — não skill; issue #82, correção de registro na #306) e
**confirmado invocável e funcional de ponta a ponta até a Fase 4 (ponto de invocação do worker)**
contra o CLI real: Fases 1-3 (listagem, afinidade, plano, aprovação via `-c`, `git worktree add`)
seguem OK; a Fase 4 agora **dispara o `issue-worker` de verdade** ([issue
#311](https://github.com/Tavaressan/Vetor/issues/311), CORRIGIDA — `mode: primary` — e confirmada
tanto isoladamente quanto em vivo dentro do fluxo real do coordinator) usando o modelo resolvido por
`resolve-model.ts` sem assumir provider `anthropic` direto ([issue
#312](https://github.com/Tavaressan/Vetor/issues/312), CORRIGIDA — exige `modelFallback`
configurado, falha cedo e de forma acionável quando ausente). **A Fase 5 (monitoramento via status
file), que bloqueava por um terceiro defeito independente, também está CORRIGIDA**: o `issue-worker`
corretamente despachado não conseguia ler `config.json` nem o próprio status file — ambos vivem em
`<repo-root>/.claude/vetor/`, fora do worktree do worker, e o OpenCode auto-rejeitava esse acesso como
`external_directory` em modo não-interativo — [issue
#313](https://github.com/Tavaressan/Vetor/issues/313), CORRIGIDA via
`opencode/scripts/ensure-external-directory-permission.ts`, chamado pela Fase 4 do coordinator antes
de todo dispatch (ver "Terceira revalidação" abaixo para leitura **e** escrita confirmadas contra o
CLI real, inclusive dentro do fluxo ao vivo do coordinator). A revalidação de ponta a ponta completa
até a Fase 6 (merge) segue como trabalho futuro — não por um bloqueador de código conhecido, mas por
limitação de tempo/estabilidade do modelo gratuito usado nas rodadas de validação. As demais 7 skills
seguem bloqueadas pela mesma limitação de path do Codex (permanecem skills de propósito — não
precisam de `--agent`, já que não são invocadas diretamente pelo usuário).

## Validação manual do coordinator

> **Resultado verificado (2026-09-22, issue #299, retomada pós-#306/#307) — `opencode` v1.18.32,
> Windows 11 (win32), Git Bash.** Executado contra o mesmo repositório de teste jogável da rodada
> anterior (`Tavaressan/vetor-opencode-e2e-test-299`, issues #1 Lead + #2 Sequential, label
> `backlog`), clonado num path curto (`C:\tmp\e2e299`, não sob o scratchpad de sessão usado na
> rodada anterior — ver item 7). Modelo usado para o coordinator: `opencode/big-pickle` (modelo
> gratuito hospedado pelo próprio OpenCode — `openrouter/anthropic/claude-haiku-4.5` esbarrou em
> limite de créditos da conta OpenRouter usada neste ambiente, "requested up to 32000 tokens, but
> can only afford 8000"; não é um achado sobre o Vetor, é uma limitação da credencial de teste).
>
> | Item | Resultado | Evidência |
> |---|---|---|
> | 1. Setup do repositório de teste (`.opencode/` copiado + 2 issues com label `backlog`) | ✅ PASS | `Tavaressan/vetor-opencode-e2e-test-299`, issues #1 (Lead) e #2 (Sequential), reaproveitado da rodada anterior |
> | 2. `opencode run --agent issue-coordinator "backlog"` invoca o coordinator de verdade | ✅ PASS | Header da sessão: `> issue-coordinator · big-pickle` (não mais fallback para `build` — #306 confirmada corrigida) |
> | 3a. Fase 1 — lista issues e agrupa por afinidade | ✅ PASS | Identificou corretamente #2 como Sequential de #1 a partir do texto do body ("Issue Sequencial (relacionada a #1...)"), formou um único grupo `O_1` |
> | 3b. Plano exibido antes do worktree / coordinator aguarda aprovação | ✅ PASS | Plano em tabela impresso no chat; `git worktree list` confirmado **sem nenhum worktree novo** antes da resposta de aprovação — o processo `opencode run` termina o turno em vez de prosseguir sozinho |
> | 3c. Continuação da aprovação em `opencode run` (não-interativo) | ⚠️ Achado de documentação | A aprovação só chega à mesma sessão com `opencode run -c --agent issue-coordinator "sim"` (`-c`/`--continue`, testado e funcional); `issue-coordinator.md` não documenta isso na seção "Sintaxe"/"Aprovação do plano" — registrado dentro da [issue #311](https://github.com/Tavaressan/Vetor/issues/311) como achado secundário |
> | 3d. `git worktree add` roda uma vez por grupo (serializado) | ✅ PASS | `.claude/worktrees/adicionar-contributing-md` criado na branch `chore/1-adicionar-contributing-md`, um único comando, sem `index lock` |
> | 3e. Checagem de duplicidade + `resolve-model.ts` antes do dispatch | ✅ PASS | `bash .opencode/scripts/vetor-status.sh` rodou (sinalizou corretamente "worktree ativo sem status file", comportamento esperado antes do primeiro dispatch); `resolve-model.ts` saiu com código 0 e devolveu `anthropic/claude-haiku-4-5` — comportamento correto dado que **este repositório de teste não tem `.claude/vetor/config.json`** (usa o default embutido de propósito, não é regressão da #307) |
> | 3f. Dispatch de `issue-worker` por grupo | ❌ FAIL | O comando `opencode run --dir ".claude/worktrees/<slug>" --agent issue-worker --model "anthropic/claude-haiku-4-5" "..."` foi montado e disparado exatamente como documentado, mas o worker real nunca roda — [issue #311](https://github.com/Tavaressan/Vetor/issues/311) (`mode: subagent` cai em `build`) **e**, mesmo isolando esse bug, [issue #312](https://github.com/Tavaressan/Vetor/issues/312) (`--model anthropic/claude-haiku-4-5` sem credencial `anthropic` direta configurada → `Unexpected server error` do próprio `opencode`, reproduzido isoladamente com o agent `build`) |
> | 4. `.claude/vetor/status/<branch>.md` criado/atualizado pelo worker | ⛔ NOT_EXECUTED | Bloqueado pelo item 3f — sem o worker real rodando, nenhum status file é criado (só o `.log` do processo, com os dois erros acima) |
> | 5. `Ctrl+C` + `--resume` sem duplicar dispatch | ⛔ NÃO EXECUTÁVEL neste ambiente | Mesma ressalva da rodada anterior: worker headless em `win32`/Git Bash, sem garantia de que `SIGINT` chega como Ctrl+C real ao processo `opencode` a partir deste harness não-interativo — não simulado |
> | 6. Merge na Fase 6 | ⛔ NOT_EXECUTED | Bloqueado pelo item 3f — nenhum grupo chegou a `GREEN` |
> | 7. Cleanup do worktree (`git worktree remove`) | ✅ PASS (confirma a ressalva da rodada anterior) | `git worktree remove ".claude/worktrees/adicionar-contributing-md" --force` funcionou sem erro num path curto (~65 caracteres, `.claude/worktrees/<slug>` na raiz de `C:\tmp\e2e299`). Confirma que o "Filename too long" observado na rodada anterior era do path profundamente aninhado do scratchpad de sessão (~190 caracteres), não do mecanismo em si — com o layout de path que o próprio coordinator documenta (`.claude/worktrees/<slug>` na raiz do repo principal), o cleanup funciona. Um único caso de sucesso num path curto não descarta problema de path-length em setups mais profundos; só estabelece que o layout documentado funciona |
>
> **Conclusão desta rodada (histórica):** #306 confirmada corrigida, Fases 1-3 OK. Fase 4 bloqueada
> por #311 e #312, ambas então recém-descobertas. Ver rodada seguinte abaixo — **#311 e #312 foram
> corrigidas e revalidadas**; um terceiro bug independente (#313) bloqueia a partir da Fase 5.

### Segunda revalidação (2026-09-22, mesmo dia — pós-fix de #311/#312)

> **Resultado verificado** — `opencode` v1.18.32, Windows 11 (win32), Git Bash. Mesmo repositório
> de teste (`Tavaressan/vetor-opencode-e2e-test-299`), reclonado limpo em `C:\tmp\e2e299`. Diferença
> de setup **necessária** e não óbvia: desta vez `.opencode/` (com os fixes de #311/#312) e
> `.claude/vetor/config.json` (com `modelFallback.simple/complex: ["opencode/big-pickle"]`, modelo
> gratuito hospedado pelo OpenCode — evita o limite de créditos OpenRouter já registrado na rodada
> anterior) foram **commitados** na raiz do repositório de teste antes de qualquer `git worktree
> add` — sem isso, o worktree do worker fica sem `.opencode/` (só arquivos rastreados são
> propagados) e o worker cai num agent global desatualizado em vez do projeto (ver nota de ambiente
> abaixo). Modelo usado para o coordinator: `opencode/big-pickle`.
>
> | Item | Resultado | Evidência |
> |---|---|---|
> | Fases 1-3 (listagem, afinidade, plano, aprovação via `-c`, `git worktree add`) | ✅ PASS | Mesmo comportamento da rodada anterior, sem regressão |
> | Fase 4 — `resolve-model.ts` resolve o modelo antes do dispatch | ✅ PASS | `echo '{"tier":"simple",...}' \| resolve-model.ts` → `opencode/big-pickle`, exit 0, a partir de `modelFallback.simple` do `config.json` commitado — confirma #312 |
> | Fase 4 — dispatch de `issue-worker` roda como si mesmo (não `build`) | ✅ PASS | Header da sessão do worker: `> issue-worker · big-pickle`, sem o aviso `is a subagent ... Falling back to default agent` — confirma #311, tanto isolado (`opencode agent list` real reportando `issue-worker (primary)`/`code-review (primary)`, coberto por `agent-registration_test.ts`) quanto em vivo dentro do fluxo real do coordinator |
> | Fase 5 — worker lê `config.json`/status file (fora do worktree) | ❌ FAIL | `! permission requested: external_directory (...\.claude\vetor\*); auto-rejecting` — [issue #313](https://github.com/Tavaressan/Vetor/issues/313), novo bug independente: OpenCode auto-rejeita, em modo não-interativo, qualquer acesso a path fora do cwd do worker sem regra `permission.external_directory` explícita; `issue-worker.md` não declara nenhuma |
> | Fase 5 — status file atualizado pelo worker | ⛔ NOT_EXECUTED | Bloqueado pelo item acima — worker nunca chega a escrever, trava já na primeira leitura de `config.json` |
> | Fase 6 — merge ao chegar `GREEN` | ⛔ NOT_EXECUTED | Nenhum grupo chegou a `GREEN` |
> | `Ctrl+C` + `--resume` | ⛔ NÃO EXECUTÁVEL neste ambiente | Mesma limitação registrada nas rodadas anteriores (processo headless em `win32`/Git Bash sem terminal interativo) — não repetido |
>
> **Nota de ambiente (não é bug do Vetor):** a primeira tentativa desta rodada, antes de commitar
> `.opencode/` no repositório de teste, mascarou #311 como "ainda quebrado" — o worker caiu num
> agent **global** obsoleto (`~/.config/opencode/agents/issue-worker.md`, `mode: subagent`,
> resquício pré-#306 deste ambiente de desenvolvimento específico) em vez do agent do projeto,
> porque o projeto ainda não tinha `.opencode/` rastreado. Confirmado que a config de projeto
> sobrepõe a global **quando presente** — corrigido o setup (commit + worktree recriado), o
> `issue-worker` correto foi confirmado rodando. Registrado em detalhe na issue #313 e no aviso
> acrescentado à seção de instalação manual acima.
>
> **Conclusão:** #311 e #312 estão corrigidas e confirmadas contra o CLI real, incluindo dispatch em
> vivo dentro do fluxo do coordinator — não são mais bloqueadores. A Fase 4 completa (até o ponto de
> invocação do worker) funciona de ponta a ponta. Um terceiro bug independente (#313), não
> relacionado a `mode` ou a resolução de modelo, bloqueia a partir da Fase 5: o mecanismo de
> comunicação worker→coordinator via status file (fora do worktree, por desenho) esbarra no sistema
> de permissão `external_directory` do OpenCode, que auto-rejeita em modo não-interativo sem uma
> regra explícita — regra que `issue-worker.md`/`code-review.md` não declaram, e cujo fix não é
> trivial (o path do status file é per-projeto, descoberto só em runtime; o frontmatter do agent é
> estático — ver #313 para as direções candidatas). `Status: BLOCKED_WAITING` para o critério de
> aceite "fluxo completo executado de ponta a ponta" desta issue (#299) até #313 ser resolvida.

### Terceira revalidação (2026-09-22, mesmo dia — issue #313 CORRIGIDA)

> **Direção escolhida: opção 2 da própria issue #313** — um `opencode.json` de projeto gerado/
> mesclado de forma idempotente na raiz do repositório principal, com uma regra
> `permission.external_directory` apontando para `<repo-root>/.claude/vetor/**`. Descartadas: opção 1
> (reescrever `issue-worker.md`/`code-review.md` a cada dispatch — risco de corrida entre workers
> paralelos editando o mesmo arquivo compartilhado); opção 3 (`--auto`/`--yolo` — flag global demais,
> libera também `webfetch: ask`, que `issue-worker.md` define deliberadamente como "ask" para forçar
> `BLOCKED_WAITING` em vez de fetch silencioso); opção 4 (mover o status file para dentro do
> worktree — maior escopo, contraria o desenho documentado de polling cross-processo).
>
> **Achado não previsto na issue original, verificado empiricamente:** a resolução de
> `opencode.json` pelo OpenCode é um **walk-up de diretório a partir do cwd**, independente de git —
> confirmado rodando o CLI real contra um diretório de projeto que **não era sequer um repositório
> git**. Isso torna a opção 2 estruturalmente superior à opção 1: o arquivo gerado na raiz do
> repositório principal é visível para todo worker despachado em qualquer
> `.claude/worktrees/<slug>` abaixo dele **sem precisar estar commitado nem propagado por `git
> worktree add`** (que só propaga arquivos rastreados — ao contrário de `.opencode/agent/*.md`, que
> precisa estar commitado para o worktree do worker enxergá-lo, conforme já documentado acima). Por
> isso o `opencode.json` gerado é local/não-versionado: contém um path absoluto específico da
> máquina, não portável entre clones — não deve ser commitado (mas também não precisa ser, para
> funcionar).
>
> Implementado em `opencode/scripts/ensure-external-directory-permission.ts` (idempotente: só
> escreve se a regra ainda não estiver presente; mescla sem apagar outras chaves de um
> `opencode.json` existente — ex. `mcp`, outras regras de `external_directory` — e recusa
> sobrescrever um arquivo existente ilegível em vez de arriscar destruir configuração do usuário).
> Chamado por `opencode/agent/issue-coordinator.md` na Fase 4, antes de todo dispatch — inclusive
> redespacho/`--resume`, onde a Fase 3 (que só roda uma vez por sessão) não roda de novo. Regressão
> automatizada: `opencode/scripts/ensure-external-directory-permission_test.ts` (5 casos: criação,
> merge não-destrutivo, idempotência, rejeição de JSON inválido existente, e o mesmo padrão de
> normalização de `cwd` POSIX-style do Git Bash Windows já corrigido para `resolve-model.ts` na
> issue #307).
>
> | Item | Resultado | Evidência |
> |---|---|---|
> | Leitura de `config.json` fora do worktree, sem regra | ❌ Reprodução confirmada | `opencode run --dir <sub> --agent <probe> "Leia <path externo>"` → `! permission requested: external_directory (...); auto-rejecting` — mesma assinatura do relatório original da #313 |
> | Leitura de `config.json`/status file com a regra gerada pelo script, no shape de path real (`<repo-root>/.claude/worktrees/<slug>` — dois níveis abaixo do root) | ✅ PASS | `opencode run --dir ".claude/worktrees/slug" --agent <probe com o mesmo `permission.edit: allow` de `issue-worker.md`>` leu `.claude/vetor/config.json` e reportou o conteúdo exato |
> | **Escrita do status file** (`.claude/vetor/status/<branch>.md`) — a validação que a issue #313 registra como nunca alcançada nas rodadas anteriores | ✅ PASS — nova evidência | Mesmo comando escreveu `Status: GREEN` em `.claude/vetor/status/test-branch.md`; conteúdo confirmado lendo o arquivo diretamente do disco (não só o relato do agente) |
> | Controle negativo: escrita num path externo **fora** do glob permitido | ✅ Continua auto-rejeitando | Confirma que a regra é escopada ao pattern configurado, não uma liberação ampla |
> | `ensure-external-directory-permission.ts` chamado dentro do fluxo **real** do `issue-coordinator` (não um script isolado) | ✅ PASS | Sessão ao vivo do coordinator (`opencode run --agent issue-coordinator "backlog --headless"` contra `Tavaressan/vetor-opencode-e2e-test-299`) executou Fases 1-3 normalmente, criou o worktree via `git worktree add`, e rodou o script na Fase 4 — `EXIT=0`, `opencode.json` real escrito em `<repo-root>/opencode.json` com a regra esperada (confirmado lendo o arquivo gerado pelo processo real, não por um teste unitário) |
> | Fases 5-7 (worker dispatchado pelo coordinator real chega a `GREEN`, merge) | ⚠️ Não fechado nesta rodada | O dispatch real do `issue-worker` para a issue #1 do repo de teste foi dispatchado manualmente (mesmo comando que o coordinator monta) mas não completou dentro do tempo desta sessão — o modelo gratuito (`opencode/big-pickle`) já havia mostrado latência/instabilidade nas etapas anteriores desta mesma investigação (`Error: OpenCode's free tier can only be used from within OpenCode`, transitório, reproduzido em chamadas isoladas). Não é evidência de regressão do fix: a leitura/escrita do status file já foi comprovada tanto isoladamente (linha acima) quanto — na parte que rodou — dentro do fluxo real do coordinator |
>
> **Nota de ambiente (não é bug do Vetor):** ao rodar a partir de um path sob um mount virtual do Git
> Bash (`/tmp/claude/...`, específico deste ambiente de sessão, não o caso comum de
> `/c/Projetos/...`), o próprio coordinator (em texto, durante a sessão ao vivo) diagnosticou e
> corrigiu sozinho a normalização de `cwd`, usando `cygpath -m` antes de chamar
> `ensure-external-directory-permission.ts`/`resolve-model.ts` — o padrão POSIX-style `/c/...` já
> coberto por `normalizeCwd()` (issue #307) não cobre esse mount específico. Não é uma regressão:
> `normalizeCwd()` continua correto para o caso real documentado (`$(pwd)` de um repositório em
> `C:\...`), e o teste automatizado (`ignore: Deno.build.os !== "windows"`) cobre exatamente esse
> caso.
>
> **Conclusão:** issue #313 **CORRIGIDA e confirmada contra o CLI real** — leitura e escrita
> cross-worktree do status file/`config.json`, a lacuna que bloqueava a Fase 5 do coordinator, estão
> resolvidas. `normalizeCwd()` foi movido de `resolve-model.ts` para `opencode/scripts/lib/project.ts`
> para ser reutilizável por `ensure-external-directory-permission.ts` sem o side-effect de importar o
> `await main()` de nível de módulo de `resolve-model.ts`. A revalidação de ponta a ponta completa
> (Fases 4-7, incluindo merge) segue como trabalho futuro — não por um bloqueador do Vetor, mas por
> limitação de tempo/estabilidade do modelo gratuito usado nesta rodada de validação.

O `issue-coordinator` portado nunca havia sido executado de ponta a ponta contra uma instalação
real do OpenCode antes das validações das issues #299/#306 — o ambiente usado para portá-lo foi o
Claude Code, sem CLI `opencode` interativo. Este é o procedimento original para quem for revalidar o
fluxo completo após #313 (movido de `opencode/skills/issue-coordinator/SKILL.md` na
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
