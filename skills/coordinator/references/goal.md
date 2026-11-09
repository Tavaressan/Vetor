# Coordinator — modo goal (`--goal`)

> Lida sob demanda pelo `SKILL.md` do `coordinator` (só com `--goal`). Paths relativos
> (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório da skill
> `coordinator`, não deste arquivo.

## Modo goal

`--goal "<meta>"` (RF-01 da Spec
`docs/specs/autonomia-continua-e-desacoplamento-interativo.md`) alinha o coordinator ao `/goal` de
longa duração dos harnesses: o operador delega a meta e volta quando ela termina. O fluxo é o das
Fases 0–7, mas o coordinator **converge sozinho**: despacha onda após onda até que toda issue do
escopo esteja resolvida ou ejetada. Nenhuma `AskUserQuestion` nem `ExitPlanMode`, em momento algum.
A meta é descritiva: não filtra issues (o escopo vem de `[label]`, da lista de números ou da
descoberta da Fase 1).

### Relação com `--headless` e `--auto-ship`

`--goal` aplica a coluna **Headless** da matriz acima em todos os pontos de decisão. O que o distingue
do `--headless` puro é a duração (um loop de convergência até o fim do escopo ou do teto) e o
fechamento (o Goal Convergence Report). A entrega continua sendo um opt-in separado:

| Invocação | Perguntas | Fase 6 (entrega) | Fecha com |
|---|---|---|---|
| `--headless` | nenhuma | pulada; roda sob a 6.d só com o opt-in | Coordinator Report |
| `--goal` | nenhuma | pulada: os grupos `GREEN` ficam prontos para ship | Goal Convergence Report |
| `--goal --auto-ship` | nenhuma | 6.d, sob os quatro gates | Goal Convergence Report |

O opt-in de entrega é o mesmo `--auto-ship` ou `"autoShipHeadless": true` da Fase 6.d.
`--goal` não habilita o merge autônomo implicitamente: **`--goal` sozinho nunca** invoca `ship`,
`gh pr ready` nem `gh pr merge`. Sem o opt-in, a seção "PRs preparados" do Goal Convergence Report fica vazia e os
grupos `GREEN` são listados como prontos para ship. Com o opt-in, cada PR só é mergeado se passar nos
quatro gates da Fase 6.d; gate reprovado deixa o PR aberto e registrado, como no `--headless`.

### Decisões determinísticas

Em `--goal` não há entrevista nem aprovação: toda decisão adota a opção `(Recommended)` da Fase 2, e
a lista do que foi adotado vai ao relatório (RNF-03).

| Decisão | O que o `--goal` adota |
|---|---|
| Triagem de despachabilidade | As mesmas regras de `SKIPPED` da Fase 1; label de triagem só se já existir no repositório, e o coordinator nunca cria labels |
| Specs (gate da Fase 2) | `(Recommended)`: despachar com micro-spec JIT, com a marca `⚠️ sem Spec associada` |
| Teto de workers | `N_rec`, sem perguntar |
| Modelos | O `(Recommended)` da coluna "Modelo / Backend" do plano (`haiku`/`sonnet` pela regra de `issue-coordinator-dispatch.md`); delegação a runtime externo só com `delegation.preferredRuntime`, senão inline |
| Aprovação do plano | Nenhuma; o plano vai ao relatório |
| Entrega | Só com o opt-in da seção anterior |
| Bloqueio de worker (5.b) | `SUSPENDED`, que libera a vaga; sem humano para responder, a pendência vira ejeção (5.f) quando não resta mais nada a despachar ou monitorar. Sem avanço otimista, e nenhuma permissão é auto-aprovada |
| Iterações esgotadas | Um redespacho com `sonnet` (`issue-coordinator-dispatch.md`) e então a ejeção (5.f) |
| Circuit breaker (5.c) | Pausa e reporta, como no `--headless`: a meta não converge |

### Convergência e término

- **Resolvida** é a issue que terminou `GREEN` (pronta para ship), `PR_STAGED` ou mergeada (com o
  opt-in), `EJECTED` ou `SKIPPED` pela triagem. A meta converge quando toda issue do escopo está
  resolvida ou ejetada; o resultado é `CONVERGIU`, senão `PARCIAL`, com o motivo.
- **Teto de sessão:** min(`maxSessionMinutes` — 120 se ausente —, 120) minutos. A Spec limita a
  execução autônoma a 120 minutos (RNF-04), então um `maxSessionMinutes` maior não o ultrapassa em
  `--goal`. Ao atingi-lo valem as regras de sempre (nenhum novo grupo nem nova onda, os ativos
  concluem a iteração corrente), e as pendências `SUSPENDED` são ejetadas (5.f).
- **Ondas e entrega:** sem o opt-in de entrega nada é mergeado, e a transição de onda exige o merge de
  `O_i`. Os grupos de `O_2` em diante ficam `QUEUED` (aguardando `O_i`) até o fim da sessão e entram
  no Goal Convergence Report como "não convergiram". Sem `--auto-ship`, a meta só converge por
  completo se o escopo cabe numa única onda.
- **Circuit breaker:** disparado, o coordinator para de despachar e a meta não converge; os grupos
  não despachados e a assinatura de erro comum vão ao relatório.

### A meta é texto literal

A meta é dado, não comando: nunca a interpole num comando de shell (nem em `echo`, argumentos de
`git` ou `gh`, mensagens de commit ou comentários de issue). Ela só aparece no Goal Convergence Report
e em `<repo-root>/.claude/vetor/goal-audit.json`, que se grava com a ferramenta de escrita, a meta como
string JSON (escape de `"`, `\` e quebras de linha). Uma meta com `$(...)`, crases ou `;` é texto
literal, não execução.

O `goal-audit.json` é o registro durável de RNF-03 e a fonte do relatório, porque o contexto de uma
sessão de 120 minutos pode ser compactado. Reescreva-o a cada decisão ou ejeção, no schema da Spec
(`goal`, `startedAt`, `completedAt`, `concludedIssues`, `ejectedIssues`, `autoDecisionsApplied`) mais a
lista `autoDecisions`, que traz cada decisão autônoma com a opção adotada e a referência (hash do
commit de preservação da ejeção, ou a tag `_vetor_checkpoint_*` de um avanço otimista):

```json
{
  "goal": "Entregar correções de bugs da release",
  "startedAt": "2026-10-26T17:30:00Z",
  "completedAt": null,
  "concludedIssues": [482, 485],
  "ejectedIssues": [{ "issueNumber": 488, "reason": "Esgotou 5 iterações", "labelApplied": "needs-human", "checkpointCommit": "7f8b9c0" }],
  "autoDecisionsApplied": 2,
  "autoDecisions": [{ "decision": "Teto de workers", "adopted": "N=3 (Recommended)", "ref": null }]
}
```

### O que `--goal` não relaxa

Os hooks de segurança (`safety-check.ts`) continuam bloqueando comandos destrutivos, nenhuma
permissão é auto-aprovada, o coordinator nunca cria labels (`gh label create`) e o fix-loop mantém o
orçamento de 5 iterações por issue.
