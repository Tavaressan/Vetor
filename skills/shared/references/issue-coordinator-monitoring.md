# Issue-coordinator — monitoramento de status

> Extraído de `skills/coordinator/SKILL.md` (issue #373) e lido só quando o SKILL.md manda.
> Paths relativos (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório
> da skill `coordinator`, não deste arquivo.

**5.a — Tabela de status**

```bash
bash "$SKILL_DIR/../../scripts/vetor-status.sh"
```

O script lê `.claude/vetor/status/*.md`, cruza com `git worktree list` (worktree removido
manualmente → `cancelled (worktree removed)`; recém-despachado → `aguardando worktree`, issue #347)
e com `gh pr list --state all`, e imprime a tabela. O script resolve o root do repositório
automaticamente, podendo rodar no root ou dentro de qualquer worktree sem falso alarme (issue #339).
Reproduza-a no chat acrescentando os grupos `QUEUED`, e adicione a coluna `Onda` (Fase 1)
a cada linha — o script não conhece o DAG, então essa coluna vem do plano da Fase 2 mantido em
memória pelo coordinator. Grupos `QUEUED` de uma onda posterior aparecem como
`QUEUED (aguardando O_i)` para deixar explícita a razão de não terem sido despachados mesmo havendo
vaga no teto `N`.

⚠️ **Fallback de leitura.** Se o status file no path absoluto não existir ou estiver desatualizado
para um worktree ativo, leia `<path-do-worktree>/.claude/vetor-status.md` (path via
`git worktree list`).

⚠️ **Workers duplicados.** Extraia o número de issue de cada `Iteration: N/5 (Issue #<M>)` dos status
files ativos e cruze-os. Se a mesma issue aparecer em mais de um worktree ativo, sinalize:
`⚠️ Issue #<M> em andamento simultaneamente em <slug-A> e <slug-B> — possível dispatch duplicado` e
avalie com o usuário qual worker continua.


---

**5.d — Monitoramento sob o orquestrador MCP (Alethe)**

Quando um grupo foi despachado via `mcp__alethe__alethe_delegate` (contrato com fonte e data em `delegate-to-runtime.md` §6):

1. **Loop de polling seguro**: chame `mcp__alethe__alethe_check` com `wait: true` e `timeoutMs <= 50000`, repetindo entre iterações; esperas de 90 s ou mais estouraram o timeout MCP (§6.3, regra 6). O `alethe_check` é global à sessão e entrega cada resultado uma única vez: guarde as entregas de outros jobs.
2. Ao receber `worker_done` de um job:
   - Com `outcome` diferente de `succeeded`, ou com `text` vazio, trate como falha: o Alethe devolve `succeeded` com `text` vazio quando o Codex atinge o limite de uso (§6.3, regra 9).
   - Revise o diff e execute a varredura de rascunhos (§6.3, regra 8).
   - Execute a validação soberana da suíte de testes no host principal (`deno task test`, etc.).
   - Se os testes passarem e a varredura estiver limpa, atualize o status file para `GREEN`.
3. **Liberação obrigatória**: chame `mcp__alethe__alethe_release` antes de qualquer invocação de `safe-remove-worktree`.

---

**5.e — CI agregado dos PRs preparados (issue #494)**

Depois do Pre-Ship paralelo (Fase 6.a), acompanhe o CI de **todos** os PRs preparados com **uma única
consulta**, nunca com um `gh pr checks <PR> --watch` por PR (cada um bloqueia e o total vira N × T_ci):

```bash
gh pr list --state open --json number,headRefName,isDraft,mergeable,statusCheckRollup
```

Cruze `headRefName` com a branch dos grupos em `PR_STAGED` (status file / `vetor-status.sh`) e
classifique cada PR pelo `statusCheckRollup`:

| Condição no `statusCheckRollup` | Estado do PR | Ação |
|---|---|---|
| lista vazia, ou algum `CheckRun` com `status` diferente de `COMPLETED` (ou `StatusContext` com `state` `PENDING`/`EXPECTED`) | pendente | aguarde a próxima consulta |
| todos os itens concluídos com `conclusion` em `SUCCESS`, `NEUTRAL` ou `SKIPPED` (ou `StatusContext` `SUCCESS`) | verde | elegível ao merge (Fase 6.c) |
| algum item com `conclusion` em `FAILURE`, `CANCELLED`, `TIMED_OUT`, `ACTION_REQUIRED` ou `STARTUP_FAILURE` (ou `StatusContext` `FAILURE`/`ERROR`) | vermelho | trate no `--finalize` do PR (loop de fix do ship §8, máximo 3) ou, havendo falha de infraestrutura, no circuit breaker do ship §8.a |

- **Intervalo entre consultas:** no máximo 45 s por espera (teto de polling de 50 s, RNF-04 da Spec).
  Entre uma consulta e a seguinte, atualize a tabela de status e processe os PRs que já ficaram verdes —
  não pare tudo para esperar o último CI.
- **Uma consulta por ciclo, não por PR.** O custo da espera é o do CI mais lento mais o intervalo de
  consulta: converge para max(T_ci) + 60 s em vez de somar os CIs.
- **`mergeable`** vem na mesma resposta, mas é o valor de agora: o Fast Merge Gate o consulta de novo
  imediatamente antes de cada merge (`fast-merge-gate.md`), porque ele muda a cada merge da onda.
- Se o `gh` falhar (rede, HTTP 5xx), repita a consulta com backoff de 2 s, 4 s e 8 s (até 3 vezes,
  edge case de dependência indisponível da Spec) antes de classificar como falha transitória de
  infraestrutura; nesse caso não consuma tentativas de fix.
