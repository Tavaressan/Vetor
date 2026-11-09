# Coordinator — entrega de PRs sem worktree local

> Lida sob demanda pelo `SKILL.md` do `coordinator` (quando a Fase 1 pula issue por PR já aberto). Paths relativos
> (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório da skill
> `coordinator`, não deste arquivo.

### Entrega de PRs sem worktree local

Issue pulada por "PR já aberto" cuja branch não tem worktree local nem status file ativo é um PR
órfão: foi preparado em outra máquina, numa sessão interrompida ou o worktree já
foi limpo (issue #527). Não termine só com "PR já aberto": liste cada um na tabela com estado de CI,
`mergeable`, draft e idade.

Detecção concreta: cruze os PRs abertos com os worktrees e status files existentes.

```bash
gh pr list --state open --json number,headRefName,isDraft,mergeable,statusCheckRollup,createdAt
git worktree list --porcelain | sed -n 's|^branch refs/heads/||p'   # branches com worktree
ls .claude/vetor/status/                                              # status files (branch com / -> -)
```

É órfão o PR cujo `headRefName` não aparece nas branches com worktree (em qualquer path) nem tem
status file ativo (`RUNNING`, `GREEN`, `PR_STAGED`, `BLOCKED_WAITING`).

- Na sessão interativa, ofereça a entrega pela Fase 6 (`AskUserQuestion`, junto da entrevista
  consolidada); sem aceite, deixe os PRs só listados.
- Em `--headless`/`--goal`, só entregue com `--auto-ship` ou `autoShipHeadless: true`, e cada PR passa
  nos quatro gates da 6.d (`vetor-checks.sh auto-ship-gates`); sem o opt-in, apenas liste no relatório.
  Um PR em draft vira `ready` pelo `--finalize` somente depois dos gates.
- Antes do `--finalize`, recrie o worktree a partir da branch remota do PR com o primitivo
  `worktree-create --from-branch <headRefName>` (nunca apague branch à força nem faça reset destrutivo)
  e entre nele. A validação de `headRefName` (check-ref-format, regex, recusa de PR de fork via
  `isCrossRepository`) é do `worktree-create` §4.a; não monte comandos `git` com ele por fora. O `/vetor:ship --finalize` também faz isso sozinho quando o worktree não existe.
- Esses PRs entram no mapa de sobreposições do Fast Merge Gate da Fase 6.c
  (`../shared/references/fast-merge-gate.md`), junto dos PRs da onda.
