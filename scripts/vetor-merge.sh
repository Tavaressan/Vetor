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

if gh pr merge "$pr" --squash --delete-branch; then
  exit 0
fi

# Exit não-zero do gh pr merge NÃO significa necessariamente que o merge remoto
# falhou: pode ser só o cleanup local da branch (ex.: "fatal: '<default>' is
# already used by worktree at ..." quando o root está na branch default com
# worktrees paralelos). Confirme o estado real antes de tratar como conflito.
state=$(gh pr view "$pr" --json state -q .state 2>/dev/null || echo "UNKNOWN")

if [ "$state" = "MERGED" ]; then
  echo "PR #$pr mergeado no remoto; o erro veio apenas do cleanup local da branch (benigno)."
  exit 0
fi

echo "PR #$pr NÃO foi mergeado (state=$state) — trate como conflito/erro real." >&2
exit 3
