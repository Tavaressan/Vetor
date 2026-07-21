# Status file — fonte única do formato

**Path canônico:** `<repo-root>/.claude/vetor/status/<branch com / trocada por ->.md`
(ex.: branch `fix/42-cache-ttl` → `.claude/vetor/status/fix-42-cache-ttl.md`).

Escrito pelo worker/fix-loop a cada iteração. Lido pelo `issue-coordinator` (via
`scripts/vetor-status.sh`) e pelo safety hook (que bloqueia `git push`/`gh pr *` de um worktree
enquanto `Status` ≠ `GREEN`). Fica **fora do worktree**, no root do repo — não há risco de commit
acidental; o `/vetor` init garante a entrada no `.gitignore`.

**Fallback (issue #94):** se a plataforma bloquear a escrita fora do worktree, o worker deve salvar
uma cópia em `<worktree>/.claude/vetor-status.md`. O coordinator verifica esse fallback ao ler.

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

## Efeitos colaterais externos (fora do controle de versão)

Testes locais passarem (verde) não é evidência de que uma ação que altera estado **fora do repositório**
de fato colou — ex.: `gh api` fazendo PATCH/POST em branch protection, webhooks, secrets, configurações
de repositório/organização no GitHub, ou qualquer outra chamada de API externa que muda estado remoto.

**Regra:** antes de marcar `Status: GREEN` para uma ação desse tipo, o worker deve rodar um GET (ou
comando de leitura equivalente) que confirme o novo estado imediatamente após o PATCH/POST, e incluir
o resultado bruto (ou um resumo objetivo e verificável) no `Last action` do status file.

- Se a verificação confirmar o estado esperado → prossiga para `GREEN` normalmente.
- Se a verificação falhar, for inconclusiva, ou não puder ser executada (ex.: falta de permissão) →
  marque `Status: BLOCKED_WAITING` com o motivo em `Blocked on`, nunca `GREEN` sem confirmação.

Isso evita que o `issue-coordinator` e sessões futuras confiem em um estado externo que pode nunca ter
sido aplicado ou que foi revertido silenciosamente, sem nenhum sinal de alerta no painel de status.
