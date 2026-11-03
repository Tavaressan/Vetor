```json
{
  "$schema": "https://vetor.dev/schemas/context-packet.v1.json",
  "issue": {
    "number": 10,
    "title": "feat: algo",
    "slug": "algo",
    "acceptanceCriteria": [
      "critério um",
      "critério dois"
    ]
  },
  "worktree": {
    "branch": "feat/10-algo",
    "baseBranch": "master"
  },
  "context": {
    "module": "root",
    "testCommand": "deno task test",
    "targetFiles": [
      "scripts/a.ts"
    ]
  }
}
```

### Lead Issue: #10 — feat: algo

Descrição.

- [ ] critério um
- [ ] critério dois

Mexe em `scripts/a.ts`.

### Issue Sequencial: #11 — fix: depois

Segue a #10.

## Branch e commits

Crie a branch `feat/10-algo` como primeiro passo no worktree (`git checkout -b feat/10-algo`).
Base: `master`. Commits em conventional commits, com `Closes #<N>` e o trailer:

    Co-Authored-By: Claude <noreply@anthropic.com>

## Status file

Escreva o status file no path absoluto `/repo/.claude/vetor/status/feat-10-algo.md` (formato em `agent-status.template.md`),
atualizado a cada iteração de cada issue (ex.: `Iteration: 2/5 (Issue #<M>)`). Se a plataforma
rejeitar a escrita com mensagem como *"Edit the worktree copy..."* ou qualquer bloqueio de
escrita fora do worktree, salve também uma cópia em `.claude/vetor-status.md` dentro do
worktree e sinalize no chat.

## Sincronização com origin (primeiro passo, logo após o `git checkout -b`)

Antes de investigar o escopo, rode `git fetch origin master` e compare com o seu
HEAD (`git log origin/master -1` vs `git log HEAD -1`). Se o worktree nasceu de
um commit anterior aos merges das ondas anteriores, sincronize agora (`git merge origin/master` ou `git rebase origin/master`) antes de procurar arquivos.

## Comandos de teste pré-resolvidos (module-test-map indisponível no worktree)

- `root`: `deno task test`

## Validação

Siga TDD (teste de reprodução vermelho antes do código do produto) e KISS/YAGNI. Valide com o
`testCommand` do pacote (e com o comando do `module-test-map` de cada módulo tocado nas issues
sequenciais) até a suíte completa do módulo ficar verde, no orçamento de 5 iterações.

## Falhas de ambiente conhecidas (não contam como vermelho)

- testes de CLI real (issue #544)

Formate só os arquivos que você tocou; nunca rode o formatador na raiz do repositório.

Ao concluir todas as issues, marque `Status: GREEN`. Se uma falhar, pare e marque `FAILED_MAX_ITERATIONS` dizendo qual issue falhou.

## Proibições

- Nunca faça `git push`, `gh pr create`, `gh pr ready` nem `gh pr merge` (o ship faz a entrega
  depois do `GREEN`); precisando disso, grave `BLOCKED_WAITING`.
- Nunca chame `EnterPlanMode` e não crie nem remova worktrees.
