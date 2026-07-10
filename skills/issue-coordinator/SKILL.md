---
name: issue-coordinator
description: Despacho paralelo de issues GitHub para sub-agentes com worktrees isolados guiado por Planejamento. Agrega status e coordena merge serializado. Use /coordinator [label].
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.1.0"
---

Você é o coordenador de issues do Vetor. Sua missão é despachar issues de um label GitHub para sub-agentes paralelos, cada um em seu próprio worktree, e coordenar o ciclo completo até merge, utilizando o fluxo nativo de planejamento.

---

## Sintaxe

```
/coordinator [label]
/coordinator <n1>,<n2>,...
```

- `[label]`: label das issues a despachar (default: `backlog`)
- `<n1>,<n2>,...`: alternativa ao label — lista de números de issue separados por vírgula
  (ex.: `/coordinator 12,14,17`). Casa o regex `^[0-9]+(,[0-9]+)*$`.

---

## Referências

Este coordenador compõe os primitivos do plugin:
- `/vetor:worktree-create` — criação headless de worktree (skill, Fase 3)
- `vetor:issue-worker` — subagente nativo (`agents/issue-worker.md`) despachado por issue na Fase 4;
  já traz a skill `fix-loop-agent` pré-carregada e tools restritas (nunca push/PR/merge)
- `/vetor:worktree-ship` — pipeline de entrega (test → PR → CI → merge), Fase 6

Os comandos de teste vêm de `.claude/vetor/module-test-map.md` (cópia preenchida pelo
usuário) ou, na ausência dela, de auto-detecção a partir do CI — cada primitivo já consome essa referência.
Consulte `$CLAUDE_PLUGIN_ROOT/skills/shared/references/planning-conventions.md` para as regras de economia de tokens e modelos.

---

## Comportamento

### 1 — Listar issues candidatas e analisar afinidades

**Detecção do argumento (início da fase).** Se o argumento casar o regex `^[0-9]+(,[0-9]+)*$`, trate-o
como **lista de issues por número**; caso contrário, como **label** (fluxo padrão).

- **Lista por número:** busque cada issue diretamente:
  ```bash
  for N in ${ARG//,/ }; do gh issue view "$N" --json number,title,labels,body; done
  ```
- **Label:** use a CLI `gh` para buscar as issues pelo label:
  ```bash
  gh issue list --label <label> --state open --json number,title,labels,body
  ```

O restante do fluxo (verificação de PR já aberto, análise de afinidade, dispatch) é **idêntico** nos
dois modos.

Para cada issue, verifique se já há PR aberto:
```bash
gh pr list --search "closes:#<N>" --state open --json number,title
```

Se já houver PR: pule a issue e registre na tabela como "PR já aberto (#<PR>)".

#### Análise de Afinidade e Agrupamento Sequencial (Delegação ao Gemini):
Com as candidatas válidas em mãos, se o CLI `agy` estiver disponível (verifique via `command -v agy`) e houver mais de 3 issues a processar, você pode delegar a proposta de agrupamento de afinidade:
1. Imprima o log: `echo "[Vetor:Gemini] Delegando tarefa: Propondo agrupamento de afinidade de issues"`
2. Execute o comando passando o JSON das candidatas:
   ```bash
   gh issue list --label <label> --state open --json number,title,labels,body | agy -p "Analise estas issues em formato JSON e sugira um agrupamento de afinidade. Retorne o resultado em formato markdown estruturado indicando para cada grupo a Lead Issue (principal/mais antiga), as issues secundárias subsequentes do grupo, o slug sugerido e se o modelo ideal de execução deve ser haiku (ajustes simples/chore) ou sonnet (features complexas/refactor)."
   ```
3. O Claude analisa a proposta sugerida, corrige quaisquer desvios de escopo e define a distribuição final.

Se o agy não estiver disponível ou houver 3 ou menos issues, faça a análise inline de forma nativa:
- Analise o título, labels e descrição para agrupar issues **complementares ou correlatas** (ex: correções no mesmo módulo, ou uma issue de `fix` que complementa diretamente uma `feat`).
- Defina uma issue como **Lead Issue** (geralmente a principal ou mais antiga) que dará nome ao worktree/branch.
- Associe as issues secundárias a ela como **Sequential Issues**. Elas serão resolvidas sequencialmente pelo mesmo agente no mesmo worktree.

### 2 — Apresentar plano de dispatch e obter aprovação

Monte o plano de dispatch estruturado (ver `$CLAUDE_PLUGIN_ROOT/skills/shared/references/planning-conventions.md` §2.1 para o conteúdo mínimo):

```markdown
# Plano de Execução Vetor — Coordinator

Coordenando issues com a label: <label>

## Ações Propostas

| Subagente/Grupo (Slug) | Lead/Sequential Issues | Modelo Sugerido | Ação |
|-------------------------|------------------------|-----------------|------|
| <slug-1>                | #<N1> (Lead), #<M1>    | <haiku|sonnet>  | Despachar |
| <slug-2>                | #<N3> (Lead)           | <haiku|sonnet>  | Despachar |
```

Obtenha aprovação seguindo o mecanismo do ecossistema atual (planning-conventions.md §2.2):
- **No Claude Code:** apresente o plano acima e conclua com `ExitPlanMode` para pedir aprovação.
- **No Antigravity/Gemini:** gere/atualize `implementation_plan.md` com `request_feedback: true` e
  `user_facing: true`, e aguarde `request_feedback: false` ou clique em "Proceed".
- Sem nenhum dos dois: exiba o plano no chat e aguarde resposta afirmativa explícita.

**Pare** até a aprovação. Se o usuário pedir para trocar o modelo de algum grupo, respeite a escolha
manual e utilize o modelo modificado no dispatch da Fase 4.


### 3 — Fase de criação (nativa e serializada)

⚠️ **Esta fase é serializada** para evitar `git index lock` ao inicializar os worktrees nativos.

A criação e a **localização** do worktree são do harness (`isolation: "worktree"` no dispatch da
Fase 4) — não assuma path de worktree. O coordenador deriva apenas:
1. **Slug:** kebab-case derivado da Lead Issue (máx 30 chars).
2. **Branch:** `<type>/<issue#>-<slug>` da Lead Issue — o worker a cria como primeiro passo
   (`git checkout -b <branch>`).
3. **Status File Path (absoluto, no root do repo):**
   `<repo-root>/.claude/vetor/status/<branch com / trocada por ->.md` — fica fora do worktree;
   formato em `$CLAUDE_PLUGIN_ROOT/skills/shared/references/agent-status.template.md`.

⚠️ **O slug é só nominal — não é o path do worktree.** Ele serve unicamente para (a) compor o nome
da branch e (b) compor o nome do arquivo de status (que fica FORA do worktree, em
`.claude/vetor/status/`, então independe de onde o harness de fato materializa o worktree). Quando
o dispatch usa `isolation: "worktree"` nativo, quem decide o path real do worktree é a
plataforma/harness — **nunca** infira ou assuma que o worktree está em `.claude/worktrees/<slug>/`
ou qualquer outra convenção derivada do slug. O worker despachado, ou qualquer agente que precise
do path real do worktree (ex.: para instruir outro processo, ou para o `worktree-ship` na Fase 6),
deve obtê-lo via `git worktree list` (correlacionando pela branch) ou pelo campo de retorno do
`Agent()` ao concluir — nunca inferido do slug.

### 4 — Fase de desenvolvimento (paralela, com teto de concorrência)

**Teto de workers simultâneos (economia de tokens):** cada subagente paralelo é uma instância Claude
completa, sem contexto compartilhado — é o maior driver de custo agregado do coordinator. Antes de
despachar, leia `.claude/vetor/config.json` em busca de `maxConcurrentWorkers` (o schema de
`.claude/settings.json` do Claude Code rejeita chaves de topo customizadas como `vetor`, então não use
esse arquivo); na ausência de `.claude/vetor/config.json` ou da chave, **default 5**.

- Ordene os grupos (Fase 1) por prioridade (ex.: ordem das issues no label).
- Despache apenas os primeiros N grupos (N = teto). Os demais ficam com status `QUEUED` na tabela de
  monitoramento (Fase 5.a) — não consomem subagente nem tokens até serem despachados.
- Sempre que um worker ativo atingir `GREEN`, `FAILED_MAX_ITERATIONS` ou for cancelado, despache o
  próximo grupo `QUEUED` da fila, mantendo o número de workers ativos no teto.
- Isto é **contabilidade real do coordinator, não um bloqueio de plataforma** — dependeria do
  coordinator de fato respeitar o teto a cada ciclo de monitoramento (Fase 5).

Despache um sub-agente por grupo de issues (respeitando o teto acima) utilizando a chamada do
subagente nativo `issue-worker` com isolamento de worktree nativo (`isolation: "worktree"`):

```javascript
Agent({
  description: "Grupo Lead #<N>: <título>",
  prompt: "...",
  subagent_type: "vetor:issue-worker",
  model: "<haiku|sonnet>",
  isolation: "worktree",
  run_in_background: true
})
```

**Critério de escolha do `model`:** use `haiku` se todas as issues do grupo forem `chore` ou `fix` simples; use `sonnet` se houver alguma `feat`, `refactor` ou se o grupo contiver mais de 2 issues complementares. Se esgotar iterações, redespache uma vez com `sonnet`.

⚠️ **Nota (colisão de migrations paralelas).** Workers paralelos que tocam o mesmo módulo com
versionamento sequencial de arquivos (ex.: migrations Flyway `V<N>__*.sql`) podem gerar colisões de
versão **invisíveis ao git** — arquivos distintos, sem conflito textual. A rede de segurança é o merge
serializado (Fase 6) combinado com a checagem 2.b do `worktree-ship`, que falha cedo ao detectar dois
arquivos com o mesmo número de versão após o sync com a branch default.

⚠️ **`isolation: "worktree"` é só para dispatch inicial (worktree ainda não existe).** Se o worktree já
existe — retomada de uma sessão anterior, redespacho após resposta a um `BLOCKED_WAITING` (Fase 5.b)
ou redespacho após `FAILED_MAX_ITERATIONS` — **NÃO** passe `isolation: "worktree"`: isso cria um
worktree novo e desconectado do path pretendido, e a ferramenta `Write` recusa gravar no caminho
correto quando o agente descobre a inconsistência. Nesse caso, despache **sem** o parâmetro
`isolation` e instrua um `cd` explícito para o path real do worktree existente (obtenha via
`git worktree list`) no prompt do worker.

**Nota (Antigravity):** o `issue-worker` também é registrado para o Google Antigravity via
`agents/issue-worker/agent.json` (`customAgentSpec`), complementando `agents/issue-worker.md`
usado pelo Claude Code. Como ele define `tools:` explicitamente, **não** herda MCP do contexto
pai — se um worker precisar de MCP (ex.: banco de dados), adicione-o à lista de ferramentas.

**Prompt de execução sequencial para o worker:**
Envie ao `issue-worker` a lista de tarefas a realizar:
1. **Lead Issue:** #<N> (título, descrição, critérios de aceite).
2. **Issues Sequenciais:** #<M1>, #<M2> (título, descrição, critérios de aceite).
3. **Branch:** `<type>/<issue#>-<slug>` (Fase 3) — criar como primeiro passo no worktree.
4. **Status File Path:** o path absoluto derivado na Fase 3. Instrua o worker a atualizá-lo a cada
   iteração de cada issue do grupo, refletindo a issue atual (ex.: `Iteration: 2/5 (Issue #<M1>)`).
   O arquivo fica fora do worktree — sem risco de commit acidental.

Quando o worker concluir todas as issues do grupo com sucesso, ele deve marcar o status final como `GREEN`. Caso falhe em alguma, para e marca como `FAILED_MAX_ITERATIONS` especificando qual issue do grupo falhou.

### 5 — Monitoramento

Enquanto há agentes rodando, monitore periodicamente:

**5.a — Tabela de status**

```bash
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-status.sh"
```

O script lê `.claude/vetor/status/*.md`, cruza com `git worktree list` (worktree removido
manualmente → `cancelled (worktree removed)`; não recrie) e imprime a tabela pronta. Reproduza-a
no chat acrescentando as linhas dos grupos ainda `QUEUED` (aguardando vaga no teto da Fase 4).
Ao mover um grupo de `QUEUED` para despachado, siga a ordem de prioridade da Fase 4.

**5.b — Escalação de bloqueios**

**A fonte de verdade da escalação é o status file.** Se um worker sinalizar bloqueio apenas por
chat, sem gravar `Status: BLOCKED_WAITING` com os blocos estruturados no arquivo, **não escale ainda**:
instrua-o via `SendMessage` a gravar o `BLOCKED_WAITING` estruturado (`Blocked on` / `Options` /
`Recommendation`) primeiro. Isso garante que o estado sobreviva a um reinício da sessão coordenadora.

Se um agente estiver em `BLOCKED_WAITING`, leia o bloco `Blocked on` / `Options` /
`Recommendation` do status file e escale ao usuário via `AskUserQuestion`, identificando o agente
(`<slug>` / Issue `#<N>`) e transmitindo a recomendação do agente. As opções dependem do tipo:
- **Permissão bloqueada** (`<comando>`): permitir esta vez / permitir para este agente
  (auto-aprova chamadas similares deste agente) / negar (registra "skipped") / parar agente.
- **Decisão técnica**: as opções do bloco `Options` do status file.

Após a resposta, comunique a decisão ao sub-agente via `SendMessage`. Se "permitir para este
agente" foi escolhido, registre a permissão expandida em memória e auto-aprove chamadas futuras
do mesmo tipo daquele agente.

Se a resposta exigir **redespachar** um novo `Agent()` para um worktree que já existe, **NÃO**
passe `isolation: "worktree"` — ver a nota de redispatch na Fase 4.

**5.c — Circuit Breaker (Disjuntor de Falhas)**
- Se 2 ou mais agentes falharem na mesma iteração com o status `FAILED_MAX_ITERATIONS` apresentando assinaturas de erro idênticas (ex.: falha de rede do gerenciador de pacotes, erro de linkagem em arquivo global, etc.), acione o circuit breaker.
- Envie um comando de pausa para todos os subagentes ativos e pergunte ao usuário:
  `⚠️ Circuit Breaker acionado devido a falhas recorrentes com erro similar. Deseja pausar para investigar ou prosseguir mesmo assim?`

### 6 — Fase de merge (serializada)

⚠️ **Esta fase é serializada** — um merge de cada vez para evitar conflitos.

Quando um agente atingir `GREEN`:

1. Verifique que o worker está de fato verde (leia o status file do grupo)
2. Execute `worktree-ship` para o worktree correspondente:
   ```
   /vetor:worktree-ship <issue#>
   ```
3. Após merge bem-sucedido, atualize a tabela.

Se `worktree-ship` falhar (CI vermelho, review required), marque na tabela e continue com outros agentes.

### 7 — Relatório final

Após todos os agentes terminarem (ou timeout de 90 minutos), apresente o relatório no chat:

```
## Coordinator Report

| Issue | Resultado | PR | Detalhes |
|-------|----------|-----|----------|
| #42 | ✅ Merged | #87 | squash merged |
| #43 | ❌ CI failed | #88 | 3 fix attempts, worktree preserved |
| #44 | ⏸️ Review required | #89 | awaiting human review |

Resumo: <N> merged, <M> falharam, <K> aguardando review.
```

---

## Hard caps

- **fix-loop-agent:** máximo 5 iterações por agente
- **worktree-ship:** máximo 3 tentativas de fix de CI
- **Coordinator:** timeout global de 90 minutos — após isso, reporta status final e para
- **Coordinator:** máximo `maxConcurrentWorkers` workers despachados simultaneamente por rodada
  (default 5, configurável em `.claude/vetor/config.json`) — grupos além do teto ficam `QUEUED` até
  uma vaga abrir (Fase 4)
- Agentes em `BLOCKED_WAITING` não consomem iterações do fix-loop

---

## Restrições

- `worktree-create` e fase de merge são **sempre serializados** — nunca em paralelo
- Fonte de verdade para status: status files (`.claude/vetor/status/`) + `gh pr list` + `gh pr checks`
- Nunca chama `EnterWorktree` ou `ExitWorktree` por sub-agentes — cada Agent gerencia seu próprio contexto
- Se interrompido e reiniciado, reconstrói estado com `vetor-status.sh` + `gh pr list` — não depende de estado em memória
