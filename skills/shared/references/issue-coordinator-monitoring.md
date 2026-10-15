# Issue-coordinator — monitoramento de status

> Extraído de `skills/issue-coordinator/SKILL.md` (issue #373) e lido só quando o SKILL.md manda.
> Paths relativos (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório
> da skill `issue-coordinator`, não deste arquivo.

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
