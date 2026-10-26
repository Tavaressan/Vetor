# Fast Merge Gate — fast-path de squash merge e merge queue (Fase 6)

> Extraído do desenho da issue #495 (Spec `docs/specs/pipeline-ship-e-delegacao-eficiente.md`,
> RF-03 e RF-04) e lido só quando a Fase 6 de `skills/coordinator/SKILL.md` manda. Paths relativos
> (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório da skill
> `coordinator`, não deste arquivo.

Aplica-se a cada grupo `GREEN` cujo PR já foi preparado (`PR_STAGED`, via `/vetor:ship --prepare`),
na ordem serializada da Fase 6. Grupo sem PR (fluxo legado) usa `/vetor:ship <issue#>` completo, que
já re-sincroniza e re-testa: o fast-path não se aplica a ele.

## 1 — Mapear as sobreposições antes do primeiro merge

O cache `<repo-root>/.claude/vetor/status/<branch>-touched-files.json`
(`touched-files-cache.md`) é apagado no cleanup do ship (§12, `clean-status`) assim que o PR é
integrado. Por isso a comparação precisa rodar **antes do primeiro merge da Fase 6**, enquanto os
caches de toda a onda ainda existem. A ordem de merge é a ordem em que os CIs fecham, então não é
conhecida de antemão: compare cada candidato `Pk` com **todas as outras** branches preparadas da onda
e guarde, para cada `Pk`, o conjunto `S(Pk)` das branches que o sobrepõem.

```bash
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" check-disjoint <branch-Pk> <demais branches preparadas da onda>
```

| Saída | Significado | `S(Pk)` |
|-------|-------------|---------|
| exit 0, `DISJOINT` | `files(Pk) ∩ files(Pj) = ∅` **e** `modules(Pk) ∩ modules(Pj) = ∅` para todo `Pj` | vazio |
| exit 1, `OVERLAP: <branch> modules=[..] files=[..]` | há interseção; uma linha por branch que sobrepõe | as branches listadas (e os módulos coincidentes, para o passo 3) |
| exit 2 | não foi possível obter os arquivos tocados (sem cache nem `git diff`) | todas as outras branches (conservador) |

Cache ausente não é erro: a CLI recalcula com `git diff --name-only origin/<default>...<branch>` (e
mapeia os módulos pela tabela do `module-test-map.md`). Basta comparar com os PRs da própria onda:
o que entrou na default por fora dela é coberto pelo estado `mergeable` do passo 2.

## 2 — Fast-path (nenhum PR de `S(Pk)` integrado e `MERGEABLE`)

Quando o CI de `Pk` fechar verde, ele é elegível ao fast-path se **nenhuma branch de `S(Pk)` já foi
integrada nesta Fase 6** (as que ainda não entraram na default não contam: elas é que vão ter de
sincronizar quando chegar a vez delas). Um `Pk` com `S(Pk)` vazio é sempre elegível; o primeiro PR a
ser integrado também, já que nada da onda entrou antes dele.

a. Imediatamente antes do merge de cada PR, consulte o estado atual (ele muda a cada merge da onda):

```bash
gh pr view <PR> --json mergeable -q .mergeable
```

- `MERGEABLE`: siga para o item b.
- `UNKNOWN`: o GitHub ainda recalcula (comum logo após outro merge). **Não** trate como `MERGEABLE`.
  Repita até 3 vezes, esperando no máximo 45 s por tentativa (teto de polling, RNF-04); se continuar
  `UNKNOWN`, siga o passo 3.
- `CONFLICTING`: passo 3.

b. Elegível e `MERGEABLE`: entre no worktree do grupo (`git worktree list` para o path real) e confira
as migrations contra a default antes de mergear — arquivos diferentes podem trazer a mesma versão
(`V14__a.sql`, `V14__b.sql`), uma colisão que nem o git nem a disjunção de arquivos enxergam:

```bash
git fetch origin "$DEFAULT_BRANCH"
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" migrations --against "origin/$DEFAULT_BRANCH"
```

Saída diferente de 0: siga o passo 3 (renumere a migration do PR). Com 0, execute o merge **sem
re-sincronizar nem re-testar a suíte**:

```
/vetor:ship --finalize <PR>
```

O `--finalize` confirma CI e revisões do PR já preparado e chama `vetor-merge.sh`. A meta da Spec é
menos de 15 s por PR, descontado o tempo de CI (que já correu em paralelo no Pre-Ship).

c. Se o `vetor-merge.sh` sair com 3 (outro commit entrou na default entre a verificação e o merge e
gerou conflito no servidor — edge case da Spec), abandone o fast-path deste PR e siga o passo 3.

## 3 — Sync (algum PR de `S(Pk)` já integrado, estado não `MERGEABLE` ou dados indisponíveis)

No worktree do grupo:

```bash
git fetch origin "$DEFAULT_BRANCH"
git merge "origin/$DEFAULT_BRANCH"
```

- Conflito: siga `../shared/references/conflict-resolution.md`.
- Rode **apenas a suíte do módulo coincidente** (os módulos das linhas `OVERLAP: <branch> modules=[..]`
  das branches de `S(Pk)` já integradas, resolvidos pelo `module-test-map.md` a partir do root do
  repositório). Sem módulo listado (sobreposição só de arquivos) ou com exit 2 (sobreposição
  desconhecida), rode os módulos de todos os arquivos do PR.
- Teste verde: `git push`, depois `/vetor:ship --finalize <PR>` (que aguarda o CI da nova cabeça do PR).
- Teste vermelho: `fix` no worktree (orçamento normal); o grupo não é mergeado enquanto estiver vermelho.

## 4 — Merge queue e auto-merge (RF-04)

O `vetor-merge.sh` decide sozinho: consulta a API GraphQL do GitHub
(`Repository.mergeQueue(branch:)` do branch base do PR; nulo = sem fila) e, com fila ativa, usa
`gh pr merge --auto --squash` (sem `--delete-branch`, que o `gh` recusa nesse caso). `vetor-merge.sh
--auto <PR>` força o auto-merge. O `gh` sai com 0 também ao **enfileirar**, então o script confirma o
estado real do PR:

| Exit do `vetor-merge.sh` | Estado | O que o coordinator faz |
|---|---|---|
| 0 | PR **mergeado** | passos 11 e 12 do ship; registre `Merged` |
| 4 | PR **enfileirado** (continua OPEN) | registre `Enfileirado`, **não** rode sync-root nem cleanup, preserve worktree/branch/status e siga para o próximo PR **sem esperar a fila** |
| 3 | não mergeado | passo 3 deste documento |

Com fila ativa a ordenação passa a ser do GitHub: enfileire todos os PRs que concluíram o Pre-Ship
(cada `--finalize` sai com 4) e encerre a Fase 6 sem polling local. O cleanup dos grupos enfileirados
fica para uma próxima sessão, quando `vetor-status.sh` mostrar `GREEN (já mergeado via #N)`.

**Limitação (verificada em 2026-10-26).** O campo `Repository.mergeQueue(branch:)` existe no schema
GraphQL público do GitHub (`docs.github.com/public/fpt/schema.docs.graphql`) e a consulta foi
exercitada contra este repositório, que não tem fila (retorna `null`). O ramo positivo (fila ativa)
**não foi exercitado contra um repositório real com fila**; é coberto apenas por teste com `gh`
simulado. Se a consulta falhar (rede, permissão), a fila é tratada como ausente: o `gh` ainda enfileira
sozinho num branch com fila e o script reporta exit 4, mas o `--delete-branch` faz o `gh` falhar com
mensagem própria (exit 3). Sem a configuração "Allow auto-merge" no repositório, `--auto` explícito
falha no `gh` (exit 3).

## Limitações conhecidas

- **Granularidade de módulo.** O critério usa os módulos do `module-test-map.md`. Em repositório com
  poucos módulos (ex.: `root` e `cli`), a maioria dos PRs compartilha o módulo `root` e cai no sync;
  o fast-path dispara, sobretudo, entre PRs de módulos diferentes.
- **Independência semântica é inferida, não provada.** Arquivos e módulos disjuntos mais `MERGEABLE`
  não garantem ausência de interação entre as mudanças; é o risco aceito pela Spec. Branch protection
  com "require branches to be up to date" continua valendo: o GitHub recusa o merge (exit 3) e o PR
  segue pelo passo 3.
