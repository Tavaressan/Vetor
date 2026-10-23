# Issue-coordinator — criação, dispatch e transição de ondas

> Extraído de `skills/coordinator/SKILL.md` (issue #373) e lido só quando o SKILL.md manda.
> Paths relativos (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório
> da skill `coordinator`, não deste arquivo.

### 3 — Fase de criação (nativa e serializada)

⚠️ **Esta fase é serializada** para evitar `git index lock` ao inicializar os worktrees nativos.

A criação e a **localização** do worktree são do harness (`isolation: "worktree"` na Fase 4) — não
assuma path de worktree. O coordenador deriva apenas:
1. **Slug:** kebab-case derivado da Lead Issue (máx 30 chars).
2. **Branch:** `<type>/<issue#>-<slug>` da Lead Issue — o worker a cria como primeiro passo (`git checkout -b <branch>`). `<type>` segue a lista de `worktree-create`: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `ci`. Para issues spike, use o tipo `docs` (`docs/<issue#>-<slug>`). O transporte `--carry-changes` só vale no uso standalone, não para worktrees criados pelo harness.
3. **Status File Path (absoluto, no root do repo):**
   `<repo-root>/.claude/vetor/status/<branch com / trocada por ->.md` — fica fora do worktree;
   formato em `../shared/references/agent-status.template.md`.

Para retomada `--resume` ou dispatch de issue dependente, consulte também
`../shared/references/memory-handoffs.md`: o status file sempre reconstrói o estado; handoff é
complemento opcional identificado por issue/branch e aceito somente pelo ID exato.

⚠️ **O slug é só nominal — não é o path do worktree.** Ele serve apenas para compor o nome da branch
e o do arquivo de status. **Nunca** infira que o worktree está em `.claude/worktrees/<slug>/` ou
qualquer convenção derivada do slug: obtenha o path real via `git worktree list` (correlacionando
pela branch) ou pelo retorno do `Agent()`.

- **Checagem de timeout da sessão.** Antes de despachar um novo grupo `QUEUED` ou iniciar uma nova
  onda (`O_{i+1}`), verifique se o timeout global (default 90 minutos, ou `maxSessionMinutes` em
  `.claude/vetor/config.json`) foi atingido considerando apenas tempo ativo de coordenação (excluindo
  esperas por decisão humana via `AskUserQuestion` — issue #343). Ao atingir o teto: não despache novos
  grupos nem novas ondas; permita que workers ativos terminem suas iterações e que grupos `GREEN` já
  autorizados realizem ship normalmente.
- **Transição de onda.** Só inicie o dispatch de `O_{i+1}` depois que:
  1. Todos os grupos de `O_i` **que foram efetivamente despachados** tiverem chegado a `GREEN` e
     passado pela Fase 6 (merge) — um grupo de `O_i` em `FAILED_MAX_ITERATIONS` ou `BLOCKED_WAITING`
     sem resolução bloqueia a transição; trate como pendência a reportar, não avance a onda para não
     repetir o branch skew que motivou esta seção. Um grupo `SKIPPED (aguardando Spec)` (gate de
     Spec/design, Fase 2) **nunca** conta como pendência aqui — nunca foi despachado, então não há
     branch/merge dele para a próxima onda esperar.
  2. O branch default (`$DEFAULT_BRANCH`) estiver sincronizado com esses merges. `git fetch && git
     log origin/<default> -1` confirma que o *remoto* já tem os merges — mas não garante que o HEAD
     *local* do root os tenha: `isolation: "worktree"` cria o novo worktree a partir do HEAD local
     do root (não de `origin/$DEFAULT_BRANCH` diretamente). Complete a checagem comparando os dois
     antes do primeiro dispatch de `O_{i+1}`:
     ```bash
     git fetch origin "$DEFAULT_BRANCH"
     git rev-parse HEAD                       # HEAD local do root
     git rev-parse "origin/$DEFAULT_BRANCH"   # último commit do remoto
     ```
     Se divergirem (root atrasado), rode `bash "$SKILL_DIR/../../scripts/vetor-checks.sh" sync-root`
     e **repita a comparação acima** — `sync-root` sai com código 0 mesmo quando recusa avançar (ex.:
     mudanças locais pré-existentes não commitadas no root, alheias a este trabalho de coordenação —
     causa raiz confirmada na issue #244); não trate o exit 0 como prova de que o HEAD avançou. Se,
     mesmo após o `sync-root`, o root continuar atrasado (dirty state não resolvido ou branch não
     mesclável), **não bloqueie o dispatch por conta disso**: essa condição é exatamente o motivo do
     passo obrigatório abaixo em "Prompt de execução sequencial para o worker" — cada worker de
     `O_{i+1}` sincroniza com `origin/$DEFAULT_BRANCH` por conta própria, como primeiro passo padrão
     (não recuperação ad-hoc), então a divergência do root deixa de ser bloqueante para o dispatch.
- Se, apesar da heurística da Fase 1, um worker de uma onda posterior reportar erro de compilação por
  dependência ausente de um grupo anterior ainda não mergeado, isso é sinal de dependência não
  detectada: pause o grupo, registre no relatório e corrija o agrupamento em ondas para a próxima
  sessão.
⚠️ **Checagem de duplicidade (antes de cada dispatch).** Rode
`bash "$SKILL_DIR/../../scripts/vetor-status.sh"` e cruze as issues do grupo candidato contra as
já reportadas como em andamento (`Iteration: N/5 (Issue #<M>)`) em status files ativos (`RUNNING`,
`BLOCKED_WAITING`, ou `GREEN` ainda não mergeado). Se qualquer issue do grupo já aparecer em um
worktree ativo: alerte (`⚠️ Issue #<M> já está em andamento no worktree/branch <outra-branch> —
pulando dispatch duplicado`) e **pule** o dispatch desse grupo.

**Antes de invocar `Agent()`, o coordenador DEVE criar o status file** (path da Fase 3) com
`Status: RUNNING` — o sandbox de isolamento pode impedir o worker de criar arquivo fora do worktree.
Exemplo: `echo -e "# Agent Status - <branch>\nStatus: RUNNING\nIteration: 1/5 (Issue #<M>)" > <path>`.
Enquanto o harness inicializa o worktree, `vetor-status.sh` classifica o grupo como `aguardando worktree`
(e não como `cancelled`, issue #347).

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
`fix` no prompt e um `cd` explícito para o path real do worktree (via `git worktree list`):

```javascript
Agent({
  description: "Grupo Lead #<N>: <título> (Resumo)",
  prompt: "Entre no diretório <path> e retome o trabalho usando a skill fix...",
  model: "<haiku|sonnet>",
  run_in_background: true
})
```
⚠️ **Colisão de migrations paralelas.** Workers paralelos **dentro da mesma onda** que tocam módulos
com versionamento sequencial de arquivos (ex.: Flyway `V<N>__*.sql`) podem gerar colisões invisíveis
ao git. A rede de segurança é o merge serializado (Fase 6) somado à checagem 2.b do `ship`.
Já a colisão **entre ondas** (grupo de `O_2` sem visibilidade das migrations de `O_1`) é o problema
que as Ondas de Despacho (Fase 1) previnem estruturalmente, ao só liberar `O_2` depois do merge e
sincronismo do branch default com `O_1`.

**Nota (Antigravity):** o `issue-worker` é descoberto em Markdown nativo via `agents/issue-worker.md`
(plugin) ou `.agents/agents/issue-worker.md` (workspace, instalado por `vetor install`), com
`model: inherit` (issue #397). Como define `tools:` explicitamente, verifique `mcpServers` se um
worker precisar de MCP adicional.

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
5. **Sincronização com origin (obrigatória a partir de `O_2`).** Se este dispatch pertence a uma
   onda `O_{i+1}` posterior à primeira, inclua no prompt, como **primeiro passo padrão logo após o
   `git checkout -b`** — não como recuperação ad-hoc descoberta pelo próprio worker (issue #244):
   > Antes de investigar o escopo da issue, rode `git fetch origin $DEFAULT_BRANCH` e compare com o
   > seu HEAD (`git log origin/$DEFAULT_BRANCH -1` vs `git log HEAD -1`). Se o seu worktree nasceu
   > de um commit anterior aos merges das ondas anteriores, sincronize agora (`git merge
   > origin/$DEFAULT_BRANCH` ou `git rebase origin/$DEFAULT_BRANCH`) antes de procurar qualquer
   > arquivo — issues desta onda podem depender de arquivos criados por PRs de ondas já mergeadas.
   Isso vale mesmo que o coordinator já tenha checado a sincronia do root na Transição de onda: o
   worktree é criado a partir do HEAD local do root no momento do dispatch (`isolation: "worktree"`
   é controlado pelo harness, não pelo coordinator — não há como forçar a criação diretamente a
   partir de `origin/$DEFAULT_BRANCH`), então essa instrução no prompt do worker é a rede de
   segurança que não depende do root ter avançado a tempo.
6. **Comandos de teste pré-resolvidos (se module-test-map untracked/ignorado):** Se `git check-ignore -q .claude`
   indicar que `.claude/` está ignorado ou se `! git ls-files --error-unmatch .claude/vetor/module-test-map.md >/dev/null 2>&1`
   indicar que o mapa de testes não está commitado (issue #327), injete explicitamente os comandos de
   teste resolvidos para os módulos da issue no prompt do worker, evitando que ele fique sem referências
   de teste no worktree.
7. **Modo investigação para issues spike:** Se a issue for um `spike` (investigação/exploração para decisão futura), instrua o worker explicitamente:
   - Modo investigação: sem TDD e sem loop de testes de produto/código.
   - Entregável obrigatório: produzir `docs/investigations/<slug>.md` estruturado com Pergunta, Evidências (comandos/fontes reproduzíveis), Opções avaliadas e Recomendação.
   - Critério de `GREEN`: o arquivo de relatório existe e `git diff --check` passa sem erros.
   - O ship segue o caminho de PR só de docs (#427); a decisão continua humana e issues de follow-up não são criadas automaticamente.

### Dispatch para runtime externo (contrato mínimo de delegação)

Quando o coordinator delegar o desenvolvimento de um grupo de issues a um runtime externo de IA (Gemini/`agy`, OpenCode/`opencode`, Codex/`codex` — conforme `delegate-to-runtime.md`), é **obrigatório** seguir o contrato mínimo:

1. **Worktree próprio**:
   - Provisione um worktree isolado exclusivo para a execução do runtime externo (via `worktree-create`), nunca compartilhando o root nem o worktree de outro agente.
2. **Diff tratado como rascunho**:
   - Todo código ou alteração produzida pelo runtime delegado é tratado como rascunho não confiável.
   - O agente coordenador inspeciona o diff (`git diff`) antes de qualquer decisão de escrita ou commit.
3. **Validação pelo `module-test-map` antes do commit**:
   - Antes de realizar qualquer commit das mudanças propostas, execute os comandos de teste correspondentes aos arquivos tocados (resolvidos a partir de `.claude/vetor/module-test-map.md`).
   - Se os testes falharem ou o resultado for insatisfatório, o rascunho é descartado e o fallback inline é acionado.
4. **Status file mantido pelo coordinator**:
   - Como o processo externo não possui garantias de executar hooks do Vetor nem de formatar o `agent-status`, o próprio coordinator gerencia o ciclo de vida do status file (`<repo-root>/.claude/vetor/status/<branch>.md`).
   - O coordinator inicializa com `Status: RUNNING`, avança `Iteration: N/5` e atualiza para `GREEN` ou `FAILED_MAX_ITERATIONS` após a validação.
5. **Limpeza do worktree do runtime**:
   - Concluído o trabalho (após commit e validação) ou em caso de descarte do rascunho, o worktree temporário do runtime deve ser removido com segurança via `vetor-checks.sh safe-remove-worktree <path>`.


### Dispatch para o orquestrador MCP (Alethe)

Quando o coordinator despachar sob um orquestrador multiplexador externo (conforme `scripts/lib/orchestrator/` e `delegate-to-runtime.md` §6):

1. **Uma Chamada por Grupo (`one-call-per-group`)**:
   - Cada grupo despachado utiliza `adapter.dispatch({ prompt, cwd: worktreePath })` apontando para o seu worktree isolado exclusivo. Nunca multiplexe múltiplos worktrees em uma única chamada.
2. **Prompt Autocontido**:
   - O prompt enviado ao worker do orquestrador deve conter a descrição completa da Lead Issue, Acceptance Criteria, comandos de teste mapeados e a proibição expressa de comandos `git` e `gh` no container/worker.
3. **Liberação Prévia de Recursos (`release-before-cleanup`)**:
   - Antes de qualquer remoção do worktree com `safe-remove-worktree`, é **obrigatório** invocar `adapter.release(handle)` para fechar handles de arquivo abertos no sistema operacional.
