# Status file — fonte única do formato

**Path canônico:** `<repo-root>/.claude/vetor/status/<branch com / trocada por ->.md`
(ex.: branch `fix/42-cache-ttl` → `.claude/vetor/status/fix-42-cache-ttl.md`).

Escrito pelo worker/fix-loop a cada iteração. Lido pelo `issue-coordinator` (via
`scripts/vetor-status.sh`) e pelo safety hook (que bloqueia `git push`/`gh pr *` de um worktree
enquanto `Status` ≠ `GREEN`). Fica **fora do worktree**, no root do repo — não há risco de commit
acidental; o `/vetor` init garante a entrada no `.gitignore`.

## Estrutura base (todos os estados)

```markdown
# Agent Status — <branch>
Updated: <ISO 8601>
Status: RUNNING | BLOCKED_WAITING | GREEN | FAILED_MAX_ITERATIONS
Iteration: <N>/5 (Issue #<M>)
Last action: <última ação executada>
Next: <próximo passo planejado>
```

## Blocos adicionais por estado

**`BLOCKED_WAITING`** (obrigatórios — o coordinator escala ao usuário a partir deles; sem eles a
escalação não acontece):

```markdown
Blocked on: <o que precisa — permissão, decisão técnica>
Options:
1. <opção sugerida>
2. <opção alternativa>
Recommendation: <opção recomendada e por quê>
```

**`FAILED_MAX_ITERATIONS`**: além de atualizar o status, crie `FAIL_ANALYSIS.md` no root do
worktree com o handover de falha (ver `fix-loop-agent` §4).

Iterações em `BLOCKED_WAITING` não contam contra o hard cap de 5 do fix-loop.
