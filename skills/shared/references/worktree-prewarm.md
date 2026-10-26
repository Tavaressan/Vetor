# Pre-warming de worktrees (RF-06)

> Lido pelo `coordinator` na Fase 0 (retomada), Fase 1 (gatilho), Fase 3 (reconciliação), Fase 4
> (dispatch) e Fase 7 (limpeza final). Spec:
> `docs/specs/autonomia-continua-e-desacoplamento-interativo.md`, RF-06. Paths relativos e
> `$SKILL_DIR` resolvem a partir do diretório da skill `coordinator`.

## Ativação (opt-in, desligado por padrão)

O pre-warming só roda com **`"prewarmWorktrees": true`** em `.claude/vetor/config.json`, lido a partir
do root do repositório (`vetor-checks.sh repo-root`, nunca do `cwd`), no mesmo padrão do
`autoShipHeadless` (#497) e do `hooks.typecheckOnEdit` (#514). Tudo abaixo, do Gatilho ao Dispatch, vale
**somente** com o opt-in ligado. Sem a chave, ou com `false`:

- a Fase 1 não dispara o `start`;
- a Fase 3 não reconcilia nada;
- a Fase 4 não faz `claim`, e o dispatch é sempre o clássico, com `vetor:issue-worker` e
  `isolation: "worktree"`.

O `discard` das Fases 0 e 7 continua mesmo sem o opt-in: é idempotente, sem manifest não faz nada e limpa
as sobras de uma sessão anterior que tenha rodado com o opt-in.

**Por que é opt-in.** O worker pré-aquecido é um subagente padrão: perde a allowlist de `tools`, o preload
da skill `fix` e as guardas por `agent_type` do `safety-check.ts` (escrita fora do worktree, por
exemplo), que só valem para `vetor:issue-worker`. O prompt do template repete essas guardas, mas por
instrução, e não por mecanismo da plataforma. Em troca há um ganho que **ninguém mediu**. Meça antes de
ligar (seção "Como medir os critérios de tempo") e só ligue se a largada melhorar no seu projeto.

## Por que não é um hook nem um pool

No dispatch clássico o harness cria o worktree em `Agent({ isolation: "worktree" })`, a partir do HEAD
local do root, e o path só é conhecido **depois** do `Agent()` (hook `WorktreeCreate`,
`scripts/prepare-worktree.ts`). Nada disso pode ser antecipado durante a entrevista. O pre-warming
cria o worktree **antes**, em `.claude/worktrees/<slug>`, com `scripts/prewarm-worktrees.ts`, e o
worker entra nele pelo mesmo caminho do redispatch (subagente padrão com `cd`). Um pool que o hook
`WorktreeCreate` consumisse foi descartado: o hook é o caminho fatal de criação do worktree, e um pool
ficaria velho em relação ao HEAD do root a cada merge.

## Escopo

- **Só a onda corrente, e só a primeira (`O_1`) da sessão.** A base de `O_2+` só existe depois do merge
  das ondas anteriores; um worktree pré-aquecido antes disso reproduziria o branch skew da Fase 1.
- **No máximo `N_rec` grupos** (a recomendação da Fase 2: `min(largura da maior onda,
  maxConcurrentWorkers ou 5)`), os primeiros por prioridade. Os demais seguem o dispatch clássico.
- Ficam de fora grupos `SKIPPED`, retomadas (`--resume`) e redispatch em worktree existente.
- Issues spike usam o tipo `docs`, como no restante do coordinator.

## Gatilho (fim da Fase 1, antes da Fase 2)

Com os grupos e as ondas definidos, rode em **background** (`run_in_background: true`). O `discard`
inicial é idempotente e limpa sobras de uma sessão interrompida:

```bash
deno run -A "$SKILL_DIR/../../scripts/prewarm-worktrees.ts" discard
deno run -A "$SKILL_DIR/../../scripts/prewarm-worktrees.ts" start --base "$DEFAULT_BRANCH" \
  --groups '[{"slug":"<slug>","branch":"<type>/<issue#>-<slug>"}]'
```

O `start` faz `git fetch origin "$DEFAULT_BRANCH"` (sem rede, usa a branch local), cria cada worktree
com `git worktree add --no-track -b <branch> .claude/worktrees/<slug> origin/<base>` e roda
`prepareDeps` (a mesma preparação do hook). O progresso fica em `<repo-root>/.claude/vetor/prewarm.json`,
gravado de forma atômica (arquivo temporário + rename): cada grupo está `warming`, `ready`, `claimed`,
`failed` ou `discarded`, com `worktreeMs` e `depsMs`. Path ou branch já existentes viram `failed` e
nunca são tocados.

Dois efeitos colaterais conhecidos:

- **Sem status file é esperado.** Um worktree `ready` ainda não tem status file (o coordinator o cria
  só no dispatch), e isso não é a falha anômala da issue #72. O `start`, o `claim` e o `discard`
  mantêm `<repo-root>/.claude/vetor/prewarm-pending.txt` (uma branch por linha, com `/` trocada por `-`)
  e o `vetor-status.sh` não alerta para as branches listadas ali. Crie o status file **depois** do
  `claim`, nunca antes.
- **Uma sessão de coordinator por vez.** O manifest é único por repositório. Um segundo coordinator que
  rode `discard` e `start` apaga os grupos ainda não assumidos do primeiro; o próximo `claim` do
  primeiro falha e esse grupo cai no dispatch clássico. Nenhum trabalho se perde, só o pre-warming.

## Regra de sincronia (bloqueante)

**Nenhum `Agent()` e nenhum `discard` antes de o `start` terminar** (`finishedAt` presente no
manifest, ou a notificação de fim do comando em background). Um dispatch clássico concorrente
dispararia o `git worktree add` do hook ao mesmo tempo que o do `start` e disputaria o `index.lock`.
Em `--headless` não há janela de entrevista: o coordinator apenas espera o `start` terminar, o que
costuma levar poucos segundos, antes da Fase 4.

## Reconciliação (Fase 3, depois da aprovação)

- Plano aprovado como estava: nada a fazer.
- Plano alterado (issue removida pelo gate de Spec, grupo refeito): `discard --keep <slugs que
  continuam>`. Grupo cuja Lead ou branch mudou perde o pre-warm e segue o dispatch clássico.
- Plano cancelado: `discard`. O JSON impresso traz `durationMs` (critério de RF-06: remoção em menos de
  10 s; não verificado, ver "Como medir").

O `discard` nunca força: reusa `vetor-checks.sh safe-remove-worktree` (mudanças não commitadas recusam
a remoção e o grupo aparece em `failed`) e só apaga a branch se ela ainda aponta para o SHA da base,
sem consultar o GitHub. Branch que avançou fica registrada em `branchesKept`.

## Dispatch (Fase 4)

Para cada grupo, antes do `Agent()`, rode `deno run -A "$SKILL_DIR/../../scripts/prewarm-worktrees.ts"
claim <slug>`:

- **exit 0**: imprime o JSON do grupo (`path`, `branch`) e o marca `claimed`. Crie o status file
  `RUNNING` (Fase 3 de `issue-coordinator-dispatch.md`), gere o ContextPacket com `--worktree <path>` e
  despache como abaixo.
- **exit 1** (`failed`, ausente, `warming` esquecido): dispatch clássico, com `vetor:issue-worker` e
  `isolation: "worktree"`. Registre o motivo no relatório. Nunca bloqueie o dispatch por causa do
  pre-warming (Spec, "Error Handling").

`depsFailed: true` não impede o uso: o worker instala o que faltar, como na regra do hook.

### Template do `Agent()` em worktree pré-aquecido

Subagente padrão: **sem `subagent_type` e sem `isolation`**, porque `vetor:issue-worker` força um
worktree novo pelo frontmatter (mesma regra do redispatch em `issue-coordinator-dispatch.md`).

```javascript
Agent({
  description: "Grupo Lead #<N>: <título> (worktree pré-aquecido)",
  prompt: "<ContextPacket com worktree.path>\n<instruções abaixo>",
  model: "<haiku|sonnet>",
  run_in_background: true
})
```

Esse agente perde a allowlist de `tools`, o preload da skill `fix` e as guardas por `agent_type` do
`safety-check.ts` (escrita fora do worktree, por exemplo). O prompt precisa carregar tudo isso,
**sempre**:

1. Abrir com o ContextPacket JSON, com `worktree.path` preenchido pelo `claim`.
2. `cd <path>` em **cada** comando Bash (o cwd não persiste entre chamadas). A branch `<branch>` já existe
   e está em checkout: **não** rode `git checkout -b`. Confirme com `git branch --show-current`.
3. A primeira ação é gravar o status file `Status: RUNNING` no path absoluto `<status-file-path>` (e a
   cópia `.claude/vetor-status.md` dentro do worktree se a plataforma recusar o path do root).
4. Sincronizar sempre, em qualquer onda: `git fetch origin "$DEFAULT_BRANCH"`, comparar
   `git log origin/$DEFAULT_BRANCH -1` com `git log HEAD -1` e, se atrasado, `git merge
   origin/$DEFAULT_BRANCH` antes de procurar arquivos. O worktree nasceu antes da entrevista, possivelmente
   horas antes.
5. Invocar a skill `fix` (`Skill` com `vetor:fix`) para o loop reproduce → fix → test, com TDD e orçamento
   de 5 iterações.
6. **Nunca** chamar `EnterPlanMode`. Executar de forma síncrona até um estado terminal (`GREEN`,
   `FAILED_MAX_ITERATIONS` ou `BLOCKED_WAITING`), sem esperar notificações em background.
7. **Nunca** `git push`, `gh pr create`, `gh pr ready` ou `gh pr merge`; nunca criar ou remover o
   worktree; escrever apenas dentro do worktree, exceto o status file. Bloqueio vira `BLOCKED_WAITING`
   com `Blocked on` / `Options` / `Recommendation`.
8. Antes da primeira iteração, ler a página `vetor/session-learnings` e, no `GREEN`, registrar os próprios
   aprendizados, ambos conforme a seção "Aprendizados da sessão" de `memory-gotchas.md`.
9. Para issues spike, o modo investigação do item 7 do prompt clássico; para módulo com `module-test-map`
   fora do git, os comandos de teste pré-resolvidos (item 6 do prompt clássico).

## Como medir os critérios de tempo (não verificados)

Nenhum dos tempos abaixo foi medido: não há baseline coletado e **nenhum ganho é afirmado**. Em
projetos Deno puro o `prepareDeps` é um no-op, então o que o pre-warming antecipa é o
`git worktree add`; a latência de iniciar o próprio subagente não muda e pode dominar os 5 s.

Para comparar os dois modos, rode a mesma issue de teste duas vezes: com `prewarmWorktrees` ausente (dispatch
clássico, o baseline) e com `"prewarmWorktrees": true`. Desligue de novo se o ganho não aparecer.

- **Largada do worker (< 5 s).** Anote `date -u +%Y-%m-%dT%H:%M:%S.%3NZ` imediatamente antes do
  `Agent()`. O coordinator já criou o status file `RUNNING`; a primeira alteração depois dessa marca é a
  primeira ação do worker. Leia `stat -c %y <status-file>` até ele mudar. A diferença é a largada. Repita
  3 vezes por modo (pré-aquecido vs. dispatch clássico, mesmo repositório e mesma issue de teste) e
  compare as medianas.
- **Custo antecipado.** `worktreeMs` e `depsMs` de cada grupo no `prewarm.json` são o que o dispatch
  deixou de pagar.
- **Remoção (< 10 s).** `durationMs` do JSON do `discard`.
