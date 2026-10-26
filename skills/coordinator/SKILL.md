---
name: coordinator
description: Despacho paralelo de issues GitHub para sub-agentes com worktrees isolados guiado por Planejamento. Agrega status e coordena merge serializado. Use /vetor:coordinator [label]. Aceita --headless para execução não-interativa (rotinas/CI).
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.7.0"
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
/vetor:coordinator [label] --headless --auto-ship
```

- `[label]`: label das issues a despachar (sem argumento: todas as issues abertas, ou usa `defaultDispatchLabel` de `.claude/vetor/config.json` se configurado)
- `<n1>,<n2>,...`: lista de números de issue (ex.: `/vetor:coordinator 12,14,17`). Casa `^[0-9]+(,[0-9]+)*$`.
- **sem argumento** ou **`--resume`**: modo de retomada — reconstrói o estado a partir dos
  worktrees/status files existentes (Fase 0).
- `--headless`: execução **não-interativa**, para rotinas agendadas e CI. Combinável com qualquer
  um dos anteriores.
- `--auto-ship`: só tem efeito com `--headless`. Habilita a Fase 6 (entrega) sem humano, sob quatro
  gates determinísticos (Fase 6.d). Equivale a `"autoShipHeadless": true` em
  `.claude/vetor/config.json`; sem nenhum dos dois, `--headless` continua sem entregar.

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
Regras de economia de tokens e delegação a um runtime externo disponível (Gemini/OpenCode/Codex) ou
orquestrador MCP (Alethe): `../shared/references/planning-conventions.md` e
`../shared/references/delegate-to-runtime.md`.
Se uma issue referenciar uma Spec previamente gerada por `/vetor:spec` (ver `skills/spec/SKILL.md`
§6), ela fica em `docs/specs/<slug>.md` por padrão (path previsível, issue #219) — útil como contexto
adicional ao ler a issue no passo 1; esta skill não consome nem gera código a partir dela.

---

## Modo headless

A flag `--headless` substitui os quatro pontos de interação humana por decisões determinísticas:

| Fase | Interativo | Headless |
|------|-----------|----------|
| 1/2 — labels de triagem | Aplica label de triagem existente no repo ao pular issue (nunca cria) | Aplica igualmente se a label existir no repositório; nunca cria (`gh label create`) |
| 2 — gate de Spec/design | `AskUserQuestion` por issue não-trivial sem Spec associada | Nunca pergunta, nunca bloqueia; anota `⚠️ sem Spec associada` na coluna "Ação" e segue o dispatch |
| 2 — teto de workers | `AskUserQuestion` (pula se `N_rec = 1`) | Usa `N_rec` calculado, sem perguntar |
| 2 — aprovação do plano | `ExitPlanMode`, **pare** | Não pede aprovação; imprime o plano no relatório |
| 5.b — `BLOCKED_WAITING` | `AskUserQuestion` ao usuário | Não escala; deixa o grupo bloqueado e reporta |
| 5.c — circuit breaker | Pergunta se pausa | Sempre pausa: para de despachar e reporta |
| 6 — entrega | Pre-Ship paralelo e merge serializado | Pulada. Com `--auto-ship` ou `autoShipHeadless: true`, roda sob os 4 gates da Fase 6.d |

Além disso, em `--headless`:

- **A Fase 6 (entrega) só roda com opt-in.** Sem `--auto-ship` nem `autoShipHeadless: true` em
  `.claude/vetor/config.json`, nunca invoque `ship`, `gh pr ready` ou `gh pr merge`: grupos em `GREEN`
  são reportados como prontos para ship. Com o opt-in, a Fase 6 roda sob os quatro gates da 6.d,
  nunca pergunta e, se um gate falhar, deixa o PR aberto.
- **Nenhuma permissão é auto-aprovada.** Um worker que bloqueia pedindo permissão permanece
  `BLOCKED_WAITING` e aparece no relatório final.
- **Labels de triagem em `--headless`**: ao pular ou manter bloqueada uma issue, aplica igualmente a
  label de triagem equivalente se já existir no repositório (ver tabela de mapeamento na Fase 1);
  **nunca** cria labels (`gh label create`). Sem equivalente no repo, não aplica e documenta o motivo
  apenas no relatório final.
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
     (Fase 2; pulada quando `N_rec = 1`) — o estado em memória de `N` não sobrevive a um reinício da sessão. Depois monte a
     tabela de status (Fase 5.a) e, para cada grupo em `GREEN` sem PR aberta ou merge, ofereça o
     ship via `AskUserQuestion` ("Fazer ship do grupo `<slug>` (Issue #<N>), que está GREEN?"). Se
     já estiver mergeado, apenas informe. Prossiga a partir da Fase 5/6.
     Em `--headless`: não pergunte o teto (use `N_rec`) e não ofereça ship — apenas reporte os
     grupos `GREEN` como prontos, salvo com `--auto-ship`/`autoShipHeadless: true`, caso em que
     os `GREEN` seguem a Fase 6.d.
     Antes de prosseguir, rode `scripts/prewarm-worktrees.ts discard` para limpar sobras de
     pre-warming (idempotente; ver `../shared/references/worktree-prewarm.md`).
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
geradas por skills do plugin (`/vetor:backlog`, `/vetor:retro`, `/vetor:guardian`), sem distinção. A origem
passa a ser identificada por uma linha do corpo (`body`) que começa com `🤖 Gerado por` seguida de
`/vetor:<skill>`, com ou sem crases em volta do comando. A regex de referência (flag multilinha) é
``^🤖 Gerado por `?/vetor:``. Exemplos reais:
``🤖 Gerado por `/vetor:backlog` — [Claude Code](https://claude.ai/code)``,
``🤖 Gerado por `/vetor:retro` — sessão em <projeto>`` e `🤖 Gerado por /vetor:guardian`.
Menções ao rodapé no meio de uma frase ou de um item de checklist não contam.

Antes de montar o agrupamento por afinidade, particione o resultado usando o `body` e os `labels` já retornados:

- **Recomendadas pelo agente**: issues cujo `body` tenha uma linha que comece com `🤖 Gerado por` seguida
  de `/vetor:<skill>` (com ou sem crases em volta do comando; menções no meio de uma frase ou item de
  checklist não contam) OU que
  contenham a label `ai-generated` em `labels` (regra de transição para issues antigas já criadas com
  a label e sem rodapé, ex.: #403, #404 — leitura apenas; o plugin nunca aplica a label).
- **Pedidas pelo usuário** (candidatas primárias): issues sem uma linha do corpo que comece com
  `🤖 Gerado por` seguida de `/vetor:<skill>` e sem a label `ai-generated`.

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

#### Triagem de despachabilidade (issues não-despacháveis nesta leva)

Nem toda issue aberta está pronta para despacho imediato por um subagente autônomo. Identifique e
classifique antecipadamente issues não-despacháveis para que componham o plano e o Coordinator
Report com resultados padronizados (issues #413, #456):

- `SKIPPED (bloqueada por #N)`: issues cujo endpoint nativo de dependências (`blocked_by`) identifica
  uma issue bloqueadora aberta que não faz parte da leva atual de despacho (issue #456).
- `SKIPPED (aguardando insumo do usuário)`: issues que dependem de decisão estratégica, validação de
  banca/cliente, credenciais, assets, texto ou conteúdo humano indisponível nesta sessão.
- `SKIPPED (fora deste repositório)`: issues cujo escopo pertence a outro repositório (ex.: README
  de perfil, site institucional, projeto novo ainda sem repo dedicado).
- `SKIPPED (épico/acompanhamento)`: issues agregadoras, marcos ou épicos de acompanhamento que não
  representam uma unidade de código despachável diretamente.

Issues com esses resultados saem da leva de dispatch: recebem Onda `—`, modelo `—`, Ação
`SKIPPED (<motivo>)` e a justificativa clara no plano e no Coordinator Report. Se a issue for a Lead,
o grupo inteiro não é despachado; se for Sequential, apenas ela é pulada e o restante do grupo segue
normalmente. Grupos `SKIPPED` nunca bloqueiam a transição de ondas da Fase 4.

#### Labels de triagem no GitHub (visibilidade de issues puladas/bloqueadas)

Quando o coordinator tira uma issue da leva (`SKIPPED (aguardando Spec)` do gate de Spec/design na Fase 2, `SKIPPED (aguardando insumo do usuário)` da triagem, ou issue bloqueada em `BLOCKED_WAITING` na Fase 5.b), o motivo só aparece no Coordinator Report da sessão. Para deixar o estado de triagem visível no GitHub, o coordinator aplica a label equivalente que o repositório **já possuir** — **sem nunca criar labels**.

Consulte os labels existentes no repositório:
```bash
gh label list --limit 100 --json name
```

Mapeie o motivo aos labels existentes no repo alvo, usando o **primeiro da linha que existir** (no estilo do mapeamento de tipo do `/vetor:backlog` §6.a):

| Motivo | Label Preferido | Fallback 1 | Fallback 2 | Se nenhum existir |
| ------ | --------------- | ---------- | ---------- | ----------------- |
| `SKIPPED (aguardando Spec)` | `needs-spec` | `spec-needed` | `triage/needs-information` | Não aplica |
| `SKIPPED (aguardando insumo do usuário)` / bloqueada | `blocked` | `status/blocked` | — | Não aplica |

**Regras e convenções:**
1. **Regra de ouro — nunca crie labels:** o coordinator **nunca** executa `gh label create`. Se nenhuma das labels candidatas da linha existir no repositório-alvo, não aplica label alguma no GitHub — o motivo fica registrado exclusivamente no plano e no Coordinator Report da sessão.
2. **Aplicação da label:** quando a issue for pulada ou bloqueada e houver label correspondente no repositório:
   ```bash
   gh issue edit <N> --add-label "<label-encontrada>"
   ```
3. **Remoção da label de triagem ao despachar:** ao despachar posteriormente uma issue (Fase 4) que possua qualquer uma das labels de triagem mapeadas (`needs-spec`, `spec-needed`, `triage/needs-information`, `blocked`, `status/blocked`), o coordinator obrigatoriamente a remove antes ou no momento do dispatch:
   ```bash
   gh issue edit <N> --remove-label "<label-de-triagem>"
   ```
4. **Comportamento em `--headless`:** aplica igualmente a label de triagem se ela existir no repositório; nunca cria labels (`gh label create`). Sem equivalente no repo, não aplica e documenta a omissão no relatório final.
5. **Não-escopo:** nunca aplique labels indicando execução em andamento (ex.: `in-progress` ou qualquer estado de execução). O estado de execução vive exclusivamente no worktree e no status file (`.claude/vetor/status/`), e o padrão do GitHub para status de fluxo é o campo Status do Projects.

#### Detecção de issues spike (modo investigação)

Issues do tipo `spike` ("Investigação/exploração — resultado informa decisão futura, não é trabalho de implementação imediata") possuem fluxo próprio de despacho, pois exigir TDD e testes de código de produto é inadequado para uma entrega cujo objetivo é uma decisão documentada:

1. **Detecção**: reconheça uma issue como `spike` se:
   - Possuir a label `spike` (ou o equivalente existente no repositório, ex.: `investigation`, `research`, `exploration`, consultados via `gh label list --limit 100 --json name`); OU
   - O título iniciar por convenções como `spike:`, `spike(...)`, `investigação:`, `research:`; OU
   - O corpo declarar explicitamente objetivo de spike ou investigação exploratória.
2. **Isenção do Gate de Spec (Fase 2)**: issues `spike` são **isentas do gate de Spec** (dispensam Spec) — como seu propósito é explorar perguntas abertas antes de haver uma capacidade concreta a especificar (conforme `spec/SKILL.md` §0.1), não são bloqueadas pela ausência de Spec. Na tabela do plano da Fase 2, marque na coluna "Ação": `Despachar (Spike — modo investigação)`.
3. **Provisionamento do worktree (Fase 3)**: utilize o tipo `docs` para a branch e worktree (`docs/<issue#>-<slug>`), formato nativo suportado por `worktree-create` (aceito desde #429).
4. **Despacho em modo investigação (Fase 4)**: despache o worker com prompt específico de investigação:
   - Sinalize que a issue deve ser executada em **modo investigação** (não em modo de desenvolvimento regular de código).
   - **Dispensa de TDD e testes de produto**: o worker não roda TDD nem loop de testes de produto (não há código de produto a testar).
   - **Entregável obrigatório**: produzir o relatório em `docs/investigations/<slug>.md`.
   - **Formato mínimo documentado do relatório**:
     1. Pergunta (a pergunta central ou problema a ser respondido)
     2. Evidências (comandos executados, medições, logs, links ou fontes reproduzíveis)
     3. Opções avaliadas (alternativas consideradas e seus trade-offs)
     4. Recomendação (opção sugerida com justificativa para decisão futura)
   - **Critério de `GREEN`**: status `GREEN` é atingido quando o arquivo `docs/investigations/<slug>.md` existir cobrindo as seções mínimas e `git diff --check` passar sem erros.
5. **Entrega e follow-up (Fase 6)**: o PR gerado pelo `ship` segue o caminho de PR só de docs (#427). A decisão derivada do spike **continua humana** — o coordinator e o worker nunca criam issues de follow-up automaticamente a partir das recomendações.

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

1. **Leitura de dependências nativas do GitHub (REST API)**:
   Dependências entre issues ("blocked by" / "blocking") são nativas no GitHub desde 21/08/2025
   (com API REST e filtros `is:blocked`/`is:blocking`). Para cada issue candidata, consulte as
   dependências bloqueadoras via GitHub CLI / REST API:
   ```bash
   gh api repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by
   ```
   (ou consulte o resumo `issue_dependencies_summary` do objeto da issue retornado por
   `gh api repos/{owner}/{repo}/issues/<N> --jq .issue_dependencies_summary`).

   Aplique os seguintes tratamentos para cada bloqueadora encontrada:
   - **Bloqueadora aberta e fora da leva**: a issue candidata não pode ser despachada nesta sessão;
     sai da leva como `SKIPPED (bloqueada por #N)` (recebe Onda `—`, modelo `—` e justificativa clara
     no plano e no Coordinator Report — ver "Triagem de despachabilidade").
   - **Bloqueadora dentro da leva**: estabelece uma aresta do DAG como **fato** (não inferência): o
     grupo da issue bloqueadora deve ser executado e mergeado antes do grupo da issue dependente (`A → B`).
     A issue dependente é alocada para uma onda posterior (`O_2+`).

2. **Fallback para heurística textual** (em caso de falha/indisponibilidade da API ou dependência não cadastrada):
   Se a chamada à REST API falhar ou estiver indisponível (ex.: endpoint inacessível, erro de rede,
   ou falta de permissão), ou para capturar dependências textuais não cadastradas formalmente no GitHub,
   recorra às **heurísticas textuais best-effort**:
   - Título/corpo de uma issue do grupo B menciona explicitamente outro grupo/issue do grupo A (ex.:
     "depende de #12", "blocked by #12", "após #12", "usa a entidade criada em #12").
   - Labels indicando ordem (ex.: `blocked-by`, `depends-on`) ou convenção do time.
   - Mesmo módulo/diretório, mas com evidência de ordem de criação de arquivo (ex.: B referencia uma
     classe, tabela ou migration que a descrição de A propõe criar pela primeira vez).

3. Construa o **DAG (grafo acíclico dirigido)** de grupos: aresta `A → B` quando B depende de A (arestas
   nativas como fatos e heurísticas textuais como inferências complementares). Se houver ciclo aparente
   (heurística ambígua), trate como **não-dependente** e avise no plano — não bloqueie o dispatch por
   uma inferência de baixa confiança.
4. Derive as ondas por ordenação topológica: `O_1` contém todos os grupos sem dependência pendente;
   `O_2` os que dependem só de grupos em `O_1`; e assim por diante.
5. **Fallback de ondas:** se nenhuma dependência (nativa ou textual) for detectável entre os grupos (caso mais comum), cada grupo
   forma sua própria onda e todas as ondas colapsam em uma só (`O_1`) — comportamento idêntico ao
   dispatch paralelo atual, sem mudança de comportamento observável.
6. O usuário pode **corrigir manualmente** o agrupamento em ondas no plano da Fase 2 antes de aprovar
   — dependências nativas e heurísticas são pontos de partida, cabendo ao usuário a validação final.
7. **Pre-warming (RF-06):** com as ondas definidas, dispare em background o pre-warming dos worktrees
   de `O_1` (no máximo `N_rec` grupos) enquanto a Fase 2 conduz a entrevista. Comandos, limites e a regra de
   sincronia em `../shared/references/worktree-prewarm.md`.

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
   têm Spec, e nunca issues `spike` (investigações exploratórias dispensam Spec, ver "Detecção de issues spike").

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
  Spec existir (`/vetor:spec` roda fora deste fluxo, tipicamente numa sessão manual). Aplique a label
  de triagem existente no repositório conforme a tabela de mapeamento da Fase 1 (`needs-spec` ->
  `spec-needed` -> `triage/needs-information`; se nenhuma existir, não aplique e nunca use
  `gh label create`). **Um grupo `SKIPPED` nunca é pendência para a transição de onda da Fase 4** —
  como não foi despachado, não há branch skew a prevenir (as ondas ordenam merges de trabalho já
  despachado, não issues que nunca saíram do plano); a transição de `O_i` para `O_{i+1}` ignora grupos
  `SKIPPED` de `O_i`.

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

| Onda | Subagente/Grupo (Slug) | Lead/Sequential Issues | Modelo / Backend | Ação |
|------|-------------------------|------------------------|------------------|------|
| O_1  | <slug-1>                | #<N1> (Lead), #<M1>    | <haiku|sonnet|alethe> | Despachar |
| O_1  | <slug-2>                | #<N3> (Lead)           | <haiku|sonnet|alethe> | Despachar (⚠️ sem Spec — confirmado pelo usuário) |
| O_1  | <slug-3>                | #<N4> (Lead)           | <haiku|sonnet|alethe> | Despachar (Spike — modo investigação) |
| —    | <slug-4>                | #<N5> (Lead)           | —                | SKIPPED (aguardando Spec) |
| —    | <slug-5>                | #<N6> (Lead)           | —                | SKIPPED (aguardando insumo do usuário) |
| —    | <slug-6>                | #<N7> (Lead)           | —                | SKIPPED (fora deste repositório) |
| —    | <slug-7>                | #<N8> (Lead)           | —                | SKIPPED (épico/acompanhamento) |
| —    | <slug-8>                | #<N9> (Lead)           | —                | SKIPPED (bloqueada por #<B>) |
| O_2  | <slug-3>                | #<N4> (Lead)           | <haiku|sonnet|alethe> | Aguardar O_1 |
```

Se houver mais de uma onda, explique **por que** cada grupo da onda `O_2+` depende de um grupo de
onda anterior (cite a dependência nativa ou menção que fundamentou a aresta do DAG). Se todos os grupos couberem em
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
2. **Pulo automático quando `N_rec = 1` (ou largura da maior onda = 1):** se `N_rec = 1`, ou se a
   largura da maior onda for 1 (apenas um único grupo despachável por onda), adote `N = 1`
   automaticamente sem perguntar ao usuário e registre no plano e no relatório (comportamento idêntico
   ao modo `--headless`). Não há escolha real de concorrência quando a largura da onda é 1, evitando
   uma interação vazia (issue #414).
3. **Em `--headless`:** adote `N = N_rec` sem perguntar e registre no relatório qual valor foi usado
   e como foi calculado.
4. **Fora de `--headless` (com `N_rec > 1`):** pergunte via `AskUserQuestion` (uma única vez por sessão):
   - `"<N_rec> (Recomendado)"` — justifique em 1 linha (largura da onda, custo por worker, alerta se > 8)
   - `"1 — serializado"` — mais lento, mais previsível, menor custo
   - `"<maxConcurrentWorkers de config.json>"` — só se existir e for diferente de `N_rec`
   - O usuário pode responder valor customizado ("Other"), **inclusive acima de 8** — respeite-o.
5. **Armazene como `N`** para a Fase 4; vale para toda a sessão de dispatch, incluindo redespachos.
   Em modo de retomada, repita a pergunta antes de despachar qualquer `QUEUED` apenas se `N_rec > 1`.
   O valor **não persiste** em `.claude/vetor/config.json`.

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
Se o pre-warming da Fase 1 rodou, aguarde o `start` terminar e reconcilie-o com o plano aprovado
(`discard --keep`) antes de qualquer `Agent()`, conforme `../shared/references/worktree-prewarm.md`.

### 4 — Fase de desenvolvimento (paralela, com teto de concorrência e ondas)

- Ordene os grupos por prioridade (ex.: ordem das issues no label) **dentro de cada onda** (Fase 1).
- Despache em paralelo até `N` grupos, **estritamente dentro da onda corrente** (`O_i`). Grupos de
  `O_{i+1}` ou posterior nunca são despachados enquanto houver grupo de `O_i` ainda não mergeado —
  mesmo que haja vagas no teto `N`. Eles ficam `QUEUED (aguardando O_i)` na tabela (Fase 5.a).
- Dentro da onda corrente: quando um worker ativo atingir `GREEN`, `FAILED_MAX_ITERATIONS` ou for
  cancelado, despache o próximo `QUEUED` da mesma onda, mantendo os ativos no teto.
- O teto é contabilidade do coordinator, não bloqueio de plataforma: respeite-o a cada ciclo.
  Leia `../shared/references/issue-coordinator-dispatch.md` para timeout, transição de ondas e sincronização do root.
- **Grupo pré-aquecido (RF-06):** antes de cada `Agent()`, rode `scripts/prewarm-worktrees.ts claim <slug>`.
  Exit 0: despache em worktree pré-aquecido (subagente padrão com `cd`, sem `subagent_type` nem
  `isolation`; template em `../shared/references/worktree-prewarm.md`). Exit 1: dispatch clássico.
- **Remoção de labels de triagem antes do dispatch:** ao despachar uma issue (Lead ou Sequential),
  verifique se ela possui alguma label de triagem (`needs-spec`, `spec-needed`,
  `triage/needs-information`, `blocked`, `status/blocked`). Se possuir, remova-a com
  `gh issue edit <N> --remove-label "<label-de-triagem>"`.
- **Despacho de issues spike (modo investigação):** se a issue for um `spike` (conforme detecção da Fase 1):
  - Provisione o worktree com tipo `docs` (`docs/<issue#>-<slug>`, suportado desde #429).
  - Despache o worker com prompt específico de modo investigação: dispensa TDD e testes de produto; exige relatório em `docs/investigations/<slug>.md` estruturado com Pergunta, Evidências (comandos/fontes reproduzíveis), Opções avaliadas e Recomendação; define critério de `GREEN` (relatório existe e `git diff --check` passa); e orienta que a entrega seguirá PR só de docs (#427), sem criação automática de issues de follow-up.

  Antes de cada dispatch, leia `../shared/references/issue-coordinator-dispatch.md` para duplicidade, status file e retomada em worktree existente.

  Ao preparar o worker, leia `../shared/references/issue-coordinator-dispatch.md` para convenções e o template completo do prompt.
  Abra o prompt de cada Lead Issue com o `ContextPacket` (critérios de aceite, módulo, comando de
  teste e arquivos-alvo), gerado por `scripts/context-packet.ts` conforme essa mesma referência.
  No encerramento de cada iteração com pendências ou escalação, siga `../shared/references/memory-handoffs.md` para registrar handoff opcional; status file permanece primário.

Ao concluir todas as issues com sucesso, o worker marca `GREEN`. Se falhar em alguma, para e marca
`FAILED_MAX_ITERATIONS` especificando qual issue falhou.

#### Dispatch para runtime externo ou orquestrador (delegação de código)

Caso o coordinator delegue o desenvolvimento de um grupo a um runtime externo de IA (Gemini/OpenCode/Codex) ou a um orquestrador MCP (Alethe — ver `delegate-to-runtime.md` §6 e `scripts/lib/orchestrator/`), aplique o **contrato mínimo de delegação e orquestração**:
1. **Worktree próprio**: provisione um worktree isolado exclusivo para o runtime ou worker externo via `worktree-create` (nunca opere no root nem em worktree de outro worker).
2. **Diff tratado como rascunho**: o código gerado pelo runtime externo é rascunho não confiável; nunca faça commit cegamente sem inspeção prévia e varredura de rascunhos (`delegate-to-runtime.md` §6.3, regra 8).
3. **Validação soberana no host via `module-test-map`**: execute a suíte de testes mapeada para os módulos tocados no host antes de qualquer commit; descarte o rascunho em caso de falha.
4. **Status file mantido pelo coordinator**: o coordinator é responsável por gerenciar e atualizar o status file (`.claude/vetor/status/<branch>.md`) a cada iteração (`RUNNING`, `Iteration: N/5`, `GREEN`, etc.).
5. **Polling seguro e liberação obrigatória**: com o orquestrador MCP (Alethe), chame `alethe_check` com `timeoutMs <= 50000` e `alethe_release` antes de qualquer remoção do worktree (`safe-remove-worktree`); fontes e datas em `delegate-to-runtime.md` §6.3.

Consulte `../shared/references/issue-coordinator-dispatch.md` para o fluxo detalhado desse contrato.

### 5 — Monitoramento

Leia `../shared/references/issue-coordinator-monitoring.md` ao montar/atualizar a tabela de status, incluindo fallback e duplicidade.

Ao ver um ou mais grupos em `GREEN` na tabela, **não espere os demais workers**: acione o Pre-Ship
de todos os verdes de uma vez (Fase 6.a). O CI desses PRs e o dos que ainda vão chegar correm em
paralelo no GitHub, e o acompanhamento é uma consulta agregada (5.e do `issue-coordinator-monitoring.md`).

**5.b — Escalação de bloqueios**

**A fonte de verdade da escalação é o status file.** Se um worker sinalizar bloqueio apenas por
chat, **não escale ainda**: instrua-o via `SendMessage` a gravar o `BLOCKED_WAITING` estruturado
(`Blocked on` / `Options` / `Recommendation`) primeiro, para que o estado sobreviva a um reinício.

**Em `--headless`: não escale.** Registre no relatório final o agente (`<slug>` / Issue `#<N>`), o
motivo do bloqueio e a recomendação do worker. Se a issue for mantida bloqueada ou retirada da leva,
aplique a label de bloqueio equivalente se já existir no repositório (`blocked` -> `status/blocked`;
nunca execute `gh label create` — ver tabela de mapeamento da Fase 1). Não conceda permissão, não
escolha opção técnica e não redespache. Nunca mate um worker bloqueado para abrir vaga no teto `N`.

Fora do headless, leia o bloco `Blocked on` / `Options` / `Recommendation` e escale via
`AskUserQuestion`, identificando o agente e transmitindo a recomendação. Opções conforme o tipo:
- **Permissão bloqueada** (`<comando>`): permitir esta vez / permitir para este agente (auto-aprova
  chamadas similares dele) / negar (registra "skipped", aplicando label de bloqueio existente no repo
  conforme a Fase 1 sem nunca criar labels) / parar agente.
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

### 6 — Fase de entrega (Pre-Ship paralelo, merge serializado)

⚠️ **Em `--headless` esta fase só roda com `--auto-ship` ou `autoShipHeadless: true`** (6.d). Sem eles
é pulada: liste os grupos `GREEN` no relatório final com branch e path do worktree, e encerre.

A entrega tem dois estágios (Spec `docs/specs/pipeline-ship-e-delegacao-eficiente.md`, RF-01 e
RF-02). O **Pre-Ship** (`/vetor:ship --prepare`: testes locais, push, PR draft, CI e revisões em
background) roda **em paralelo** para todos os grupos verdes. O **merge** (`/vetor:ship --finalize`)
é **serializado** — um por vez.

**6.a — Pre-Ship paralelo (issue #494).** Quando um agente atingir `GREEN` (confirme lendo o status
file), dispare o Pre-Ship de **todos os grupos verdes ainda não preparados**, sem esperar os demais
workers nem o CI de nenhum:

1. Para cada grupo, obtenha o path real do worktree (`git worktree list`, correlacionando pela
   branch da Fase 3). O `/vetor:ship` aborta se o `cwd` não for um worktree.
2. Despache **todos na mesma mensagem**, um `Agent()` por worktree, em background. O worktree já
   existe, então use um subagente padrão sem `subagent_type` (mesma regra do redespacho da Fase 4), com o
   `model` da regra de dispatch (`../shared/references/issue-coordinator-dispatch.md`):
   ```javascript
   Agent({
     description: "Pre-Ship #<N>: <título>",
     prompt: "Entre em <path-do-worktree> e execute /vetor:ship --prepare <issue#>. Não faça merge. " +
       "Ao terminar, o status file <status-file-path> deve estar PR_STAGED. Se os testes locais ou o push " +
       "falharem, deixe o worktree intacto e reporte o motivo.",
     model: "<haiku|sonnet>",
     run_in_background: true
   })
   ```
3. O Pre-Ship não ocupa vaga do teto `N` (o worker já liberou a sua ao atingir `GREEN`); o limite é o
   número de grupos verdes da onda.
4. O resultado vem do status file: `PR_STAGED` (com `PR: #<N>`) é sucesso. Se o `--prepare` falhar,
   marque o grupo na tabela como falha de pre-ship, preserve o worktree e siga com os demais.

**6.b — Aguardar o CI sem somar esperas (issue #494).** Não use `gh pr checks --watch` por PR (cada
espera bloqueia e o total vira N × T_ci). Acompanhe todos os PRs preparados com **uma** consulta
agregada, repetida a cada ≤ 45 s enquanto houver PR pendente (`5.e` de
`../shared/references/issue-coordinator-monitoring.md`). Como os CIs correm ao mesmo tempo no GitHub e
cada PR segue para o merge assim que fecha verde, a espera total converge para max(T_ci) + 60 s.

**6.c — Merge serializado.** Um PR por vez, assim que o CI fechar verde:

1. Para cada PR `PR_STAGED`, aplique o **Fast Merge Gate** (issue #495): leia
   `../shared/references/fast-merge-gate.md`. Ele compara os arquivos tocados e os módulos do PR
   (cache `<branch>-touched-files.json`) com as outras branches da onda — mapa de sobreposições feito
   antes do primeiro merge, porque o ship apaga o cache de cada PR no cleanup. Nenhum PR sobreposto
   já integrado e `mergeable == MERGEABLE`: `/vetor:ship --finalize <PR>` direto, sem re-sincronizar
   nem re-testar. Sobreposição com PR já integrado: merge da default no worktree e só a suíte do
   módulo coincidente antes do `--finalize`. Com merge queue ativa o `vetor-merge.sh` enfileira
   (exit 4).
2. Entre no worktree do grupo (`git worktree list`; `/vetor:ship` aborta fora de um worktree) e
   invoque `/vetor:ship --finalize <PR>`. Se o grupo não tem PR preparado (Pre-Ship indisponível), use o
   ciclo completo `/vetor:ship <issue#>`, que já re-sincroniza e re-testa.
3. Após merge bem-sucedido, atualize a tabela. Um PR **enfileirado** (merge queue/auto-merge, exit 4 do
   `vetor-merge.sh`) não é merge: registre `Enfileirado`, não rode sync-root nem cleanup e siga para o
   próximo grupo sem esperar a fila. Para grupos de spike/investigação, o `/vetor:ship` segue o caminho de PR só de docs (#427). A decisão decorrente do spike continua humana — issues de follow-up não são criadas automaticamente.

Se o `ship` falhar (CI vermelho, review required), marque na tabela e continue com os outros.

**6.d — Entrega autônoma em `--headless` (issue #497).** Só com `--auto-ship` ou
`autoShipHeadless: true` em `.claude/vetor/config.json` (lido a partir do root do repositório). Segue
6.a–6.c, com duas diferenças: nunca há pergunta ao usuário, e **nenhum PR é mergeado sem passar nos
quatro gates**. Leia `../shared/references/auto-ship-gates.md` (definição de cada gate, o que é PASS,
FAIL e PENDING, e as escolhas de segurança). Para cada PR `PR_STAGED`, antes do 6.c:

```bash
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" auto-ship-gates <PR> <path-do-worktree-do-grupo>
```

Os gates são: CI 100% `SUCCESS`; 0 apontamentos impeditivos (`blocker`) nas revisões consultivas;
0 colisões em `vetor-checks.sh migrations`; `mergeable == MERGEABLE`. Pelo exit do comando:

- **0 (`VERDICT: PASS`)**: siga o 6.c (Fast Merge Gate e `/vetor:ship --finalize <PR>`).
- **3 (`PENDING`)**: reavalie no ciclo da consulta agregada de CI (5.e), até 20 minutos depois do
  `PR_STAGED`; passado esse prazo, trate como falha de gate por timeout.
- **1 (`FAIL`)** ou timeout: **o PR fica aberto**. Registre no relatório (`Gate failed`, com os gates
  reprovados e o detalhe de cada um) e siga para o próximo grupo. Não aborte a sessão, não feche o PR,
  não force o merge e não tente consertar.
- Se o `--finalize` parar por review humano (ship §9) ou por permissão negada (ship §10), o resultado
  é o mesmo: PR aberto e registrado, sem `AskUserQuestion`.

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

Descarte também os worktrees pré-aquecidos que ninguém assumiu (timeout, circuit breaker, onda
interrompida) com `scripts/prewarm-worktrees.ts discard`, e liste no relatório o que vier em `failed` ou
`branchesKept` (`../shared/references/worktree-prewarm.md`).

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
- Em `--headless`: nunca chama `AskUserQuestion` nem `ExitPlanMode`, nunca faz merge/ship (exceto sob
  `--auto-ship`/`autoShipHeadless`, e só com os quatro gates da Fase 6.d em `PASS`), nunca
  auto-aprova permissão. Se o contexto exigir uma decisão que o headless não pode tomar, registre no
  relatório e pare — não improvise
- O gate de Spec/design (Fase 2) nunca bloqueia o dispatch em `--headless` — vira sinalização
  registrada no plano/relatório, nunca um `AskUserQuestion` síncrono (mesmo motivo do item acima:
  deadlock por falta de interlocutor, issue #121)
- O coordinator nunca cria labels no GitHub (nunca executa `gh label create`). Aplica labels de
  triagem existentes no repositório ao pular/bloquear issues e remove-as ao despachar; sem equivalente
  no repo, não aplica
- Nunca aplica labels de status de execução em andamento (ex.: `in-progress`); o estado de execução
  vive exclusivamente no worktree e no status file
