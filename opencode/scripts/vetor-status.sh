#!/usr/bin/env bash
# Tabela de monitoramento do issue-coordinator, construída de fontes externas
# (status files + git worktree list) — não de estado em memória. Rodar no root.
#
# Uso: vetor-status.sh
# Saída: tabela markdown com uma linha por status file em .claude/vetor/status/.
#        Worktree correspondente removido manualmente -> "cancelled (worktree removed)".
#        Worktree sem status file -> ⚠️ WARNING (possível falha anômala, issue #72).

set -uo pipefail

STATUS_DIR=".claude/vetor/status"

# Branch principal (main worktree) — excluída da lista de workers ativos.
default_branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")

# Branches com worktree ativo (workers), sanitizadas com a mesma convenção dos status files (/ -> -).
# Exclui a branch principal do repositório.
active=$(git worktree list --porcelain | sed -n 's#^branch refs/heads/##p' | tr '/' '-' | grep -v "^${default_branch}$")

# Busca a lista de PRs abertos ou mergeados via gh CLI (uma única chamada para otimizar).
# Mapeia headRefName (sanitizado / -> -) para number e state.
prs=$(gh pr list --state all --json headRefName,number,state -q '.[] | "\(.headRefName | gsub("/"; "-"))=\(.number)=\(.state)"' 2>/dev/null || echo "")

echo "## Status — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

if [ ! -d "$STATUS_DIR" ] || ! ls "$STATUS_DIR"/*.md >/dev/null 2>&1; then
  # Sem status files — verificar se há worktrees ativos sem status (falha anômala)
  if [ -n "$active" ]; then
    echo "⚠️ **ALERTA: worktrees ativos sem status file (possível falha anômala — issue #72):**"
    echo
    echo "| Worker (branch) | Status | Worktree |"
    echo "|---|---|---|"
    while IFS= read -r branch; do
      echo "| $branch | ⚠️ SEM STATUS FILE | ativo |"
    done <<< "$active"
    echo
  else
    echo "(nenhum status file em $STATUS_DIR)"
  fi
  exit 0
fi

echo "| Worker (branch) | Status | Iteração | Última ação | Worktree |"
echo "|---|---|---|---|---|"

# Rastrear branches que já apareceram em status files (compatível com bash 3.2)
seen_branches=""

for f in "$STATUS_DIR"/*.md; do
  name=$(basename "$f" .md)
  status=$(sed -n 's/^Status: *//p' "$f" | head -1 | tr -d '\r')
  iter=$(sed -n 's/^Iteration: *//p' "$f" | head -1 | tr -d '\r')
  last=$(sed -n 's/^Last action: *//p' "$f" | head -1 | tr -d '\r')
  if printf '%s\n' "$active" | grep -qx "$name"; then
    wt="ativo"
  else
    wt="cancelled (worktree removed)"
  fi
  seen_branches="${seen_branches}${name}
"

  if [ "$status" = "GREEN" ] && [ -n "$prs" ]; then
    pr_info=$(printf '%s\n' "$prs" | grep "^${name}=" | head -1 || echo "")
    if [ -n "$pr_info" ]; then
      pr_num=$(printf '%s\n' "$pr_info" | cut -d'=' -f2)
      pr_state=$(printf '%s\n' "$pr_info" | cut -d'=' -f3)
      if [ "$pr_state" = "OPEN" ]; then
        status="GREEN (PR #${pr_num} aberta)"
      elif [ "$pr_state" = "MERGED" ]; then
        status="GREEN (já mergeado via #${pr_num})"
      fi
    fi
  fi

  echo "| $name | ${status:-?} | ${iter:--} | ${last:--} | $wt |"
done

# Detectar worktrees ativos sem nenhum status file (possível falha anômala — issue #72)
missing_status=""
while IFS= read -r branch; do
  if ! printf '%s\n' "$seen_branches" | grep -qx "$branch"; then
    missing_status="${missing_status}${branch}
"
  fi
done <<< "$active"

if [ -n "$missing_status" ]; then
  echo
  echo "⚠️ **ALERTA: worktrees ativos sem status file (possível falha anômala — issue #72):**"
  echo
  echo "| Worker (branch) | Status | Worktree |"
  echo "|---|---|---|"
  while IFS= read -r branch; do
    [ -z "$branch" ] && continue
    echo "| $branch | ⚠️ SEM STATUS FILE | ativo |"
  done <<< "$missing_status"
fi
