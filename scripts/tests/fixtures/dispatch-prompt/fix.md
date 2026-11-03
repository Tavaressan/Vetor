Entre no diretório /wt/algo (`cd` explícito em todo comando Bash) e retome o trabalho da branch `feat/10-algo` usando a skill `fix`.

### Lead Issue: #10 — feat: algo

Descrição.

- [ ] critério um
- [ ] critério dois

Mexe em `scripts/a.ts`.

Motivo do redispatch: BLOCKED_WAITING resolvido: usar a opção A

## Status file

Escreva o status file no path absoluto `/repo/.claude/vetor/status/feat-10-algo.md` (formato em `agent-status.template.md`),
atualizado a cada iteração de cada issue (ex.: `Iteration: 2/5 (Issue #<M>)`). Se a plataforma
rejeitar a escrita com mensagem como *"Edit the worktree copy..."* ou qualquer bloqueio de
escrita fora do worktree, salve também uma cópia em `.claude/vetor-status.md` dentro do
worktree e sinalize no chat.

Commits em conventional commits com o trailer `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Falhas de ambiente conhecidas (não contam como vermelho)

- testes de CLI real (issue #544)

Formate só os arquivos que você tocou; nunca rode o formatador na raiz do repositório.

## Proibições

- Nunca faça `git push`, `gh pr create`, `gh pr ready` nem `gh pr merge` (o ship faz a entrega
  depois do `GREEN`); precisando disso, grave `BLOCKED_WAITING`.
- Nunca chame `EnterPlanMode` e não crie nem remova worktrees.
