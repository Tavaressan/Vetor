# Investigação: teto de subagentes simultâneos do coordinator

**Issue:** #564 — spike(coordinator): repensar o teto de subagentes simultâneos
**Data:** 2026-11-09
**Base:** `master` em `90d819f` (v1.4.0)
**Arquivos afetados (não alterados aqui):** `skills/coordinator/SKILL.md` (Fase 2),
`skills/coordinator/references/worker-cap.md`, `wiki/Decisoes-de-Design.md`, `maxConcurrentWorkers`
em `.claude/vetor/config.json`.

**Rótulos:** **[Fato]** medido ou lido na fonte citada · **[Inferência]** · **[Opinião]** ·
**[Não verificado]**.

---

## 1. Pergunta

O teto atual, `N_rec = min(largura da maior onda, maxConcurrentWorkers, senão 5)`, com o alerta
"acima de ~8 o custo cresce mais rápido que o ganho", reflete os gargalos reais de uma rodada do
coordinator? Qual deveria ser o critério, e ele deveria ser fixo, calculado ou adaptativo?

O valor 5 e o limiar ~8 foram fixados pelas issues #65, #346 e #414 sem medição registrada.

## 2. Resumo

- **[Fato]** **O gargalo medido foi a entrega, não o desenvolvimento.** Na onda de 5 workers, cada
  worker levou de 2 a 8 minutos do primeiro commit até abrir o PR, mas de **15 a 23 minutos do PR ao
  merge**. Os merges saíram em série, um a cada ~3 minutos, e cada PR rodou o CI **3,4 vezes em média**
  (17 execuções para 5 PRs), por causa dos re-syncs. Na onda de 2, cada PR foi do PR ao merge em
  **1,7 minuto**, com **um** CI cada.
- **[Fato]** **O ganho de vazão do paralelismo foi pequeno:** 6,2 minutos por PR entregue com 5
  workers, contra 4,6 com 2, contados do primeiro commit ao último merge.
- **[Fato]** Pela documentação do Claude Code, **todo pedido de permissão de um subagente em
  segundo plano sobe para a sessão principal**, e plugin subagents (como o `vetor:issue-worker`) **não
  aceitam `permissionMode`**: herdam o modo da sessão. Com um humano e o modo `default`, N workers
  disputam a mesma fila de aprovação. Isso é coerente com a hipótese da onda parada por ~8h30, mas a
  causa exata não pôde ser verificada (§3.4).
- **[Fato]** O limite da plataforma é de **20 subagentes simultâneos** por sessão, configurável. Não
  há limite documentado mais baixo para worktrees.
- **[Opinião]** **Recomendação:** baixar o padrão de 5 para **3**, trocar o alerta "acima de ~8" por
  um alerta baseado no que foi medido (fila de merge e fila de permissões), e tornar o teto dependente
  do modo. `maxConcurrentWorkers` continua como override do usuário.

## 3. Evidências

### 3.1 Linha do tempo das duas ondas (GitHub)

Fonte: `gh pr view <n> --json commits,createdAt,mergedAt` e `gh run list --branch <b>`, consultados em
2026-11-09. Horários em UTC, todos de 2026-11-03.

**Onda de 5 workers** (#546, #547, #540, #545, #543):

| Issue | PR | 1º commit | PR criado | Merge | Commits | CI (ok/falha) | 1º commit → PR | PR → merge |
| --- | --- | --- | --- | --- | ---: | --- | ---: | ---: |
| #546 | #548 | 00:23:15 | 00:26:26 | 00:41:18 | 2 | 2/0 | 3,2 min | 14,9 min |
| #547 | #549 | 00:26:08 | 00:28:35 | 00:51:31 | 5 | 4/0 | 2,5 min | 22,9 min |
| #540 | #550 | 00:26:40 | 00:29:27 | 00:45:22 | 3 | 3/0 | 2,8 min | 15,9 min |
| #545 | #551 | 00:28:34 | 00:30:42 | 00:48:28 | 5 | 2/2 | 2,1 min | 17,8 min |
| #543 | #552 | 00:29:03 | 00:36:51 | 00:54:26 | 6 | 4/0 | 7,8 min | 17,6 min |

Merges: 00:41:18 → 00:45:22 → 00:48:28 → 00:51:31 → 00:54:26 (intervalos de 4,1, 3,1, 3,1 e 2,9 min).

**Onda de 2 workers** (#541, #544):

| Issue | PR | 1º commit | PR criado | Merge | Commits | CI | 1º commit → PR | PR → merge |
| --- | --- | --- | --- | --- | ---: | --- | ---: | ---: |
| #541 | #553 | 01:00:55 | 01:05:04 | 01:06:47 | 2 | 1/0 | 4,2 min | 1,7 min |
| #544 | #554 | 01:02:13 | 01:08:25 | 01:10:09 | 3 | 1/0 | 6,2 min | 1,7 min |

Cada execução do CI levou de 38 s a 60 s.

| | Onda de 5 | Onda de 2 |
| --- | ---: | ---: |
| Do 1º commit ao último merge | 31,2 min | 9,2 min |
| Minutos por PR entregue | 6,2 | 4,6 |
| Execuções de CI por PR | 3,4 | 1,0 |
| PR → merge (mediana) | 17,6 min | 1,7 min |

**[Inferência]** Com o merge serializado e todo PR caindo no módulo `root` (o fast-path do Fast Merge
Gate não se aplica), o k-ésimo PR de uma onda espera os k−1 merges anteriores, e cada merge força um
re-sync e um novo CI nos que ainda estão na fila. O tempo de entrega cresce com N, e o tempo de
desenvolvimento, que é o que o paralelismo encurta, já era de poucos minutos.

### 3.2 Limites da plataforma (documentação do Claude Code, lida em 2026-11-09)

Fonte: `https://code.claude.com/docs/en/sub-agents.md`, `…/costs.md`, `…/worktrees.md`,
`…/permissions.md`. As páginas não mostram data.

| Tema | Texto da documentação |
| --- | --- |
| Concorrência | "By default, when 20 subagents are running in a session, spawning another with the Agent tool fails with `Concurrent subagent limit reached`"; configurável por `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (v2.1.217+) |
| Permissões em segundo plano | "When a background subagent reaches a tool call that needs permission, Claude Code surfaces the prompt in your main session and names the subagent that is asking." / "Background subagents surface every permission prompt in your main session." |
| Modo de permissão | `permissionMode` é "Ignored for plugin subagents"; "If you leave it unset, the subagent inherits the main conversation's permission mode." |
| Custo | cada subagente "sends its own requests, which count toward the same usage limits as your main conversation" |
| Worktrees | "While an agent is running, Claude Code holds a `git worktree lock` on its worktree"; não há limite de quantidade |

**[Não verificado]** A documentação não diz se vários pedidos de permissão simultâneos ficam em fila,
nem em que ordem são mostrados.

### 3.3 Custo por worker

A issue registrou de 43 mil a 118 mil tokens de subagente por worker, mais 2 a 5 subagentes
auxiliares por issue. **[Não verificado]** nesta investigação: os transcripts locais de 2026-11-02 e
2026-11-03 não existem mais neste host (§3.4), então não deu para recontar.

### 3.4 O que não foi possível medir, e por quê

- **Novas rodadas com N = 1, 2, 3 e 5.** Cada rodada real despacha workers que consomem cota, abrem
  PRs de verdade e exigem um humano aprovando permissões e merges. Uma rodada sintética não reproduz a
  fila de permissões, que é justamente o que se quer medir. Fica proposta como coleta contínua (§6).
- **O episódio de ~8h30 da onda de 5.** O `duration_ms` (~30,6 milhões de ms por worker) e as 10 a 30
  tool calls vieram do retorno do `Agent()` na sessão original. Os transcripts dessa sessão não estão
  em `~/.claude/projects/` (o mais antigo é de 2026-11-05), então não dá para ver quando cada worker
  foi despachado nem quantos pedidos de permissão ficaram pendentes. Os commits só começam às
  00:23 de 03/11, o que é compatível com workers parados até o humano voltar, mas não prova a causa.

### 3.5 Mudanças desde o episódio

As três issues ligadas ao episódio foram fechadas:
- **#540:** o status file no root era recusado em worktree isolado.
- **#559:** o worker terminava sem status terminal, e o coordinator não reconciliava.
- **#562:** criou o watchdog de workers parados.

A #603 trouxe permissões mínimas para fluxos autônomos (`permissions-setup.ts`). **[Inferência]** Isso
ataca o modo de falha "worker parado sem ninguém saber", mas não a fila estrutural: com o modo
`default`, todo pedido que não está na allowlist continua indo para o único humano.

## 4. Respostas ao escopo

1. **Gargalos por etapa:** desenvolvimento de 2 a 8 min por worker; entrega (PR → merge) de 15 a
   23 min com N = 5 e 1,7 min com N = 2. O paralelismo deixa de ajudar quando a fila de merge passa a
   dominar, o que aqui já aconteceu com N = 5 (§3.1).
2. **Interação humana como recurso escasso:** confirmado pela documentação que todos os pedidos de
   permissão sobem para a sessão principal (§3.2). A contagem por worker não pôde ser medida (§3.4).
3. **Limites da plataforma:** 20 simultâneos, configurável; sem limite documentado para worktrees;
   cada subagente conta na mesma cota da sessão (§3.2).
4. **Custo:** sem recontagem possível (§3.3). **[Inferência]** Os re-syncs elevam o custo por PR com
   N: 3,4 CIs por PR com N = 5 contra 1 com N = 2, e cada re-sync também consome tokens do worker ou
   do coordinator.
5. **Sobreposição de arquivos e módulos:** com só `root` e `cli` no `module-test-map`, todo PR do
   Vetor conflita no módulo para fins de teste, e o fast-path de merge nunca se aplica. O número de
   grupos com módulos disjuntos é o paralelismo de entrega real, e neste repositório ele é 1 ou 2.

## 5. Opções avaliadas

| Opção | Avaliação |
| --- | --- |
| Manter o modelo atual, só documentando | O padrão 5 e o alerta de ~8 não têm medição; o que foi medido (fila de merge com N = 5) já contradiz o "~8" |
| **Teto calculado por sobreposição** (N = grupos com módulos disjuntos, via `check-disjoint`) | Ataca o gargalo medido: só paraleliza o que pode ser entregue em paralelo. Num repositório com um módulo só, tende a 1 ou 2 |
| Teto adaptativo (começa em 2 e sobe enquanto não houver worker parado nem pedido pendente; ligado ao watchdog da #562) | Bom para a fila de permissões, mas acrescenta estado e decisões em tempo de execução ao coordinator, que já é a skill mais longa |
| **Teto dependente do modo** (interativo × `--headless` com permissões pré-configuradas) | Barato: o interativo tem um humano como fila; o headless já suspende quem pede permissão (Fase 5.b) e não depende dela |
| Separar o teto de desenvolvimento do de subagentes auxiliares (Pre-Ship, revisão, correção) | Correto em princípio, mas os auxiliares rodam na fase de entrega, que já é serializada; o ganho é baixo |

## 6. Recomendação

**[Opinião]**

1. **`N_rec`:** passar a `min(largura da maior onda, grupos com módulos disjuntos, maxConcurrentWorkers,
   senão 3)`. O fallback cai de 5 para **3**, porque com N = 5 a entrega já dominou o tempo. O termo
   "grupos com módulos disjuntos" usa o `vetor-checks.sh check-disjoint`, que o Fast Merge Gate
   (`shared/references/fast-merge-gate.md`) já usa na entrega.
2. **Alerta:** trocar "acima de ~8 o custo cresce mais rápido que o ganho" por dois alertas medidos:
   - **fila de merge:** quando `N` passa do número de grupos com módulos disjuntos ("os PRs vão
     esperar em série e rodar o CI de novo a cada merge");
   - **fila de permissões:** quando `N > 2` em sessão interativa sem a allowlist mínima da #603
     ("cada pedido de permissão de cada worker vai para você").
3. **Modo:** em `--headless`, manter `N = N_rec`, já que a Fase 5.b suspende quem pede permissão; no
   interativo, o item 1 da entrevista continua oferecendo `N_rec` como recomendado.
4. **`maxConcurrentWorkers`** continua como override explícito do usuário, inclusive acima do
   recomendado. O teto de 20 da plataforma vale como limite superior real e pode ser citado na
   referência.
5. **Relação com #540, #559 e #562:** as três trataram o worker que para sem ninguém saber. Esta
   recomendação trata as filas que fazem um worker parar: a de permissões e a de merge.
6. **Coleta contínua:** registrar no relatório final do coordinator, por grupo, os horários de
   despacho, primeiro commit, PR e merge, e o número de execuções de CI. Isso dá, em rodadas normais e
   sem custo extra, as medições com N variado que este spike não pôde fazer.

A decisão continua humana: este spike não altera a skill nem cria issues de follow-up.
