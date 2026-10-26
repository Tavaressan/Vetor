#!/usr/bin/env bash
# Tabela de monitoramento do coordinator, construída de fontes externas
# (status files + git worktree list) — não de estado em memória. Pode rodar no root
# ou de dentro de qualquer worktree (issue #339).
#
# Uso: vetor-status.sh
# Saída: tabela markdown com uma linha por status file em .claude/vetor/status/.
#        Worktree correspondente removido manualmente -> "cancelled (worktree removed)".
#        Worktree recém-despachado -> "aguardando worktree" (issue #347).
#        Worktree sem status file -> ⚠️ WARNING (possível falha anômala, issue #72).
#
# Latência (issue #515):
#  - Todo git roda com --no-optional-locks, para não disputar o index.lock com workers em paralelo.
#  - O gh só é chamado se algum status file está GREEN ou PR_STAGED, e a listagem fica em cache de
#    PR_CACHE_TTL segundos em <root>/.claude/vetor/cache/pr-list-cache.txt (nunca versionado: o
#    diretório se auto-ignora). Consequência: a anotação "(já mergeado via #N)" pode atrasar até
#    PR_CACHE_TTL segundos depois do merge; é só exibição — vetor-merge.sh consulta o gh direto.

set -uo pipefail

# TTL do cache da listagem de PRs, em segundos.
PR_CACHE_TTL=15

# Resolve o root do repositório principal (suporta execução de dentro de worktrees — issue #339)
# Usa --no-optional-locks para evitar atritos de index.lock com subagentes paralelos
REPO_ROOT=$(git --no-optional-locks worktree list --porcelain 2>/dev/null | head -1 | sed 's/^worktree //')
if [ -z "$REPO_ROOT" ]; then
  REPO_ROOT=$(git --no-optional-locks rev-parse --show-toplevel 2>/dev/null || echo ".")
fi

STATUS_DIR="${REPO_ROOT}/.claude/vetor/status"

# Branch principal (main worktree) — excluída da lista de workers ativos.
default_branch=$(git --no-optional-locks worktree list --porcelain 2>/dev/null | sed -n '3s#^branch refs/heads/##p')
if [ -z "$default_branch" ]; then
  default_branch=$(git --no-optional-locks symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || git --no-optional-locks symbolic-ref --short HEAD 2>/dev/null || echo "")
fi

# Branches com worktree ativo (workers), sanitizadas com a mesma convenção dos status files (/ -> -).
# Exclui a branch principal do repositório.
active=$(git --no-optional-locks worktree list --porcelain 2>/dev/null | sed -n 's#^branch refs/heads/##p' | tr '/' '-' | grep -v "^${default_branch}$")

# Lista de PRs (headRefName=número=estado) via gh CLI. Só serve para anotar status file
# GREEN/PR_STAGED, então sem nenhum deles o gh nem é chamado (issue #515: durante a fase de código
# a chamada de rede era latência pura).
prs=""
if [ -d "$STATUS_DIR" ] && grep -Eq '^Status: *(GREEN|PR_STAGED)' "$STATUS_DIR"/*.md 2>/dev/null; then
  cache_dir="${REPO_ROOT}/.claude/vetor/cache"
  cache_file="${cache_dir}/pr-list-cache.txt"
  now_epoch=$(date +%s 2>/dev/null || echo 0)
  use_cache=0

  if [ -f "$cache_file" ]; then
    # GNU stat (Linux, Git Bash) aceita -c %Y; o stat BSD (macOS) só -f %m.
    cache_mtime=$(stat -c %Y "$cache_file" 2>/dev/null || stat -f %m "$cache_file" 2>/dev/null || echo 0)
    case "$cache_mtime" in '' | *[!0-9]*) cache_mtime=0 ;; esac
    cache_age=$((now_epoch - cache_mtime))
    if [ "$cache_age" -ge 0 ] && [ "$cache_age" -lt "$PR_CACHE_TTL" ]; then
      use_cache=1
    fi
  fi

  if [ "$use_cache" -eq 1 ]; then
    prs=$(cat "$cache_file" 2>/dev/null || echo "")
  else
    prs=$(gh pr list --state all --json headRefName,number,state -q '.[] | "\(.headRefName | gsub("/"; "-"))=\(.number)=\(.state)"' 2>/dev/null || echo "")
    if [ -n "$prs" ] && mkdir -p "$cache_dir" 2>/dev/null; then
      # Diretório que se auto-ignora: o .gitignore do projeto-alvo pode não cobrir .claude/vetor/cache/.
      [ -f "$cache_dir/.gitignore" ] || printf '*\n' > "$cache_dir/.gitignore" 2>/dev/null || true
      printf '%s\n' "$prs" > "$cache_file" 2>/dev/null || true
    fi
  fi
fi

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
# Decision Inbox (issue #500): workers SUSPENDED, uma linha "- <branch>: <Blocked on>" cada.
suspended=""

for f in "$STATUS_DIR"/*.md; do
  name=$(basename "$f" .md)
  status=$(sed -n 's/^Status: *//p' "$f" | head -1 | tr -d '\r')
  iter=$(sed -n 's/^Iteration: *//p' "$f" | head -1 | tr -d '\r')
  last=$(sed -n 's/^Last action: *//p' "$f" | head -1 | tr -d '\r')

  # Issue #156: o orçamento de 5 iterações não é enforced por hook — destaca na tabela quando o
  # agente estourou (N > 5), sinal de que deveria ter registrado BLOCKED_WAITING/FAILED_MAX_ITERATIONS
  # em vez de continuar sozinho.
  iter_n=$(printf '%s' "$iter" | sed -n 's#^\([0-9][0-9]*\)/.*#\1#p')
  if [ -n "$iter_n" ] && [ "$iter_n" -gt 5 ]; then
    iter="⚠️ ${iter}"
  fi
  if printf '%s\n' "$active" | grep -qx "$name"; then
    wt="ativo"
  else
    # Issue #347: status recém-criado pelo coordinator antes do harness criar o worktree
    if [ "$status" = "RUNNING" ] && { [ -z "$iter_n" ] || [ "$iter_n" -le 1 ]; }; then
      wt="aguardando worktree"
    elif [ "$status" = "EJECTED" ]; then
      # Issue #501: a ejeção graciosa limpa o worktree de propósito; a branch é preservada.
      wt="ejetado (worktree removido; branch preservada)"
    else
      wt="cancelled (worktree removed)"
    fi
  fi
  seen_branches="${seen_branches}${name}
"

  if [ "$status" = "SUSPENDED" ]; then
    blocked_on=$(sed -n 's/^Blocked on: *//p' "$f" | head -1 | tr -d '\r')
    suspended="${suspended}- ${name}: ${blocked_on:-?}
"
  fi

  if { [ "$status" = "GREEN" ] || [ "$status" = "PR_STAGED" ]; } && [ -n "$prs" ]; then
    pr_info=$(printf '%s\n' "$prs" | grep "^${name}=" | head -1 || echo "")
    if [ -n "$pr_info" ]; then
      pr_num=$(printf '%s\n' "$pr_info" | cut -d'=' -f2)
      pr_state=$(printf '%s\n' "$pr_info" | cut -d'=' -f3)
      if [ "$pr_state" = "OPEN" ]; then
        status="${status} (PR #${pr_num} aberta)"
      elif [ "$pr_state" = "MERGED" ]; then
        status="${status} (já mergeado via #${pr_num})"
      fi
    fi
  fi

  echo "| $name | ${status:-?} | ${iter:--} | ${last:--} | $wt |"
done

# Notificação não-bloqueante (issue #500): não interrompe o loop de monitoramento do coordinator.
if [ -n "$suspended" ]; then
  echo
  echo "🔔 **Decision Inbox — decisões aguardando (workers SUSPENDED; a vaga no teto N já foi liberada):**"
  echo
  printf '%s' "$suspended"
fi

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
