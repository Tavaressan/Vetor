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
     passado pela Fase 6 (merge) — um grupo de `O_i` em `FAILED_MAX_ITERATIONS`, `BLOCKED_WAITING`
     ou `SUSPENDED` (aguardando decisão na Decision Inbox, Fase 5.b) sem resolução bloqueia a
     transição; trate como pendência a reportar, não avance a onda para não repetir o branch skew que
     motivou esta seção. Um grupo `SKIPPED (aguardando Spec)` (gate de Spec/design, Fase 2) **nunca**
     conta como pendência aqui — nunca foi despachado, então não há branch/merge dele para a próxima
     onda esperar. Um grupo `EJECTED` (ejeção graciosa, Fase 5.f) tampouco é pendência:
     `EJECTED` conta como resolvido, senão um impasse de `O_i` travaria as ondas seguintes até o timeout.
     A exceção são os **dependentes diretos** do grupo ejetado (arestas do DAG da Fase 1): o trabalho
     de que dependem nunca será mergeado, então eles ficam `SKIPPED (bloqueada por #N)` e não são
     despachados; os grupos independentes da onda seguinte seguem normalmente.
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
`BLOCKED_WAITING`, `SUSPENDED` ou `GREEN` ainda não mergeado). Se qualquer issue do grupo já aparecer em um
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
uma vez com `sonnet`; esgotadas de novo (ou se o grupo já era `sonnet`), ejete a issue (Fase 5.f do
`SKILL.md`).

⚠️ **`isolation: "worktree"` é só para dispatch inicial (worktree ainda não existe).** Se o worktree
já existe — retomada de sessão, redespacho após `BLOCKED_WAITING`, retomada de um grupo `SUSPENDED`
(Decision Inbox, Fase 5.b) ou redespacho após `FAILED_MAX_ITERATIONS`, ou
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
8. **ContextPacket (issue #496):** abra o prompt com o JSON gerado conforme a seção "ContextPacket"
   abaixo, para o worker começar pelo teste em vez de explorar o repositório.

### ContextPacket — contexto estruturado no prompt do worker

O coordinator já determinou nas Fases 1 e 2 o que o worker gastaria 3 a 6 tool calls
redescobrindo: critérios de aceite, módulo, comando de teste e arquivos prováveis. Gere o pacote
por issue Lead com o CLI (tipo e montagem em `scripts/lib/orchestrator/context-packet.ts`; o
`$REPO_ROOT` vem de `vetor-checks.sh repo-root`, nunca do `cwd` — `project-conventions.md`):

```bash
deno run -A "$SKILL_DIR/../../scripts/context-packet.ts" \
  --issue <N> --slug <slug> --branch <branch> --base "$DEFAULT_BRANCH" \
  --module-test-map "$REPO_ROOT/.claude/vetor/module-test-map.md"
```

Opcionais: `--worktree <path>`, `--conventions <texto>` e `--target-files <a,b>` (substitui os
arquivos inferidos do título e do body quando a análise da Fase 1 os conhece melhor). Sem rede,
use `--issue-json <arquivo>` no lugar de `--issue`. O CLI falha (exit 1) se o `module-test-map`
estiver ausente ou sem comando para o módulo: nesse caso monte o prompt sem o pacote e reporte,
em vez de inventar um comando de teste.

Cole a saída em um bloco `json` no início do prompt do worker:

```json
{
  "$schema": "https://vetor.dev/schemas/context-packet.v1.json",
  "issue": {
    "number": 485,
    "title": "feat(cli): adicionar comando de status em lote",
    "slug": "status-em-lote",
    "acceptanceCriteria": [
      "Retornar JSON com lista de status ativos",
      "Executar em menos de 500ms no P95"
    ]
  },
  "worktree": {
    "path": "C:/Projetos/Vetor/.claude/worktrees/status-em-lote",
    "branch": "feat/485-status-em-lote",
    "baseBranch": "main"
  },
  "context": {
    "module": "cli",
    "testCommand": "cd cli && npm test",
    "targetFiles": ["cli/status.ts", "cli/tests/status_test.ts"],
    "conventions": "Seguir as convenções do módulo; tratar exit codes explicitamente."
  }
}
```

- `worktree.path` é opcional: no primeiro dispatch com `isolation: "worktree"` o harness cria o
  worktree depois do `Agent()` e o coordinator ainda não conhece o path, então omita `--worktree`
  e o worker usa o próprio cwd. Em redispatch num worktree existente, passe o path de
  `git worktree list`. `conventions` também é opcional.
- `targetFiles` são dicas de por onde começar (paths citados entre crases no título e no body),
  não uma restrição: o worker pode tocar outros arquivos quando o teste exigir.
- `context.testCommand` é o comando headless do `module-test-map`, resolvido pelo root; ele já
  cobre o reforço do item 6 acima quando o mapa está untracked ou ignorado. Para o módulo
  `sem suíte de testes`, o valor é essa frase e o worker segue a regra de pular o módulo.
- O mesmo JSON serve nos outros transportes: no Alethe vai dentro de `tasks`, e no OpenCode dentro
  do prompt de `opencode run`.

**Como medir a redução de tool calls (critério de RF-07, não verificado):** para uma mesma issue,
conte as tool calls do worker antes do primeiro teste escrito (primeiro `Write`/`Edit` em arquivo
de teste), uma vez sem o pacote (baseline) e outra com ele; a meta da Spec é reduzir essa
contagem em pelo menos 50%. Nenhum baseline foi coletado ainda, então a meta permanece não
verificada.

### Micro-spec JIT — issue não-trivial sem Spec (issue #501)

Para cada issue sinalizada pelo gate de Spec/design (Fase 2) com a opção de micro-spec — a
`(Recommended)` do item 2 da entrevista consolidada, e sempre em `--headless` e `--goal` —, o
coordinator gera a micro-spec **no dispatch**, sem perguntar ao usuário e sem atrasar a aprovação do
plano (RF-07 da Spec `docs/specs/autonomia-continua-e-desacoplamento-interativo.md`):

1. **Sintetize com um modelo leve** (`haiku`; ou o runtime de delegação configurado em
   `delegate-to-runtime.md`, quando for um modelo `flash`), dando a ele o título, o body e os
   comentários da issue e o contrato abaixo. Prazo-alvo: 10 s. Estourou o prazo ou falhou:
   **despache sem micro-spec** (passo 5).

   ```markdown
   # Micro-spec #<N> — <título curto>

   ## Objetivo
   <uma frase com o resultado central>

   ## Critérios de aceite
   - [ ] <critério mensurável 1>
   - [ ] <critério mensurável 2>
   - [ ] <critério mensurável 3>

   ## Non-goals
   - <o que fica de fora 1>
   - <o que fica de fora 2>
   ```

   São exatamente 3 critérios de aceite e exatamente 2 non-goals, em até 60 linhas (1 página).
2. **Grave a saída com a ferramenta de escrita** (nunca por `echo` ou string de shell) em
   `<repo-root>/.claude/vetor/cache/micro-specs/<issue#>-<slug>.md`. Crie o diretório com um
   `.gitignore` de uma linha (`*`), como o `vetor-status.sh` faz com `cache/`.
   Não escreva em `docs/specs/micro/` do root: isso sujaria o checkout principal.
3. **Injete no ContextPacket** com `--micro-spec <arquivo>` no `context-packet.ts`. O CLI confere o
   formato (seções, 3 critérios, 2 non-goals, 1 página) e sai com erro se o texto do modelo não passar;
   o pacote ganha `context.microSpec = { path, content }`, com
   `path = docs/specs/micro/<issue#>-<slug>.md`.
4. **No prompt do worker**, logo depois do ContextPacket, inclua:
   > O pacote traz `context.microSpec`. Grave `content` em `path` dentro do seu worktree e faça disso
   > o primeiro commit (`docs(spec): micro-spec JIT (#<N>)`); trate-a como o escopo da issue, junto dos
   > critérios de aceite.

   Assim o arquivo `docs/specs/micro/<issue#>-<slug>.md` nasce no worktree e viaja no PR. O
   `ContextPacket` cobre só a Lead: para uma Sequential Issue sinalizada, gere a micro-spec do mesmo
   jeito e cole-a no prompt sob a respectiva issue, com a mesma instrução de gravar o arquivo.
5. **Fallback.** Sem micro-spec (prazo estourado, modelo indisponível, formato inválido), o grupo é
   despachado normalmente, a coluna "Ação" mantém `⚠️ sem Spec` e a ausência vai ao relatório. A
   micro-spec nunca bloqueia nem atrasa o dispatch.

O prazo de 10 s é uma meta de desenho: nenhuma medição foi feita. Como o `Agent()` não oferece
timeout, o coordinator mede o tempo da chamada e descarta a micro-spec de uma chamada que passar disso.

### Dispatch do ship-worker (Pre-Ship) — contrato

O `vetor:ship-worker` (`agents/ship-worker.md`) roda o `/vetor:ship --prepare` de um worktree
`GREEN`, grava `PR_STAGED` e encerra. Ele opera no worktree que já existe, então o dispatch **não**
usa `isolation: "worktree"` (o mesmo cuidado do redispatch acima). O modelo barato é escolhido
aqui, no `Agent()`, porque o frontmatter do agente é `model: inherit` (issues #337/#397):

```javascript
Agent({
  description: "Pre-Ship #<N>: <título>",
  prompt: "Path do worktree: <path>. Branch: <branch>. Issue: #<N>. Branch default: <default>. Status file: <status-file-path>.",
  subagent_type: "vetor:ship-worker",
  model: "haiku",
  run_in_background: true
})
```

O path vem de `git worktree list` (nunca do slug). Quando o `ship-worker` encerrar em `PR_STAGED`,
o `Next:` informa que as revisões consultivas (`code-review`, `security-review`) não foram
disparadas — ele não tem a tool `Agent` — e cabe ao coordinator despachá-las. Quando devolver
`BLOCKED_WAITING`, trate como qualquer bloqueio de worker (Fase 5.b). O subagente só existe em
Claude Code, Cursor e Antigravity (`agents/*.md`); em Codex e OpenCode rode o `--prepare` em uma
instância isolada do próprio runtime. Quando disparar o `ship-worker` dentro das Fases 5 e 6 é
decisão da issue #495; esta seção define apenas o contrato do despacho.

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

Quando o coordinator despachar sob o Alethe (contrato com a fonte e a data de cada limite em `delegate-to-runtime.md` §6):

1. **Uma Chamada por Grupo (`one-call-per-group`)**:
   - Cada grupo usa uma chamada `mcp__alethe__alethe_delegate` com `cwd` igual ao seu worktree isolado exclusivo. O `cwd` vale para a chamada inteira: nunca multiplexe worktrees e sempre o passe, pois sem ele o Alethe usa o próprio diretório e `isolate: true` falha. Como o `cwd` já é um worktree do Vetor, passe `isolate: false` (com `true` o Alethe cria outro worktree e uma branch `alethe/agent-job-N` para limpar depois; §6.3, regra 1).
2. **Prompt Autocontido**:
   - `tasks` contém o texto integral da Lead Issue (corpo e Acceptance Criteria), os comandos de teste mapeados e a proibição expressa de git que escreva, `gh`, rede e edição do status file no worker (§6.3, regras 3 e 4).
3. **Concorrência**:
   - Respeite o `concurrencyLimit` devolvido pelo `alethe_delegate` (§6.3, regra 2).
4. **Liberação Prévia de Recursos (`release-before-cleanup`)**:
   - Antes de qualquer remoção do worktree com `safe-remove-worktree`, é **obrigatório** chamar `mcp__alethe__alethe_release` com `{ jobIds: [id] }` (§6.3, regra 7).
