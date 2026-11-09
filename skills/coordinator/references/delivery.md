# Coordinator — Fase 6: Pre-Ship, CI e merge

> Lida sob demanda pelo `SKILL.md` do `coordinator` (ao primeiro grupo `GREEN`). Paths relativos
> (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório da skill
> `coordinator`, não deste arquivo.

**6.a — Pre-Ship paralelo.** Quando um agente atingir `GREEN` (confirme lendo o status
file), dispare o Pre-Ship de **todos os grupos verdes ainda não preparados**, sem esperar os demais
workers nem o CI de nenhum:

1. Para cada grupo, obtenha o path real do worktree (`git worktree list`, correlacionando pela
   branch da Fase 3). O `/vetor:ship` aborta se o `cwd` não for um worktree.
1.b. **Revisão local antes do push.** Antes do `prepare` (que faz o push), despache o
   `vetor:code-review` em **modo local** para cada grupo, todos na mesma mensagem e em background:
   `Agent({ subagent_type: "vetor:code-review", model: "sonnet", prompt: "Modo local: worktree <path-do-worktree>, branch <branch>, base $DEFAULT_BRANCH. Sem PR aberto; devolva os achados ao coordinator." })`.
   **Ordem por grupo:** um grupo só vai ao `prepare` depois que a revisão do **HEAD atual** do worktree
   voltou limpa (sem `blocker` nem `warning` de confiança `alta`) ou estourou o limite de rodadas.
   Todo redespacho de worker que gerar HEAD novo (volta a `GREEN` com outro sha) exige nova revisão
   antes do `prepare`; nunca rode o `prepare` só porque o status voltou a `GREEN`.
   Trate `blocker` e `warning` de confiança `alta` antes do push: redespache o worker no mesmo
   worktree (regra da Fase 4) com os achados, espere o novo `GREEN` e revise de novo. **Limite de 2
   rodadas** revisão→fix por grupo: se a 2ª revisão ainda trouxer `blocker`/`warning` de confiança
   `alta`, registre os remanescentes no corpo e siga para o `prepare`; a decisão fica com o humano
   (revisão do PR) ou com o gate `reviews` do 6.d. `nit` e achados de confiança `média`/`baixa` não
   seguram o push e vão só para o registro. Revisão que falhar (rate limit, erro de ferramenta) não
   bloqueia o grupo: registre e siga para o `prepare`.
   **Corpo guardado:** salve o corpo da revisão da **última rodada** em
   `<repo-root>/.claude/vetor/status/<branch-sanitizada>-review.md` (branch com `/` trocado por `-`),
   iniciando com a linha `Reviewed: <sha>` do HEAD revisado. Achados corrigidos em rodadas anteriores
   entram numa seção `### Resolvidos antes do push` em **lista com marcadores, nunca em linha de
   tabela**: o gate `reviews` do 6.d conta linhas de tabela `| blocker |` do comentário e o
   `Blockers: <n>` do corpo, então um resolvido na tabela travaria o merge.
2. **Caminho determinístico primeiro, sem subagente:** para cada grupo rode
   `bash "$SKILL_DIR/../../scripts/vetor-checks.sh" prepare "<path-do-worktree>" <issue#...>` (vários
   em paralelo com `&`/`wait`, um exit por grupo). Exit 0 = `PR_STAGED` gravado; exit 1/3/5 = falha
   (validação, teste ou sync, push ou PR; tabela em `ship` §0.b) e só então o grupo vai ao subagente
   abaixo; os grupos com exit 0 não recebem subagente. Os grupos que falharam (exit 1/3/5) são os únicos
   despachados: Despache **todos na mesma mensagem**, um `Agent()` por worktree, em background. O worktree já
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

4.b. **Registro da revisão no PR.** Com `PR_STAGED` e o número do PR, publique o arquivo
   `<branch-sanitizada>-review.md` do passo 1.b como comentário
   (`gh pr comment <PR> --body-file <arquivo>`), no formato `## Code Review (Vetor)` do agente e com a
   linha `Reviewed: <sha>`. Pule o 4.b, sem publicar nada, quando: a revisão local falhou (não há corpo; o
   ship revisa o PR normalmente), ou o `prepare` saiu com exit ≠ 0 e caiu no fallback `ship-worker`
   (o ship do worker revisa por conta própria; só publique se o PR já existir e ainda não tiver um
   `## Code Review (Vetor)` com `Reviewed: <sha>` igual ao HEAD, conferindo com `gh pr view <PR> --json
   comments`). Nunca publique um segundo comentário para o mesmo sha. O arquivo é removido junto do
   status file no cleanup (`clean-status`).

**6.b — Aguardar o CI sem somar esperas.** Não use `gh pr checks --watch` por PR (cada
espera bloqueia e o total vira N × T_ci). Acompanhe todos os PRs preparados com **uma** consulta
agregada, repetida a cada ≤ 45 s enquanto houver PR pendente (`5.e` de
`../shared/references/issue-coordinator-monitoring.md`). Como os CIs correm ao mesmo tempo no GitHub e
cada PR segue para o merge assim que fecha verde, a espera total converge para max(T_ci) + 60 s.

**6.c — Merge serializado.** Um PR por vez, assim que o CI fechar verde:

1. Para cada PR `PR_STAGED`, aplique o **Fast Merge Gate**: leia
   `../shared/references/fast-merge-gate.md`. Ele compara os arquivos tocados e os módulos do PR
   (cache `<branch>-touched-files.json`) com as outras branches da onda — mapa de sobreposições feito
   antes do primeiro merge, porque o ship apaga o cache de cada PR no cleanup. Nenhum PR sobreposto
   já integrado e `mergeable == MERGEABLE`: `/vetor:ship --finalize <PR>` direto, sem re-sincronizar
   nem re-testar. Sobreposição com PR já integrado: merge da default no worktree e só a suíte do
   módulo coincidente antes do `--finalize`. Com merge queue ativa o `vetor-merge.sh` enfileira
   (exit 4).
2. Rode `bash "$SKILL_DIR/../../scripts/vetor-checks.sh" finalize <PR> <branch>`: faz o
   merge e, só com merge concluído, `sync-root` e o cleanup completo (worktree, branch, status e
   `*-preship.json`) em um comando, do root, sem subagente. Exit 0 = mergeado e limpo; 4 = enfileirado
   (nada é limpo); 3 = merge não aconteceu; 5 = mergeado com cleanup incompleto; 2 = uso ou branch
   divergente do PR. O fallback `/vetor:ship --finalize <PR>` distingue o exit: **4 e 5 nunca tentam
   novo merge** (4 = o PR já está na fila; 5 = já foi mergeado e só refaz o passo de cleanup que falhou
   — worktree, branch ou status — à mão, do root). Só em falha de merge (exit 1/2/3) entre no worktree
   do grupo (`git worktree list`; `/vetor:ship` aborta fora de um worktree) e invoque
   `/vetor:ship --finalize <PR>`. Se o grupo não tem PR preparado (Pre-Ship indisponível), rode
   `/vetor:ship --prepare <issue#>` no worktree e, com `PR_STAGED` e o CI verde, o `finalize`.
3. Após merge bem-sucedido, atualize a tabela. Um PR **enfileirado** (merge queue/auto-merge, exit 4 do
   `vetor-merge.sh`) não é merge: registre `Enfileirado`, não rode sync-root nem cleanup e siga para o
   próximo grupo sem esperar a fila. Para grupos de spike/investigação, o `/vetor:ship` segue o caminho de PR só de docs. A decisão decorrente do spike continua humana — issues de follow-up não são criadas automaticamente.

Se o `ship` falhar (CI vermelho, review required), marque na tabela e continue com os outros.

**Autorização de merge.** Antes do `finalize` de cada PR, aplique a resposta do item 3
da entrevista consolidada:

- `merges autorizados`: ao rodar o merge, cite a autorização na mesma mensagem (por exemplo,
  "merge do PR #<N> autorizado pelo usuário na aprovação do plano"), para que a camada de permissões
  do harness a encontre na conversa.
- `confirmar cada merge`: pergunte antes de cada PR, com a ferramenta de perguntas do harness ou
  no chat quando ela não existir. Recusa deixa o PR aberto e registrado como pronto para merge.

**Negação mesmo com autorização.** Se a camada de permissões negar o merge (no Claude Code, o
classificador do auto mode, motivo "Merge Without Review"; `ship` §3), não contorne a
negação nem aborte os outros grupos. Pergunte **uma única vez** na sessão, com a lista dos PRs ainda
não mergeados ("mergear todos os restantes", "um a um" ou "deixar abertos"), e siga com a resposta.
Nova negação depois do "sim" deixa aquele PR aberto, registrado como `Merge negado pelo harness`, e o
coordinator segue para o próximo grupo. Em `--headless`, não há pergunta: vale a regra do 6.d.

**6.d — Entrega autônoma em `--headless`.** Só com `--auto-ship` ou
`autoShipHeadless: true` em `.claude/vetor/config.json` (lido a partir do root do repositório), em
`--headless` ou em `--goal`. Segue 6.a–6.c, com duas diferenças: nunca há pergunta ao usuário, e **nenhum PR é mergeado sem passar nos
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
