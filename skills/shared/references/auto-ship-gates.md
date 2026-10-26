# Entrega autônoma em `--headless` — os quatro gates (Fase 6.d)

> Extraído do desenho da issue #497 (Spec `docs/specs/pipeline-ship-e-delegacao-eficiente.md`, RF-05)
> e lido só quando a Fase 6.d de `skills/coordinator/SKILL.md` manda. Paths relativos
> (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório da skill
> `coordinator`, não deste arquivo.

## Ativação

Em `--headless` a Fase 6 só roda com **`--auto-ship`** na linha de comando **ou**
**`"autoShipHeadless": true`** em `.claude/vetor/config.json` (lido a partir do root do repositório,
`vetor-checks.sh repo-root`, nunca do `cwd`). Sem nenhum dos dois, o comportamento é o de sempre: a
fase é pulada e os grupos `GREEN` saem no relatório como prontos para ship. `--auto-ship` fora de
`--headless` não muda nada: o modo interativo já entrega, com aprovação humana.

## Os gates

O coordinator não decide lendo o PR: o script avalia os quatro gates e o merge só acontece com
`VERDICT: PASS`.

```bash
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" auto-ship-gates <PR> <path-do-worktree-do-grupo>
```

Uma linha `GATE <nome>: <PASS|FAIL|PENDING> <detalhe>` por gate e, no fim, `VERDICT: <...>`.

| Gate | PASS | FAIL | PENDING |
|------|------|------|---------|
| `ci` | todos os itens de `statusCheckRollup` concluídos com `SUCCESS` (`StatusContext`: `SUCCESS`) | qualquer conclusão diferente de `SUCCESS`, **inclusive** `SKIPPED` e `NEUTRAL` (o gate é estrito: "100% SUCCESS") | lista vazia, ou check ainda em andamento |
| `reviews` | PR só de docs/lockfile (mesma dispensa do ship 8.5), ou code review publicado sem linha `blocker` e security review (se houver) sem severidade crítica/alta | code review com ao menos um `blocker`, ou security review com severidade crítica, alta ou `blocker` | code review ainda não publicado, ou autor das revisões não verificável |
| `migrations` | `vetor-checks.sh migrations --against origin/<default>` sai com 0 | sai com código diferente de 0 (versão duplicada) | a verificação não rodou (ex.: `git fetch` falhou) |
| `mergeable` | `MERGEABLE` | `CONFLICTING` | `UNKNOWN` (o GitHub ainda recalcula) |

Veredito: um `FAIL` em qualquer gate dá `FAIL`; sem `FAIL` mas com algum `PENDING` dá `PENDING`; só
com os quatro `PASS` dá `PASS`. Exit do comando: **0** PASS, **1** FAIL, **3** PENDING, **2** uso
incorreto. Na dúvida (gh fora do ar, JSON ilegível) o resultado é `PENDING`, nunca `PASS`.

### Por que cada escolha

- **`migrations --against`.** Dois PRs preparados em paralelo podem trazer a mesma versão de migration
  em arquivos diferentes (`V14__a.sql`, `V14__b.sql`): o git não vê conflito e a disjunção de
  arquivos do Fast Merge Gate também não. Comparar só a árvore do PR (como o ship 2.b faz depois de
  sincronizar) não enxerga a migration que entrou na default depois do Pre-Ship; o `--against` soma as
  migrations de `origin/<default>` à árvore do PR. Limitação: uma migration que o PR removeu e que a
  default ainda tem conta como presente (falso positivo, que apenas mantém o PR aberto).
- **Revisões só valem se forem do mesmo usuário do `gh`.** O merge é irreversível e qualquer pessoa
  com acesso de comentário poderia publicar um "Code Review (Vetor)" limpo por cima de um `blocker`.
  O script compara o `author.login` dos comentários com `gh api user`. Vale o comentário **mais
  recente** de cada tipo (`## Code Review (Vetor)`, `## Security Review (Vetor)`).
- **Security review pode não existir.** A skill nativa é opcional na sessão (ship 8.5): comentário
  ausente não reprova. Code review ausente em PR de código é `PENDING` (o subagente roda em
  background).
- **Severidade do security review é heurística.** O relatório da skill nativa é texto livre; o gate
  procura `Severity`/`Severidade` seguida de `critical`/`crítica`/`high`/`alta`/`blocker` na mesma
  linha, ou linha de tabela com essa severidade. É conservador: o texto "severidade alta" mesmo
  numa frase negativa reprova e mantém o PR aberto para um humano.
- **Revisões continuam consultivas no modo interativo.** O gate `reviews` só vale para a entrega
  autônoma, onde não há humano para ler o comentário (decisão do ship 8.5 inalterada).

## O que fazer com cada resultado

1. **`PASS`**: Fast Merge Gate (`fast-merge-gate.md`) e `/vetor:ship --finalize <PR>`. O fast-path decide
   *como* mergear, nunca *se*: os quatro gates valem sempre.
2. **`PENDING`**: reavalie no mesmo ciclo da consulta agregada de CI (5.e, no máximo 45 s entre
   avaliações). Se continuar `PENDING` 20 minutos depois do `PR_STAGED` (timeout de CI da Spec), trate
   como falha de gate por timeout.
3. **`FAIL`** ou timeout: **o PR fica aberto**, como está. Registre no relatório o resultado `Gate
   failed` com os gates reprovados e o detalhe de cada um, e siga para o próximo grupo. Não aborte a
   sessão com erro, não feche o PR, não force merge, não conserte nada por conta própria.
4. **`--finalize` que parar** por review humano (`reviewDecision` `REVIEW_REQUIRED` ou
   `CHANGES_REQUESTED`, ship §9) ou por permissão negada (ship §10): PR aberto, registrado como
   `Review required` ou `Gate failed (permissão negada)`. Nunca `AskUserQuestion` em `--headless`.
5. **`vetor-merge.sh` com exit 4** (merge queue/auto-merge): `Enfileirado`, como em 6.c.
