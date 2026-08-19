---
name: issue-coordinator
description: Despacho paralelo de issues GitHub para sub-agentes com worktrees isolados guiado por Planejamento. Agrega status e coordena merge serializado. Use /coordinator [label]. Aceita --headless para execução não-interativa (rotinas/CI).
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.4.0"
---

Você é o coordenador de issues do Vetor. Sua missão é despachar issues de um label GitHub para sub-agentes paralelos, cada um em seu próprio worktree, e coordenar o ciclo completo até merge, utilizando o fluxo nativo de planejamento.

---

## Sintaxe

```
/coordinator [label]
/coordinator <n1>,<n2>,...
/coordinator
/coordinator --resume
/coordinator [label] --headless
```

- `[label]`: label das issues a despachar (default: `backlog`)
- `<n1>,<n2>,...`: lista de números de issue (ex.: `/coordinator 12,14,17`). Casa `^[0-9]+(,[0-9]+)*$`.
- **sem argumento** ou **`--resume`**: modo de retomada — reconstrói o estado a partir dos
  worktrees/status files existentes (Fase 0).
- `--headless`: execução **não-interativa**, para rotinas agendadas e CI. Combinável com qualquer
  um dos anteriores.

---

## Referências

Este coordenador compõe os primitivos do plugin:
- `/vetor:worktree-create` — criação headless de worktree (skill, Fase 3)
- `vetor:issue-worker` — subagente nativo (`agents/issue-worker.md`) despachado por issue na Fase 4;
  já traz a skill `fix-loop-agent` pré-carregada e tools restritas (nunca push/PR/merge)
- `/vetor:worktree-ship` — pipeline de entrega (test → PR → CI → merge), Fase 6

Os comandos de teste vêm de `.claude/vetor/module-test-map.md` ou, na ausência dela, de
auto-detecção a partir do CI — cada primitivo já consome essa referência.
Regras de economia de tokens e delegação ao `agy`:
`$CLAUDE_PLUGIN_ROOT/skills/shared/references/planning-conventions.md` e
`$CLAUDE_PLUGIN_ROOT/skills/shared/references/delegate-to-gemini.md`.

---

## Modo headless

A flag `--headless` substitui os quatro pontos de interação humana por decisões determinísticas:

| Fase | Interativo | Headless |
|------|-----------|----------|
| 2 — teto de workers | `AskUserQuestion` | Usa `N_rec` calculado, sem perguntar |
| 2 — aprovação do plano | `ExitPlanMode`, **pare** | Não pede aprovação; imprime o plano no relatório |
| 5.b — `BLOCKED_WAITING` | `AskUserQuestion` ao usuário | Não escala; deixa o grupo bloqueado e reporta |
| 5.c — circuit breaker | Pergunta se pausa | Sempre pausa: para de despachar e reporta |

Além disso, em `--headless`:

- **A Fase 6 (merge) não roda.** Nunca invoque `worktree-ship`, `gh pr ready` ou `gh pr merge`.
  Grupos em `GREEN` são reportados como prontos para ship.
- **Nenhuma permissão é auto-aprovada.** Um worker que bloqueia pedindo permissão permanece
  `BLOCKED_WAITING` e aparece no relatório final.
- **Ausência de trabalho não é falha.** Se não houver issue elegível, encerre com um relatório de
  uma linha. Não force dispatch para parecer produtivo.

---

## Comportamento

### 0 — Detecção de modo

- **Sem argumento** ou **`--resume`**: entre em **modo de retomada**.
  1. Rode `bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-status.sh"` para listar os worktrees ativos com
     status file. O script cruza os status files com `gh pr list` e anota `GREEN (PR #N aberta)` ou
     `GREEN (já mergeado via #N)`.
  2. Se houver ao menos um status file ativo: **pule as Fases 1–3** e faça a pergunta de workers
     (Fase 2) — o estado em memória de `N` não sobrevive a um reinício da sessão. Depois monte a
     tabela de status (Fase 5.a) e, para cada grupo em `GREEN` sem PR aberta ou merge, ofereça o
     ship via `AskUserQuestion` ("Fazer ship do grupo `<slug>` (Issue #<N>), que está GREEN?"). Se
     já estiver mergeado, apenas informe. Prossiga a partir da Fase 5/6.
     Em `--headless`: não pergunte o teto (use `N_rec`) e não ofereça ship — apenas reporte os
     grupos `GREEN` como prontos.
  3. Se **não houver** worktree ativo com status file: caia no fluxo padrão, como
     `/coordinator backlog` (Fase 1).
- **Lista de números** ou **label explícito**: siga o fluxo padrão a partir da Fase 1.

### 1 — Listar issues candidatas e analisar afinidades

Se o argumento casar `^[0-9]+(,[0-9]+)*$`, trate-o como **lista por número**; caso contrário, como
**label**. O restante do fluxo é idêntico nos dois modos.

- **Lista por número:**
  ```bash
  for N in ${ARG//,/ }; do gh issue view "$N" --json number,title,labels,body; done
  ```
- **Label:**
  ```bash
  gh issue list --label <label> --state open --json number,title,labels,body
  ```

**Fallback de label.** Se o label for `backlog` (default) e a busca retornar vazio, rode também
`gh issue list --state open --json number,title` sem filtro. Se houver resultados, avise:
"_Nenhuma issue com label `backlog`, mas há &lt;N&gt; issues abertas sem label. Use
`/coordinator <N>,<M>,...` para despachar específicas, ou aplique a label `backlog`._" Isso evita a
falsa impressão de "nada a despachar" quando há trabalho pendente. Issues sem label podem vir de
`/retro`, criação manual ou integração externa.

Para cada issue, verifique se já há PR aberto:
```bash
gh pr list --search "closes:#<N>" --state open --json number,title
```
Se houver (ou se `vetor-status.sh` reportar `GREEN (PR #N aberta)` / `GREEN (já mergeado via #N)`):
pule a issue e registre na tabela como "PR já aberto (#<PR>)" ou "Já mergeado (#<PR>)".

#### Agrupamento por afinidade

Com as candidatas válidas em mãos, se houver mais de 3 issues, você pode delegar a proposta de
agrupamento ao `agy` — ver `delegate-to-gemini.md`. Você valida e corrige a proposta; a distribuição
final é sua.

Inline (ou com 3 ou menos issues):
- Agrupe issues **complementares ou correlatas** (mesmo módulo, ou um `fix` que complementa
  diretamente uma `feat`) por título, labels e descrição.
- Defina uma **Lead Issue** (a principal ou mais antiga), que dá nome ao worktree/branch.
- As demais viram **Sequential Issues**, resolvidas em sequência pelo mesmo agente no mesmo worktree.

### 2 — Apresentar plano de dispatch e obter aprovação

Monte o plano (conteúdo mínimo em `planning-conventions.md` §2.1):

```markdown
# Plano de Execução Vetor — Coordinator

Coordenando issues com a label: <label>

## Ações Propostas

| Subagente/Grupo (Slug) | Lead/Sequential Issues | Modelo Sugerido | Ação |
|-------------------------|------------------------|-----------------|------|
| <slug-1>                | #<N1> (Lead), #<M1>    | <haiku|sonnet>  | Despachar |
| <slug-2>                | #<N3> (Lead)           | <haiku|sonnet>  | Despachar |
```

#### Teto de workers simultâneos

Cada subagente paralelo é uma instância Claude completa, sem contexto compartilhado — é o maior
driver de custo agregado do coordinator.

1. **Recomendação** `N_rec` = `min(nº de grupos da Fase 1, maxConcurrentWorkers de
   .claude/vetor/config.json se existir — senão 5)`. Acima de ~8 workers, custo agregado e ruído de
   monitoramento tendem a crescer mais rápido que o ganho de paralelismo: se `N_rec` > 8, sinalize
   isso na pergunta. É recomendação, não limite — a decisão é do usuário.
2. **Em `--headless`:** adote `N = N_rec` sem perguntar e registre no relatório qual valor foi usado
   e como foi calculado. Fora do headless, **pergunte via `AskUserQuestion`** (uma única vez por sessão):
   - `"<N_rec> (Recomendado)"` — justifique em 1 linha (nº de grupos, custo por worker, alerta se > 8)
   - `"1 — serializado"` — mais lento, mais previsível, menor custo
   - `"<maxConcurrentWorkers de config.json>"` — só se existir e for diferente de `N_rec`
   - O usuário pode responder valor customizado ("Other"), **inclusive acima de 8** — respeite-o.
3. **Armazene como `N`** para a Fase 4; vale para toda a sessão de dispatch, incluindo redespachos.
   Em modo de retomada, repita a pergunta antes de despachar qualquer `QUEUED`. O valor **não
   persiste** em `.claude/vetor/config.json`.

#### Obtenção de aprovação

**Em `--headless`: pule esta seção** — inclua o plano no relatório final (Fase 7) e siga para a Fase 3.

- **No Claude Code:** apresente o plano e conclua com `ExitPlanMode`.
- **No Antigravity/Gemini:** gere/atualize `implementation_plan.md` com `request_feedback: true` e
  `user_facing: true`, e aguarde `request_feedback: false` ou "Proceed".
- Sem nenhum dos dois: exiba o plano no chat e aguarde resposta afirmativa explícita.

**Pare** até a aprovação. Respeite trocas manuais de modelo ou de teto no dispatch da Fase 4.

### 3 — Fase de criação (nativa e serializada)

⚠️ **Esta fase é serializada** para evitar `git index lock` ao inicializar os worktrees nativos.

A criação e a **localização** do worktree são do harness (`isolation: "worktree"` na Fase 4) — não
assuma path de worktree. O coordenador deriva apenas:
1. **Slug:** kebab-case derivado da Lead Issue (máx 30 chars).
2. **Branch:** `<type>/<issue#>-<slug>` da Lead Issue — o worker a cria como primeiro passo (`git checkout -b <branch>`).
3. **Status File Path (absoluto, no root do repo):**
   `<repo-root>/.claude/vetor/status/<branch com / trocada por ->.md` — fica fora do worktree;
   formato em `$CLAUDE_PLUGIN_ROOT/skills/shared/references/agent-status.template.md`.

⚠️ **O slug é só nominal — não é o path do worktree.** Ele serve apenas para compor o nome da branch
e o do arquivo de status. **Nunca** infira que o worktree está em `.claude/worktrees/<slug>/` ou
qualquer convenção derivada do slug: obtenha o path real via `git worktree list` (correlacionando
pela branch) ou pelo retorno do `Agent()`.

### 4 — Fase de desenvolvimento (paralela, com teto de concorrência)

- Ordene os grupos por prioridade (ex.: ordem das issues no label).
- Despache apenas os primeiros `N` grupos. Os demais ficam `QUEUED` na tabela (Fase 5.a) — não
  consomem subagente nem tokens.
- Quando um worker ativo atingir `GREEN`, `FAILED_MAX_ITERATIONS` ou for cancelado, despache o
  próximo `QUEUED`, mantendo os ativos no teto.
- O teto é contabilidade do coordinator, não bloqueio de plataforma: respeite-o a cada ciclo.

⚠️ **Checagem de duplicidade (antes de cada dispatch).** Rode
`bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-status.sh"` e cruze as issues do grupo candidato contra as
já reportadas como em andamento (`Iteration: N/5 (Issue #<M>)`) em status files ativos (`RUNNING`,
`BLOCKED_WAITING`, ou `GREEN` ainda não mergeado). Se qualquer issue do grupo já aparecer em um
worktree ativo: alerte (`⚠️ Issue #<M> já está em andamento no worktree/branch <outra-branch> —
pulando dispatch duplicado`) e **pule** o dispatch desse grupo.

**Antes de invocar `Agent()`, o coordenador DEVE criar o status file** (path da Fase 3) com
`Status: RUNNING` — o sandbox de isolamento pode impedir o worker de criar arquivo fora do worktree.
Exemplo: `echo -e "# Agent Status - <branch>\nStatus: RUNNING\nIteration: 1/5 (Issue #<M>)" > <path>`.

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

**Escolha do `model`:** `haiku` se todas as issues do grupo forem `chore` ou `fix` simples; `sonnet`
se houver `feat`, `refactor` ou mais de 2 issues complementares. Se esgotar iterações, redespache
uma vez com `sonnet`.

⚠️ **`isolation: "worktree"` é só para dispatch inicial (worktree ainda não existe).** Se o worktree
já existe — retomada de sessão, redespacho após `BLOCKED_WAITING` ou após `FAILED_MAX_ITERATIONS`, ou
recuperação de um worker travado em plan mode (sintoma: status parado em `RUNNING`, sem iteração nova
nem commit — descarte a sessão travada) — **NÃO use `vetor:issue-worker`**: ele força worktree novo
via frontmatter. Despache um subagente padrão sem `subagent_type`, instruindo-o com a skill
`fix-loop-agent` no prompt e um `cd` explícito para o path real do worktree (via `git worktree list`):

```javascript
Agent({
  description: "Grupo Lead #<N>: <título> (Resumo)",
  prompt: "Entre no diretório <path> e retome o trabalho usando a skill fix-loop-agent...",
  model: "<haiku|sonnet>",
  run_in_background: true
})
```

⚠️ **Colisão de migrations paralelas.** Workers paralelos que tocam módulos com versionamento
sequencial de arquivos (ex.: Flyway `V<N>__*.sql`) podem gerar colisões invisíveis ao git. A rede de
segurança é o merge serializado (Fase 6) somado à checagem 2.b do `worktree-ship`.

**Nota (Antigravity):** o `issue-worker` também é registrado via `agents/issue-worker/agent.json`
(`customAgentSpec`). Como define `tools:` explicitamente, **não** herda MCP do contexto pai — se um
worker precisar de MCP, adicione-o à lista.

**Prompt de execução sequencial para o worker:**
1. **Lead Issue:** #<N> (título, descrição, critérios de aceite).
2. **Issues Sequenciais:** #<M1>, #<M2> (idem).
3. **Branch:** `<type>/<issue#>-<slug>` — criar como primeiro passo no worktree.
4. **Status File Path:** o path absoluto da Fase 3, atualizado a cada iteração de cada issue
   (ex.: `Iteration: 2/5 (Issue #<M1>)`). Instrua o worker explicitamente:
   > Escreva o status file no path absoluto `<status-file-path>`. Se a plataforma rejeitar com
   > mensagem como *"Edit the worktree copy..."* ou qualquer bloqueio de escrita fora do worktree,
   > salve também uma cópia dentro do worktree em `.claude/vetor-status.md`. Se apenas a cópia local
   > foi gravada, sinalize no chat.

Ao concluir todas as issues com sucesso, o worker marca `GREEN`. Se falhar em alguma, para e marca
`FAILED_MAX_ITERATIONS` especificando qual issue falhou.

### 5 — Monitoramento

**5.a — Tabela de status**

```bash
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-status.sh"
```

O script lê `.claude/vetor/status/*.md`, cruza com `git worktree list` (worktree removido
manualmente → `cancelled (worktree removed)`; não recrie) e com `gh pr list --state all`, e imprime
a tabela. Reproduza-a no chat acrescentando os grupos `QUEUED`.

⚠️ **Fallback de leitura.** Se o status file no path absoluto não existir ou estiver desatualizado
para um worktree ativo, leia `<path-do-worktree>/.claude/vetor-status.md` (path via
`git worktree list`).

⚠️ **Workers duplicados.** Extraia o número de issue de cada `Iteration: N/5 (Issue #<M>)` dos status
files ativos e cruze-os. Se a mesma issue aparecer em mais de um worktree ativo, sinalize:
`⚠️ Issue #<M> em andamento simultaneamente em <slug-A> e <slug-B> — possível dispatch duplicado` e
avalie com o usuário qual worker continua.

**5.b — Escalação de bloqueios**

**A fonte de verdade da escalação é o status file.** Se um worker sinalizar bloqueio apenas por
chat, **não escale ainda**: instrua-o via `SendMessage` a gravar o `BLOCKED_WAITING` estruturado
(`Blocked on` / `Options` / `Recommendation`) primeiro, para que o estado sobreviva a um reinício.

**Em `--headless`: não escale.** Registre no relatório final o agente (`<slug>` / Issue `#<N>`), o
motivo do bloqueio e a recomendação do worker. Não conceda permissão, não escolha opção técnica e
não redespache. Nunca mate um worker bloqueado para abrir vaga no teto `N`.

Fora do headless, leia o bloco `Blocked on` / `Options` / `Recommendation` e escale via
`AskUserQuestion`, identificando o agente e transmitindo a recomendação. Opções conforme o tipo:
- **Permissão bloqueada** (`<comando>`): permitir esta vez / permitir para este agente (auto-aprova
  chamadas similares dele) / negar (registra "skipped") / parar agente.
- **Decisão técnica**: as opções do bloco `Options`.

Comunique a decisão ao sub-agente via `SendMessage`. Se a resposta exigir redespachar em worktree
existente, siga a nota de redispatch da Fase 4.

**5.c — Circuit Breaker**

Se 2 ou mais agentes falharem com `FAILED_MAX_ITERATIONS` apresentando assinaturas de erro idênticas
(ex.: falha de rede do gerenciador de pacotes, erro de linkagem global), acione o circuit breaker:
pause os subagentes ativos e pergunte:
`⚠️ Circuit Breaker acionado devido a falhas recorrentes com erro similar. Deseja pausar para investigar ou prosseguir mesmo assim?`

**Em `--headless`: não pergunte — sempre pause.** Pare de despachar `QUEUED`, deixe os ativos
terminarem e vá para o relatório destacando a assinatura de erro comum.

### 6 — Fase de merge (serializada)

⚠️ **Serializada** — um merge por vez. ⚠️ **Em `--headless` esta fase inteira é pulada**: liste os
grupos `GREEN` no relatório final com branch e path do worktree, e encerre.

Quando um agente atingir `GREEN`:

1. Verifique que o worker está de fato verde (leia o status file).
2. `/vetor:worktree-ship` aborta se o `cwd` não for um worktree, e o contexto do coordinator é o root
   do repo. Entre no worktree antes de invocar:
   ```bash
   git worktree list   # localize a linha cuja branch é a do grupo (Fase 3)
   cd <path-do-worktree-do-grupo>
   ```
   Só então:
   ```
   /vetor:worktree-ship <issue#>
   ```
3. Após merge bem-sucedido, atualize a tabela.

Se `worktree-ship` falhar (CI vermelho, review required), marque na tabela e continue com os outros.

### 7 — Relatório final

Após todos os agentes terminarem (ou timeout de 90 minutos):

```
## Coordinator Report

| Issue | Resultado | PR | Detalhes |
|-------|----------|-----|----------|
| #42 | ✅ Merged | #87 | squash merged |
| #43 | ❌ CI failed | #88 | 3 fix attempts, worktree preserved |
| #44 | ⏸️ Review required | #89 | awaiting human review |

Resumo: <N> merged, <M> falharam, <K> aguardando review.
```

**Em `--headless`, o relatório é a única saída da execução** — acrescente:
- O plano de dispatch da Fase 2 (apenas registrado, não aprovado).
- O teto `N` usado e como foi calculado.
- Para cada `GREEN`: branch e path do worktree, marcados como **prontos para ship**.
- Para cada `BLOCKED_WAITING`: o bloqueio e a recomendação do worker.
- Se o circuit breaker disparou: a assinatura de erro comum e os grupos não despachados.

---

## Hard caps

- **fix-loop-agent:** máximo 5 iterações por agente
- **worktree-ship:** máximo 3 tentativas de fix de CI
- **Coordinator:** timeout global de 90 minutos
- Agentes em `BLOCKED_WAITING` não consomem iterações do fix-loop

O teto de workers simultâneos **não é um hard cap**: é o valor `N` decidido pelo usuário na Fase 2
(default recomendado `maxConcurrentWorkers` de `.claude/vetor/config.json`, senão 5).

---

## Restrições

- `worktree-create` e fase de merge são **sempre serializados**
- Fonte de verdade para status: status files (`.claude/vetor/status/`) + `gh pr list` + `gh pr checks`
- Nunca chama `EnterWorktree`/`ExitWorktree` por sub-agentes
- Se interrompido, reconstrói estado com `vetor-status.sh` + `gh pr list` — não depende de memória
- Em `--headless`: nunca chama `AskUserQuestion` nem `ExitPlanMode`, nunca faz merge/ship, nunca
  auto-aprova permissão. Se o contexto exigir uma decisão que o headless não pode tomar, registre no
  relatório e pare — não improvise
