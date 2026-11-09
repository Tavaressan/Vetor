# Coordinator — escalação de bloqueios, circuit breaker e ejeção

> Lida sob demanda pelo `SKILL.md` do `coordinator` (na Fase 5, quando houver bloqueio, falhas repetidas ou impasse). Paths relativos
> (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório da skill
> `coordinator`, não deste arquivo.

**5.b — Escalação de bloqueios (Async Decision Inbox, issue #500)**

**A fonte de verdade da escalação é o status file.** Se um worker sinalizar bloqueio apenas por
chat, **não escale ainda**: instrua-o via `SendMessage` a gravar o `BLOCKED_WAITING` estruturado
(`Blocked on` / `Options` / `Recommendation`) primeiro, para que o estado sobreviva a um reinício.

Perguntar ao usuário e esperar a resposta com o worker segurando uma vaga trava a fila inteira
(bloqueio em cabeça de fila). Um worker em `BLOCKED_WAITING` já encerrou o turno — é um estado
terminal para o `SubagentStop` —, então o que ocupa o teto `N` é só contabilidade do coordinator.
No mesmo ciclo de monitoramento em que detectar o bloqueio, siga estes passos, sem perguntar antes:

1. **Suspenda.** O comando é local (sem rede) e atualiza duas coisas: a pendência em
   `<repo-root>/.claude/vetor/decision-inbox.json` (schema na Spec, seção Data) e o status file, que
   passa a `Status: SUSPENDED` mantendo os blocos `Blocked on` / `Options` / `Recommendation`:
   ```bash
   deno run -A "$SKILL_DIR/../../scripts/decision-inbox.ts" suspend \
     --status-file <status-file-path> --worktree <path-do-worktree> [--timeout <segundos>]
   ```
   O `--timeout` só entra no avanço otimista abaixo; sem ele a pendência espera o humano.
2. **Libere a vaga.** `SUSPENDED` não conta no teto `N`: no mesmo ciclo, despache o próximo `QUEUED`
   da onda corrente (Fase 4). O worker não é morto nem tocado — o worktree fica intacto.
3. **Notificação (não bloqueante).** O `vetor-status.sh` (5.a) lista os suspensos com um aviso 🔔 abaixo da
   tabela. Em sessão interativa, mostre cada pendência como texto junto da tabela e siga o loop:
   ```
   🔔 Decisão pendente — #<N> (<slug>): <Blocked on>
   Opções: 1. <opção> (Recommended) · 2. <opção> · 3. <opção>
   Responda `#<N> = <número da opção>` (ou texto livre) a qualquer momento.
   ```
   Use `AskUserQuestion` para a pendência só quando não houver mais nada a monitorar nem a despachar
   (nenhum worker ativo e a fila `QUEUED` da onda vazia): aí perguntar não congela ninguém. Para um
   bloqueio de **permissão** (`<comando>`) as opções são: permitir esta vez / permitir para este
   agente (auto-aprova chamadas similares dele) / negar (registra "skipped", aplicando label de
   bloqueio existente no repo conforme a Fase 1, sem nunca criar labels) / parar agente.
4. **Retome quando a decisão chegar.** Resolva a pendência — o comando remove-a da inbox e deixa o
   status file em `RUNNING` com a decisão registrada:
   ```bash
   deno run -A "$SKILL_DIR/../../scripts/decision-inbox.ts" resolve --id dec-issue-<N> --option <n>
   ```
   Nunca interpole texto do usuário na linha de comando: a escolha de uma opção usa `--option <n>`
   (1 = primeira) e texto livre vai num arquivo gravado com a ferramenta de escrita, passado em
   `--decision-file <path>`. Depois redespache o grupo **no worktree existente**, pela nota de
   redispatch da Fase 4: subagente padrão **sem `subagent_type`** (nunca `vetor:issue-worker`, que
   força worktree novo), com a skill `fix`, um `cd` para o path real do worktree (`git worktree list`),
   o status file e a decisão no prompt, continuando da `Iteration: N/5` registrada. Se o worker
   original ainda for endereçável, `SendMessage` com a decisão é um atalho equivalente. O grupo
   retomado volta a ocupar uma vaga do teto `N` e tem prioridade sobre os `QUEUED` da mesma onda,
   mas não interrompe workers ativos: se não há vaga, espera a próxima que abrir.

**Avanço otimista (opcional, RF-04).** Desligado por padrão. Ligue com
`"optimisticDecisionSeconds": 60` em `.claude/vetor/config.json` (lido a partir do root). Ligado, e
**só para bloqueio de decisão técnica — nunca permissão: nenhuma permissão é auto-aprovada, nem pelo
temporizador** —, suspenda com `--timeout <segundos>` e acrescente à notificação, literalmente:
"Avançando automaticamente com a opção (Recommended) em 60s na ausência de resposta". A
`AskUserQuestion` não tem timeout, então o prazo é avaliado a cada ciclo de monitoramento (≤ 45 s, o
mesmo ritmo da 5.e): rode `decision-inbox.ts list` e, para cada pendência com `expired: true`:

```bash
deno run -A "$SKILL_DIR/../../scripts/decision-inbox.ts" resolve --id dec-issue-<N> --optimistic
```

O comando cria antes a tag anotada e **local** `_vetor_checkpoint_<branch>_<timestamp>` na ponta da
branch do worker (ponto de restauração; nada é publicado), grava `[OPTIMISTIC_DECISION]` no status
file e aplica a opção `(Recommended)` do worker. Se a tag falhar, nada é resolvido e a pendência segue
aguardando o humano. Registre id, opção e tag na lista de decisões autônomas do relatório (RNF-03).
Uma resposta humana que chegue antes do prazo tem precedência. Como a avaliação é por ciclo, o avanço
ocorre entre 60 s e o ciclo seguinte, não exatamente aos 60 s.

**Se o `decision-inbox.json` for apagado ou corrompido**, `list` e `resolve` o recriam a partir dos
status files `SUSPENDED` (que guardam `Blocked on`, `Options`, `Suspended at`, `Worktree` e `Timeout`).

**Em `--headless`: não escale e não decida.** Suspenda (`SUSPENDED`, sem `--timeout`) e libere a vaga
igualmente.
Registre no relatório final o agente (`<slug>` / Issue `#<N>`), o motivo do bloqueio e a recomendação
do worker; a pendência fica na inbox para um humano. Se a issue for mantida bloqueada ou retirada da
leva, aplique a label de bloqueio equivalente se já existir no repositório (`blocked` ->
`status/blocked`; nunca execute `gh label create` — ver tabela de mapeamento da Fase 1). Não conceda
permissão, não escolha opção técnica e não redespache. Liberar a vaga não mata nem toca o worker: ele
já encerrou o turno e o worktree fica intacto.

Um grupo `SUSPENDED` sem resolução **não conta como concluído** para a transição de onda
(`../shared/references/issue-coordinator-dispatch.md`): trate-o como pendência a reportar.

**5.c — Circuit Breaker**

Se 2 ou mais agentes falharem com `FAILED_MAX_ITERATIONS` apresentando assinaturas de erro idênticas
(ex.: falha de rede do gerenciador de pacotes, erro de linkagem global), acione o circuit breaker:
pause os subagentes ativos e pergunte:
`⚠️ Circuit Breaker acionado devido a falhas recorrentes com erro similar. Deseja pausar para investigar ou prosseguir mesmo assim?`

**Em `--headless`: não pergunte — sempre pause.** Pare de despachar `QUEUED`, deixe os ativos
terminarem e vá para o relatório destacando a assinatura de erro comum.

**5.f — Ejeção graciosa de impasses (issue #501)**

Uma issue que não vai convergir sozinha não pode segurar a leva inteira. O coordinator a **ejeta**:
documenta o impasse na própria issue, etiqueta se for possível, limpa o worktree e segue para a
próxima issue (RF-05 da Spec `docs/specs/autonomia-continua-e-desacoplamento-interativo.md`).

**Gatilhos:**
- **`FAILED_MAX_ITERATIONS` definitivo:** depois do único redespacho com `sonnet`
  (`issue-coordinator-dispatch.md`), ou direto se o grupo já era `sonnet`. Com o circuit breaker
  acionado (5.c) não ejete os grupos que falharam com a assinatura comum: o impasse é de
  infraestrutura, não da issue, e eles ficam em `FAILED_MAX_ITERATIONS` no relatório.
- **Timeout de bloqueio:** uma pendência `SUSPENDED` (5.b) que não pode mais ser respondida nesta
  sessão. Em `--goal` isso vale quando não resta nada a despachar ou monitorar além de suspensos, ou
  ao atingir `maxSessionMinutes`. Fora do `--goal` a pendência continua `SUSPENDED` na inbox, para um
  humano responder depois (`--resume`): não é ejetada.

**Passos.** Cada falha vai ao relatório e nunca interrompe a ejeção nem a sessão:
1. **Preserve o trabalho.** Dentro do worktree: `git add -u`, mais `git add FAIL_ANALYSIS.md` se
   o arquivo existir (o `fix` o deixa fora do controle de versão e o `safe-remove-worktree` recusaria o
   worktree sujo), e um commit `chore: preserva diagnóstico da ejeção (#<N>)`. O diagnóstico passa a
   viajar com a branch. Qualquer outro arquivo não rastreado deixa o worktree sujo de propósito: a
   limpeza do passo 5 o preserva e o relatório avisa.
2. **Comente o diagnóstico.** O script monta o texto (resumo das tentativas, comando de teste, trecho
   do log final e próximo passo), tira paths absolutos locais e neutraliza menções `@usuario`; a
   publicação passa por stdin, sem escapes de shell:
   ```bash
   deno run -A "$SKILL_DIR/../../scripts/eject-comment.ts" --issue <N> --branch <branch> \
     --base "$DEFAULT_BRANCH" --kind <failed-max-iterations|blocked-timeout> \
     --fail-analysis <path-do-worktree>/FAIL_ANALYSIS.md --worktree <path-do-worktree> \
     | gh issue comment <N> --body-file -
   ```
   No `blocked-timeout` troque `--fail-analysis` por `--status-file <status-file-path>`.
3. **Etiquete**, só se a label já existir no repositório (tabela da Fase 1; o coordinator nunca
   executa `gh label create`):
   ```bash
   gh issue edit <N> --add-label "needs-human"
   ```
   Sem a label, o motivo fica no comentário e relatório; falha ao aplicá-la também vai ao relatório.
4. **Tire a pendência da inbox**, se a ejeção veio de um `SUSPENDED`:
   `deno run -A "$SKILL_DIR/../../scripts/decision-inbox.ts" drop --id dec-issue-<N>`.
5. **Limpe o worktree** a partir do root (com o orquestrador Alethe, `alethe_release` antes):
   `bash "$SKILL_DIR/../../scripts/vetor-checks.sh" safe-remove-worktree <path-do-worktree>`. Se
   recusar (arquivo não rastreado, worktree filho), o worktree fica preservado e o relatório diz por quê.
6. **Registre.** `Status: EJECTED` no status file (com `Last action` apontando o comentário e a
   label), a linha `EJECTED` no relatório e, em `--goal`, a entrada no registro de decisões
   autônomas. Libere a vaga e despache o próximo `QUEUED` (Fase 4). `EJECTED` conta como resolvido
   para a transição de onda; os dependentes diretos do grupo viram
   `SKIPPED (bloqueada por #N)` (`issue-coordinator-dispatch.md`).

**A branch nunca é apagada**, nem a local nem a remota: é onde o trabalho fica para a análise
humana. Workers não fazem push, então ela costuma existir só localmente; o comentário informa isso e
traz o comando para publicá-la. O coordinator não faz push automático (é um efeito externo), e a limpeza
do worktree não depende de a branch estar no remoto.
