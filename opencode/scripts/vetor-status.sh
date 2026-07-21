#!/usr/bin/env bash
# Tabela de monitoramento do issue-coordinator, construída de fontes externas
# (status files + git worktree list) — não de estado em memória. Rodar no root.
#
# Uso: vetor-status.sh
# Saída: tabela markdown com uma linha por status file em .claude/vetor/status/.
#        Worktree correspondente removido manualmente -> "cancelled (worktree removed)".

set -uo pipefail

STATUS_DIR=".claude/vetor/status"

if [ ! -d "$STATUS_DIR" ] || ! ls "$STATUS_DIR"/*.md >/dev/null 2>&1; then
  echo "(nenhum status file em $STATUS_DIR)"
  exit 0
fi

# Branches com worktree ativo, sanitizadas com a mesma convenção dos status files (/ -> -).
active=$(git worktree list --porcelain | sed -n 's#^branch refs/heads/##p' | tr '/' '-')

echo "## Status — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo
echo "| Worker (branch) | Status | Iteração | Última ação | Worktree |"
echo "|---|---|---|---|---|"

for f in "$STATUS_DIR"/*.md; do
  name=$(basename "$f" .md)
  status=$(sed -n 's/^Status: *//p' "$f" | head -1)
  iter=$(sed -n 's/^Iteration: *//p' "$f" | head -1)
  last=$(sed -n 's/^Last action: *//p' "$f" | head -1)
  if printf '%s\n' "$active" | grep -qx "$name"; then
    wt="ativo"
  else
    wt="cancelled (worktree removed)"
  fi
  echo "| $name | ${status:-?} | ${iter:--} | ${last:--} | $wt |"
done
