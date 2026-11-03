```json
{
  "$schema": "https://vetor.dev/schemas/context-packet.v1.json",
  "issue": {
    "number": 12,
    "title": "spike: investigar",
    "slug": "algo",
    "acceptanceCriteria": []
  },
  "worktree": {
    "branch": "feat/10-algo",
    "baseBranch": "master"
  },
  "context": {
    "module": "root",
    "testCommand": "deno task test",
    "targetFiles": []
  }
}
```

### Lead Issue: #12 — spike: investigar

Qual a melhor opção?

## Branch e commits

Crie a branch `docs/12-investigar` como primeiro passo no worktree (`git checkout -b docs/12-investigar`).
Base: `master`. Commits em conventional commits, com `Closes #<N>` e o trailer:

    Co-Authored-By: Claude <noreply@anthropic.com>

## Status file

Escreva o status file no path absoluto `/repo/.claude/vetor/status/feat-10-algo.md` (formato em `agent-status.template.md`),
atualizado a cada iteração de cada issue (ex.: `Iteration: 2/5 (Issue #<M>)`). Se a plataforma
rejeitar a escrita com mensagem como *"Edit the worktree copy..."* ou qualquer bloqueio de
escrita fora do worktree, salve também uma cópia em `.claude/vetor-status.md` dentro do
worktree e sinalize no chat.

## Modo investigação (spike)

- Sem TDD e sem loop de testes de produto/código.
- Entregável obrigatório: `docs/investigations/<slug>.md` com Pergunta, Evidências
  (comandos/fontes reproduzíveis), Opções avaliadas e Recomendação.
- `GREEN` quando o relatório existe e `git diff --check` passa sem erros.
- A entrega segue o PR só de docs (#427); a decisão é humana e você não cria issues de follow-up.

## Falhas de ambiente conhecidas (não contam como vermelho)

- testes de CLI real (issue #544)

Formate só os arquivos que você tocou; nunca rode o formatador na raiz do repositório.

Ao concluir todas as issues, marque `Status: GREEN`. Se uma falhar, pare e marque `FAILED_MAX_ITERATIONS` dizendo qual issue falhou.

## Proibições

- Nunca faça `git push`, `gh pr create`, `gh pr ready` nem `gh pr merge` (o ship faz a entrega
  depois do `GREEN`); precisando disso, grave `BLOCKED_WAITING`.
- Nunca chame `EnterPlanMode` e não crie nem remova worktrees.
