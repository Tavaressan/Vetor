Path do worktree: /wt/algo.
Branch: feat/10-algo.
Issue: #10 — feat: algo.
Branch default: master.
Status file: /repo/.claude/vetor/status/feat-10-algo.md.

Todo comando Bash começa com `cd "/wt/algo" &&`. Rode `/vetor:ship --prepare 10`,
mantenha `Status: GREEN` enquanto trabalha e grave `PR_STAGED` ao fim (com a ferramenta Write).
Se a plataforma rejeitar a escrita fora do worktree, grave também `.claude/vetor-status.md` no worktree.
Se os testes locais ou o push falharem, deixe o worktree intacto e reporte o motivo.

## Proibições

- Nunca faça merge (`gh pr merge`, `vetor-merge.sh`, `/vetor:ship --finalize`).
- Nunca faça push para `master`; nunca use `gh pr checks --watch`.
- Não despache revisões: o coordinator as dispara a partir do PR aberto.
