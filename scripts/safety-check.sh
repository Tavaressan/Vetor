#!/bin/bash
# Safety gate do Vetor — versão Antigravity (chamado pelo hooks.json da raiz,
# matcher run_command). Recebe o comando como argumentos.
#
# O Claude Code usa scripts/safety-check.ts (Deno), que espelha esta política.
# Mantenha as duas em sincronia ao alterar as regras.
#
# Recebe o comando como argumentos. Exit 1 = violação (o adaptador traduz para
# exit 2, que é o código de bloqueio do Claude Code).

COMMAND="$@"

# 1. Bloqueia git push para branches protegidas
if [[ "$COMMAND" =~ "git push" ]]; then
  # Extract the git push command (before any && or ||)
  push_cmd=$(echo "$COMMAND" | sed 's/^\(.*git push[^&|]*\).*/\1/' | xargs)

  # Extract the destination branch from the git push command
  # Pattern: git push [options] [remote] <branch>
  # Handles: git push origin branch / origin branch:remote / --force origin branch
  dest_branch=$(echo "$push_cmd" | grep -oE '[^ ]+(:[^ ]+)?$' | sed 's/:.*$//')

  if [[ "$dest_branch" == "main" ]] || [[ "$dest_branch" == "master" ]] || [[ "$dest_branch" == "production" ]]; then
    echo "ERROR: Push to protected branches (main, master, production) is prohibited by Vetor Safety Hook." >&2
    exit 1
  fi
fi

# 2. Bloqueia push/PR de um worker não-GREEN, executado de dentro de um worktree linkado.
#    Convenção: status file em <root>/.claude/vetor/status/<branch com / trocada por ->.md
#    (ver skills/shared/references/agent-status.template.md). Sem status file para a
#    branch atual, passa — não afeta uso manual fora do fluxo do coordinator.
ship_re='git push|gh pr (create|ready|merge)'
if [[ "$COMMAND" =~ $ship_re ]]; then
  git_dir=$(git rev-parse --git-dir 2>/dev/null)
  common_dir=$(git rev-parse --git-common-dir 2>/dev/null)
  if [ -n "$git_dir" ] && [ "$git_dir" != "$common_dir" ]; then
    branch=$(git branch --show-current 2>/dev/null)
    root=$(cd "$(dirname "$common_dir")" 2>/dev/null && pwd)
    status_file="$root/.claude/vetor/status/${branch//\//-}.md"
    if [ -n "$branch" ] && [ -n "$root" ] && [ -f "$status_file" ]; then
      status=$(sed -n 's/^Status: *//p' "$status_file" | head -1)
      if [ "$status" != "GREEN" ]; then
        echo "ERROR: worker não-GREEN (Status: ${status:-desconhecido}) — push/PR bloqueado pelo Vetor Safety Hook." >&2
        echo "Registre BLOCKED_WAITING no status file se precisar de intervenção; o worktree-ship faz a entrega após GREEN." >&2
        exit 1
      fi
    fi
  fi
fi

exit 0
