#!/usr/bin/env bash
# Merge de PR com verificação do estado real (mecaniza a issue #12).
#
# Uso: vetor-merge.sh <pr-number>
# Exit: 0 = PR mergeado no remoto (mesmo que o cleanup local da branch tenha falhado);
#       3 = merge não aconteceu (conflito ou outro erro real — ver saída do gh);
#       2 = uso incorreto.

set -uo pipefail

pr="${1:?uso: vetor-merge.sh <pr-number>}"

# Sai do modo draft se necessário (não falha se o PR já está ready).
gh pr ready "$pr" 2>/dev/null || true

# Issue #325: repassa subject/body originais no squash para evitar que commits
# intermediários com Refs #N fechem issues prematuramente.
pr_title=$(gh pr view "$pr" --json title -q .title 2>/dev/null || echo "")
pr_body=$(gh pr view "$pr" --json body -q .body 2>/dev/null || echo "")
head_branch=$(gh pr view "$pr" --json headRefName -q .headRefName 2>/dev/null || echo "")

merge_args=("$pr" "--squash" "--delete-branch")
if [ -n "$pr_title" ]; then
  merge_args+=("--subject" "$pr_title")
fi
if [ -n "$pr_body" ]; then
  merge_args+=("--body" "$pr_body")
fi

if gh pr merge "${merge_args[@]}"; then
  exit 0
fi

# Exit não-zero do gh pr merge NÃO significa necessariamente que o merge remoto
# falhou: pode ser só o cleanup local da branch (ex.: "fatal: '<default>' is
# already used by worktree at ..." quando o root está na branch default com
# worktrees paralelos). Confirme o estado real antes de tratar como conflito.
state=$(gh pr view "$pr" --json state -q .state 2>/dev/null || echo "UNKNOWN")

if [ "$state" = "MERGED" ]; then
  # Issue #338: como gh pr merge abortou no cleanup local, a remoção da branch remota
  # também pode não ter acontecido. Apaga a branch remota explicitamente se ainda existir.
  if [ -n "$head_branch" ]; then
    git push origin --delete "$head_branch" 2>/dev/null || true
  fi
  echo "PR #$pr mergeado no remoto; branch remota verificada/removida."
  exit 0
fi

echo "PR #$pr NÃO foi mergeado (state=$state) — trate como conflito/erro real." >&2
exit 3
