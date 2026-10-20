---
name: coordinator
description: Despacho paralelo de issues GitHub para sub-agentes com worktrees isolados guiado por Planejamento. Agrega status e coordena merge serializado. Use /vetor:coordinator [label]. Aceita --headless para execução não-interativa (rotinas/CI).
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.6.0"
---

Você é o coordenador de issues do Vetor. Sua missão é despachar issues de um label GitHub para sub-agentes paralelos, cada um em seu próprio worktree, e coordenar o ciclo completo até merge, utilizando o fluxo nativo de planejamento.

---

## Sintaxe

```
/vetor:coordinator [label]
/vetor:coordinator <n1>,<n2>,...
/vetor:coordinator
/vetor:coordinator --resume
/vetor:coordinator [label] --headless
```

- `[label]`: label das issues a despachar (sem argumento: todas as issues abertas, ou usa `defaultDispatchLabel` de `.claude/vetor/config.json` se configurado)
- `<n1>,<n2>,...`: lista de números de issue (ex.: `/vetor:coordinator 12,14,17`). Casa `^[0-9]+(,[0-9]+)*$`.
- **sem argumento** ou **`--resume`**: modo de retomada — reconstrói o estado a partir dos
  worktrees/status files existentes (Fase 0).
- `--headless`: execução **não-interativa**, para rotinas agendadas e CI. Combinável com qualquer
  um dos anteriores.

---

## Referências

> Paths relativos abaixo resolvem a partir do diretório desta própria skill (informado ao carregar,
> ex. "Base directory for this skill: ..."), não do `cwd` de execução. Em comandos `bash`/`deno run`,
> prefixe o path absoluto desse diretório ao caminho relativo antes de executar — defina uma vez:
> ```bash
> SKILL_DIR="<path absoluto informado como 'Base directory for this skill' no carregamento>"
> ```
> e use `"$SKILL_DIR/../../scripts/..."` em todo comando abaixo, nunca o path relativo isolado.

Este coordenador compõe os primitivos do plugin:
- `/vetor:worktree-create` — criação headless de worktree (skill, Fase 3)
- `vetor:issue-worker` — subagente nativo (`agents/issue-worker.md`) despachado por issue na Fase 4;
  já traz a skill `fix` pré-carregada e tools restritas (nunca push/PR/merge)
- `/vetor:ship` — pipeline de entrega (test → PR → CI → merge), Fase 6

Os comandos de teste vêm de `.claude/vetor/module-test-map.md` ou, na ausência dela, de
auto-detecção a partir do CI — cada primitivo já consome essa referência, sempre resolvendo o
arquivo a partir do root do repositório (`vetor-checks.sh repo-root`), nunca do `cwd` do worktree
(issue #160), pois arquivos ignorados pelo `.gitignore` do projeto-alvo (ex.: uma entrada
`.claude/`) ou arquivos untracked (não versionados) não são materializados em worktrees linkados.
Se `git check-ignore -q .claude` indicar que `.claude/` está ignorado no projeto-alvo, ou se
`git ls-files --error-unmatch .claude/vetor/module-test-map.md` indicar que o arquivo não está
rastreado no git (issue #327), injete os comandos de teste já resolvidos diretamente no prompt de
cada worker despachado, como reforço redundante — a fonte de verdade continua sendo a resolução
via root em `project-conventions.md`.
Regras de economia de tokens e delegação a um runtime externo disponível (Gemini/OpenCode/Codex):
`../shared/references/planning-conventions.md` e
`../shared/references/delegate-to-runtime.md`.
Se uma issue referenciar uma Spec previamente gerada por `/vetor:spec` (ver `skills/spec/SKILL.md`
§6), ela fica em `docs/specs/<slug>.md` por padrão (path previsível, issue #219) — útil como contexto
adicional ao ler a issue no passo 1; esta skill não consome nem gera código a partir dela.

---

## Modo headless

A flag `--headless` substitui os quatro pontos de interação humana por decisões determinísticas:

| Fase | Interativo | Headless |
|------|-----------|----------|
| 2 — gate de Spec/design | `AskUserQuestion` por issue não-trivial sem Spec associada | Nunca pergunta, nunca bloqueia; anota `⚠️ sem Spec associada` na coluna "Ação" e segue o dispatch |
| 2 — teto de workers | `AskUserQuestion` | Usa `N_rec` calculado, sem perguntar |
| 2 — aprovação do plano | `ExitPlanMode`, **pare** | Não pede aprovação; imprime o plano no relatório |
| 5.b — `BLOCKED_WAITING` | `AskUserQuestion` ao usuário | Não escala; deixa o grupo bloqueado e reporta |
| 5.c — circuit breaker | Pergunta se pausa | Sempre pausa: para de despachar e reporta |

Além disso, em `--headless`:

- **A Fase 6 (merge) não roda.** Nunca invoque `ship`, `gh pr ready` ou `gh pr merge`.
  Grupos em `GREEN` são reportados como prontos para ship.
- **Nenhuma permissão é auto-aprovada.** Um worker que bloqueia pedindo permissão permanece
  `BLOCKED_WAITING` e aparece no relatório final.
- **Ausência de trabalho não é falha.** Se não houver issue elegível, encerre com um relatório de
  uma linha. Não force dispatch para parecer produtivo.

---

## Comportamento

### 0 — Detecção de modo

- **Sem argumento** ou **`--resume`**: entre em **modo de retomada**.
  1. Rode `bash "$SKILL_DIR/../../scripts/vetor-status.sh"` para listar os worktrees ativos com
     status file. O script cruza os status files com `gh pr list` e anota `GREEN (PR #N aberta)` ou
     `GREEN (já mergeado via #N)`.
  2. Se houver ao menos um status file ativo: **pule as Fases 1–3** e faça a pergunta de workers
     (Fase 2) — o estado em memória de `N` não sobrevive a um reinício da sessão. Depois monte a
     tabela de status (Fase 5.a) e, para cada grupo em `GREEN` sem PR aberta ou merge, ofereça o
     ship via `AskUserQuestion` ("Fazer ship do grupo `<slug>` (Issue #<N>), que está GREEN?"). Se
     já estiver mergeado, apenas informe. Prossiga a partir da Fase 5/6.
     Em `--headless`: não pergunte o teto (use `N_rec`) e não ofereça ship — apenas reporte os
     grupos `GREEN` como prontos.
  3. Se **não houver** worktree ativo com status file: caia no fluxo padrão (Fase 1), descobrindo
     dinamicamente labels ou usando `defaultDispatchLabel` de `.claude/vetor/config.json` se configurado.
- **Lista de números** ou **label explícito**: siga o fluxo padrão a partir da Fase 1.

### 1 — Listar issues candidatas e analisar afinidades

Se o argumento casar `^[0-9]+(,[0-9]+)*$`, trate-o como **lista por número**; caso contrário, como
**label**. Se **nenhum argumento** for passado:
- Verifique se `.claude/vetor/config.json` declara `defaultDispatchLabel`
  - Se sim: use esse label (filtro explícito)
  - Se não: descubra todas as issues abertas (sem filtro de label)

O restante do fluxo é idêntico nos três modos (número, label, descoberta dinâmica).

- **Lista por número:**
  ```bash
  for N in ${ARG//,/ }; do gh issue view "$N" --json number,title,labels,body; done
  ```
- **Label ou defaultDispatchLabel:**
  ```bash
  gh issue list --label <label> --state open --json number,title,labels,body
  ```
- **Descoberta dinâmica (sem argumento, sem defaultDispatchLabel):**
  ```bash
  gh issue list --state open --json number,title,labels,body
  ```

**Priorização: pedidas pelo usuário vs. recomendadas pelo agente.** O modo por label (ou a descoberta
dinâmica) traz de volta, na mesma leva, issues abertas manualmente/via integração externa e issues
geradas por `/vetor:retro` ou `/vetor:backlog` (label `ai-generated`), sem distinção. Antes de
montar o agrupamento por afinidade, particione o resultado usando o campo `labels` já retornado:

- **Pedidas pelo usuário** (candidatas primárias): issues **sem** a label `ai-generated`.
- **Recomendadas pelo agente**: issues **com** a label `ai-generated`.

Monte o plano de dispatch priorizando o grupo "pedidas pelo usuário". Só inclua issues do grupo
"recomendadas pelo agente" quando o primeiro grupo estiver **vazio** no filtro aplicado — ou,
opcionalmente, como itens extras claramente sinalizados como "recomendação do agente" no plano
apresentado para aprovação (Fase 2), nunca misturados sem essa marcação.

Para cada issue, verifique se já há PR aberto:
```bash
gh pr list --search "closes:#<N>" --state open --json number,title
```
Se houver (ou se `vetor-status.sh` reportar `GREEN (PR #N aberta)` / `GREEN (já mergeado via #N)`):
pule a issue e registre na tabela como "PR já aberto (#<PR>)" ou "Já mergeado (#<PR>)".

#### Agrupamento por afinidade

Com as candidatas válidas em mãos, se houver mais de 3 issues, você pode delegar a proposta de
agrupamento a um runtime externo disponível — detecção e algoritmo de seleção em
`delegate-to-runtime.md` §1-2 (com 2+ candidatos e nenhuma preferência configurada, em sessão
interativa pergunte qual usar; em `--headless`, siga inline). Você valida e corrige a proposta; a
distribuição final é sua.

Inline (ou com 3 ou menos issues):
- Agrupe issues **complementares ou correlatas** (mesmo módulo, ou um `fix` que complementa
  diretamente uma `feat`) por título, labels e descrição.
- Defina uma **Lead Issue** (a principal ou mais antiga), que dá nome ao worktree/branch.
- As demais viram **Sequential Issues**, resolvidas em sequência pelo mesmo agente no mesmo worktree.

#### Ondas de despacho (DAG Waves)

Grupos que rodam **em paralelo** podem depender causalmente uns dos outros (ex.: grupo B usa uma
entidade/migration/classe que só existe depois do merge do grupo A). Despachar B a partir do branch
default ANTES do merge de A causa branch skew: o worktree de B nunca verá as mudanças de A, exigindo
conciliação manual depois. Para evitar isso, organize os grupos em **ondas topológicas** (`O_1, O_2,
..., O_k`) antes de montar o plano da Fase 2:

1. Para cada par de grupos, verifique **heurísticas best-effort** de dependência (não há grafo formal
   de dependências no GitHub — esta detecção é sempre uma inferência, nunca um fato garantido):
   - Título/corpo de uma issue do grupo B menciona explicitamente outro grupo/issue do grupo A (ex.:
     "depende de #12", "após #12", "usa a entidade criada em #12").
   - Labels indicando ordem (ex.: `blocked-by`, `depends-on`) ou convenção do time.
   - Mesmo módulo/diretório, mas com evidência de ordem de criação de arquivo (ex.: B referencia uma
     classe, tabela ou migration que a descrição de A propõe criar pela primeira vez).
2. Construa um DAG (grafo acíclico dirigido) de grupos: aresta `A → B` quando B depende de A. Se
   houver ciclo aparente (heurística ambígua), trate como **não-dependente** e avise no plano — não
   bloqueie o dispatch por uma inferência de baixa confiança.
3. Derive as ondas por ordenação topológica: `O_1` contém todos os grupos sem dependência pendente;
   `O_2` os que dependem só de grupos em `O_1`; e assim por diante.
4. **Fallback:** se nenhuma dependência for detectável entre os grupos (caso mais comum), cada grupo
   forma sua própria onda e todas as ondas colapsam em uma só (`O_1`) — comportamento idêntico ao
   dispatch paralelo atual, sem mudança de comportamento observável.
5. O usuário pode **corrigir manualmente** o agrupamento em ondas no plano da Fase 2 antes de aprovar
   — a heurística é um ponto de partida, não uma decisão final.

### 2 — Apresentar plano de dispatch e obter aprovação

#### Gate de Spec/design (classificação de complexidade, antes do dispatch)

Antes de montar a tabela do plano, classifique cada issue candidata da Fase 1 — vocabulário derivado
da triagem equivalente de `spec/SKILL.md` §0.1 (Investigação/Confirmação rápida/Spec completa), mas
aplicado aqui à decisão "despachar como está, ou sinalizar a falta de uma Spec antes de despachar":

1. **Heurística de complexidade**, por issue (`gh issue view <N> --json body,labels`):
   - **Módulos tocados**: quantos módulos de `.claude/vetor/module-test-map.md` têm o prefixo
     mencionado no título/corpo da issue (ex.: `cli/`, `scripts/`). Mais de 1 é sinal de complexidade
     — em projetos com poucos módulos mapeados este sinal tende a ficar em 0 ou 1 na maioria das
     issues; nesse caso o sinal de "escopo já declarado" abaixo é quem decide a classificação.
   - **Escopo já declarado**: o corpo já traz uma seção equivalente a "Escopo do trabalho" e um
     "Critério de Aceite" com itens concretos (checklist, não frase vaga).
   - **Label**: `feat`/`enhancement`/`refactor` tendem a não-trivial mesmo com escopo declarado;
     `fix`/`chore`/`bug` com escopo declarado tendem a trivial. Ajuste esta lista ao vocabulário de
     labels efetivamente usado no repositório-alvo (ex.: um projeto sem label `feat` própria, como
     este mesmo repositório, usa `enhancement` para o equivalente).
2. **Classificação**: `trivial` quando o escopo já está declarado **e** o nº de módulos tocados é
   ≤ 1 **e** a label não é `feat`/`enhancement`/`refactor`; **não-trivial** em qualquer outro caso
   (múltiplos módulos, ou escopo ausente/vago, ou `feat`/`enhancement`/`refactor` sem Critério de
   Aceite explícito).
3. **Spec associada**: verifique se a issue referencia uma Spec (`docs/specs/<slug>.md`, ver
   `spec/SKILL.md` §6) no corpo ou em algum comentário.
4. **Gate**: sinalize apenas issues `não-trivial` **sem** Spec associada — nunca issues `trivial`
   (um bugfix que já chega com escopo claro não é bloqueado cegamente) nem issues `não-trivial` que já
   têm Spec.

**Fora de `--headless`:** para cada issue sinalizada, pergunte via `AskUserQuestion` (uma pergunta por
issue, ou agrupada se houver mais de uma — `planning-conventions.md` §3 "Regra das 3 perguntas"),
**antes de montar a tabela do plano**:

```
Issue #<N> parece não-trivial (<razão: múltiplos módulos | sem Escopo do trabalho/Critério de
Aceite | feat/enhancement/refactor sem escopo detalhado>) e não tem Spec associada. Como prosseguir?

1. Despachar mesmo assim — escopo confirmado nesta conversa
2. Gerar Spec antes (/vetor:spec) — esta issue sai desta leva de dispatch
3. Confirmar rapidamente 2-3 pontos agora (problema, resultado esperado, não-escopo) e seguir sem
   Spec completa
```

- **Opções 1 ou 3**: a issue segue no plano normalmente; marque na coluna "Ação" da tabela (abaixo)
  `Despachar (⚠️ sem Spec — confirmado pelo usuário)`. Na opção 3, inclua os 2-3 pontos confirmados
  no prompt do worker da Fase 4, como contexto adicional (não substitui uma Spec — é só o mínimo de
  escopo confirmado para o worker não inventar critério de aceite sozinho).
- **Opção 2**: remova a issue desta leva de dispatch — ela não aparece como `Despachar`, e sim com
  Ação `SKIPPED (aguardando Spec)` e coluna "Onda" `—` (nunca foi despachada, não pertence a onda
  nenhuma). Se a issue sinalizada é a **Lead** do grupo, o grupo inteiro sai da leva (as Sequential
  Issues do grupo ficam sem Lead para dar nome ao worktree/branch — voltam junto na próxima sessão);
  se é uma **Sequential Issue**, apenas ela sai e o restante do grupo (Lead + demais Sequential) segue
  normalmente. A issue (ou grupo) volta a ser candidata em uma sessão futura do coordinator, quando a
  Spec existir (`/vetor:spec` roda fora deste fluxo, tipicamente numa sessão manual). **Um grupo
  `SKIPPED` nunca é pendência para a transição de onda da Fase 4** — como não foi despachado, não há
  branch skew a prevenir (as ondas ordenam merges de trabalho já despachado, não issues que nunca
  saíram do plano); a transição de `O_i` para `O_{i+1}` ignora grupos `SKIPPED` de `O_i`.

**Em `--headless`: nunca pergunte, nunca bloqueie.** Um gate síncrono aqui recriaria o mesmo deadlock
por falta de interlocutor do worker preso em plan mode (issue #121 — ver `wiki/Decisoes-de-Design.md`).
Marque a issue na coluna "Ação" como `Despachar (⚠️ sem Spec associada — sinalização não-bloqueante)` e
prossiga o dispatch normalmente; a ausência de Spec fica registrada no relatório final (Fase 7), nunca
impede o dispatch.

Monte o plano (conteúdo mínimo em `planning-conventions.md` §2.1), já refletindo o resultado do gate
acima na coluna "Ação":

```markdown
# Plano de Execução Vetor — Coordinator

Coordenando issues: <label ou "todas as abertas" ou descrição do filtro>

## Ações Propostas

| Onda | Subagente/Grupo (Slug) | Lead/Sequential Issues | Modelo Sugerido | Ação |
|------|-------------------------|------------------------|-----------------|------|
| O_1  | <slug-1>                | #<N1> (Lead), #<M1>    | <haiku|sonnet>  | Despachar |
| O_1  | <slug-2>                | #<N3> (Lead)           | <haiku|sonnet>  | Despachar (⚠️ sem Spec — confirmado pelo usuário) |
| —    | <slug-4>                | #<N5> (Lead)           | —               | SKIPPED (aguardando Spec) |
| O_2  | <slug-3>                | #<N4> (Lead)           | <haiku|sonnet>  | Aguardar O_1 |
```

Se houver mais de uma onda, explique **por que** cada grupo da onda `O_2+` depende de um grupo de
onda anterior (cite a issue/menção que fundamentou a heurística). Se todos os grupos couberem em
`O_1`, omita a coluna de justificativa — é o caso comum, sem dependências detectadas.

Se o plano incluir issues do grupo "recomendadas pelo agente" (Fase 1) — porque não havia issues
pedidas pelo usuário pendentes, ou como itens extras opcionais —, sinalize cada uma delas na coluna
"Ação" (ex.: "Despachar (recomendação do agente)") para que a aprovação distinga claramente as duas
origens.

#### Teto de workers simultâneos

Cada subagente paralelo é uma instância Claude completa, sem contexto compartilhado — é o maior
driver de custo agregado do coordinator.

1. **Recomendação** `N_rec` = `min(largura da maior onda, maxConcurrentWorkers de
   .claude/vetor/config.json se existir — senão 5)`. A largura da maior onda é o número máximo de
   grupos que podem rodar em paralelo dentro de uma mesma onda (grupos de ondas distintas nunca rodam
   juntos — Fase 4). Acima de ~8 workers, custo agregado e ruído de monitoramento tendem a crescer
   mais rápido que o ganho de paralelismo: se `N_rec` > 8, sinalize isso na pergunta. É
   recomendação, não limite — a decisão é do usuário.
2. **Em `--headless`:** adote `N = N_rec` sem perguntar e registre no relatório qual valor foi usado
   e como foi calculado. Fora do headless, **pergunte via `AskUserQuestion`** (uma única vez por sessão):
   - `"<N_rec> (Recomendado)"` — justifique em 1 linha (largura da onda, custo por worker, alerta se > 8)
   - `"1 — serializado"` — mais lento, mais previsível, menor custo
   - `"<maxConcurrentWorkers de config.json>"` — só se existir e for diferente de `N_rec`
   - O usuário pode responder valor customizado ("Other"), **inclusive acima de 8** — respeite-o.
3. **Armazene como `N`** para a Fase 4; vale para toda a sessão de dispatch, incluindo redespachos.
   Em modo de retomada, repita a pergunta antes de despachar qualquer `QUEUED`. O valor **não
   persiste** em `.claude/vetor/config.json`.

#### Obtenção de aprovação

**Em `--headless`: pule esta seção** — inclua o plano no relatório final (Fase 7) e siga para a Fase 3.

- **No Claude Code:** se a sessão já estiver em plan mode, apresente o plano e conclua com
  `ExitPlanMode`. Se a sessão **não** estiver em plan mode, aprove via `AskUserQuestion` (ou chame
  `EnterPlanMode` antes).
- **No Antigravity/Gemini:** gere/atualize `implementation_plan.md` com `request_feedback: true` e
  `user_facing: true`, e aguarde `request_feedback: false` ou "Proceed".
- Sem nenhum dos dois: exiba o plano no chat e aguarde resposta afirmativa explícita.

**Pare** até a aprovação. Respeite trocas manuais de modelo ou de teto no dispatch da Fase 4.

### 3 — Fase de criação (nativa e serializada)

Leia `../shared/references/issue-coordinator-dispatch.md` para derivar slug/branch/status file e localizar o worktree real.
Leia `../shared/references/memory-handoffs.md` ao retomar `--resume` ou ao preparar dispatch de issue dependente.

### 4 — Fase de desenvolvimento (paralela, com teto de concorrência e ondas)

- Ordene os grupos por prioridade (ex.: ordem das issues no label) **dentro de cada onda** (Fase 1).
- Despache em paralelo até `N` grupos, **estritamente dentro da onda corrente** (`O_i`). Grupos de
  `O_{i+1}` ou posterior nunca são despachados enquanto houver grupo de `O_i` ainda não mergeado —
  mesmo que haja vagas no teto `N`. Eles ficam `QUEUED (aguardando O_i)` na tabela (Fase 5.a).
- Dentro da onda corrente: quando um worker ativo atingir `GREEN`, `FAILED_MAX_ITERATIONS` ou for
  cancelado, despache o próximo `QUEUED` da mesma onda, mantendo os ativos no teto.
- O teto é contabilidade do coordinator, não bloqueio de plataforma: respeite-o a cada ciclo.
  Leia `../shared/references/issue-coordinator-dispatch.md` para timeout, transição de ondas e sincronização do root.

  Antes de cada dispatch, leia `../shared/references/issue-coordinator-dispatch.md` para duplicidade, status file e retomada em worktree existente.

  Ao preparar o worker, leia `../shared/references/issue-coordinator-dispatch.md` para convenções e o template completo do prompt.
  No encerramento de cada iteração com pendências ou escalação, siga `../shared/references/memory-handoffs.md` para registrar handoff opcional; status file permanece primário.

Ao concluir todas as issues com sucesso, o worker marca `GREEN`. Se falhar em alguma, para e marca
`FAILED_MAX_ITERATIONS` especificando qual issue falhou.

#### Dispatch para runtime externo (delegação de código)

Caso o coordinator delegue o desenvolvimento de um grupo a um runtime externo de IA (Gemini/OpenCode/Codex — ver `delegate-to-runtime.md`), aplique o **contrato mínimo de delegação**:
1. **Worktree próprio**: provisione um worktree isolado exclusivo para o runtime externo via `worktree-create` (nunca opere no root nem em worktree de outro worker).
2. **Diff tratado como rascunho**: o código gerado pelo runtime externo é rascunho não confiável; nunca faça commit cegamente sem inspeção prévia.
3. **Validação via `module-test-map`**: execute a suíte de testes mapeada para os módulos tocados antes de qualquer commit; descarte o rascunho em caso de falha.
4. **Status file mantido pelo coordinator**: o coordinator é responsável por gerenciar e atualizar o status file (`.claude/vetor/status/<branch>.md`) a cada iteração (`RUNNING`, `Iteration: N/5`, `GREEN`, etc.).
5. **Limpeza do worktree do runtime**: ao concluir a integração (ou ao descartar o rascunho), limpe o worktree temporário do runtime via `safe-remove-worktree`.

Consulte `../shared/references/issue-coordinator-dispatch.md` para o fluxo detalhado desse contrato.



### 5 — Monitoramento

Leia `../shared/references/issue-coordinator-monitoring.md` ao montar/atualizar a tabela de status, incluindo fallback e duplicidade.

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
2. `/vetor:ship` aborta se o `cwd` não for um worktree, e o contexto do coordinator é o root
   do repo. Entre no worktree antes de invocar:
   ```bash
   git worktree list   # localize a linha cuja branch é a do grupo (Fase 3)
   cd <path-do-worktree-do-grupo>
   ```
   Só então:
   ```
   /vetor:ship <issue#>
   ```
3. Após merge bem-sucedido, atualize a tabela.

Se `ship` falhar (CI vermelho, review required), marque na tabela e continue com os outros.

### 7 — Relatório final

**Antes do relatório, volte ao root e sincronize.** A Fase 6 faz `cd` para dentro do worktree de
cada grupo; sem um retorno explícito, a sessão termina com o git preso na branch de um worktree —
possivelmente já mergeada e obsoleta.

```bash
cd "$(git worktree list | head -1 | awk '{print $1}')"   # a 1ª linha é sempre o root
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" sync-root
```

`sync-root` só troca de branch se a atual estiver limpa e já mesclada em `origin/<default>`. Se
imprimir `AVISO`, **não force**: reporte a pendência no relatório em vez de descartar trabalho.

Após todos os agentes terminarem (ou atingido o timeout de 90 minutos / `maxSessionMinutes`):

```
Use `../shared/references/issue-coordinator-report.md` ao montar o Coordinator Report e validar o fechamento da onda.
## Orçamentos e hard caps

- **fix:** 5 iterações é **orçamento sugerido**, não hard cap enforced — nada no hook
  interrompe o agente automaticamente (issue #156). Ao atingir a 5ª iteração sem verde, o agente
  deve registrar `BLOCKED_WAITING` (não decidir sozinho continuar) e escalar ao coordinator via os
  blocos `Blocked on`/`Options`/`Recommendation` do status file, em vez de estourar para 6+.
- **ship:** máximo 3 tentativas de fix de CI
- **Coordinator:** timeout global de 90 minutos (este sim, hard cap real) — configurável via
  `maxSessionMinutes` em `.claude/vetor/config.json` (default 90). O teto restringe **novos
  dispatches e o início de novas ondas**: ao atingir o timeout, nenhum novo grupo é despachado e
  nenhuma nova onda é iniciada. Porém, grupos ativos podem concluir sua iteração corrente e ships de
  grupos já em `GREEN` (ou já autorizados pelo usuário) podem prosseguir até a conclusão (issue #343).
  Para a contagem do timeout, considere apenas o tempo ativo de coordenação, excluindo períodos de
  espera por decisões humanas (`AskUserQuestion` ou aprovação de plano).
- Agentes em `BLOCKED_WAITING` não consomem iterações do fix-loop
- `vetor-status.sh` destaca com `⚠️` na tabela qualquer `Iteration: N/5` com `N` acima do orçamento —
  sinal de que o agente não escalou como deveria; trate como candidato a redispatch/intervenção.

O teto de workers simultâneos **não é um hard cap**: é o valor `N` decidido pelo usuário na Fase 2
(default recomendado `maxConcurrentWorkers` de `.claude/vetor/config.json`, senão 5).

---

## Restrições

- `worktree-create` e fase de merge são **sempre serializados**
- Fonte de verdade para status: status files (`.claude/vetor/status/`) + `gh pr list` + `gh pr checks`
- Nunca chama `EnterWorktree`/`ExitWorktree` por sub-agentes
- Se interrompido, reconstrói estado com `vetor-status.sh` + `gh pr list` — não depende de memória
- Ao fim de toda sessão (Fase 7), o root fica na branch principal e sincronizado — nunca preso numa
  branch de worktree de grupo
- Em `--headless`: nunca chama `AskUserQuestion` nem `ExitPlanMode`, nunca faz merge/ship, nunca
  auto-aprova permissão. Se o contexto exigir uma decisão que o headless não pode tomar, registre no
  relatório e pare — não improvise
- O gate de Spec/design (Fase 2) nunca bloqueia o dispatch em `--headless` — vira sinalização
  registrada no plano/relatório, nunca um `AskUserQuestion` síncrono (mesmo motivo do item acima:
  deadlock por falta de interlocutor, issue #121)
