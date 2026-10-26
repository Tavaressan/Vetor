#!/usr/bin/env bash
# Merge de PR com verificação do estado real (mecaniza as issues #12 e #495).
#
# Uso: vetor-merge.sh [--auto] <pr-number>
#
# Exit: 0 = PR MERGEADO no remoto (mesmo que o cleanup local da branch tenha falhado);
#       4 = PR ENFILEIRADO: o gh aceitou o pedido (auto-merge ou merge queue), mas o PR continua
#           OPEN — o merge ainda NÃO aconteceu. Não rode sync-root nem cleanup de worktree/branch;
#           o GitHub conclui o merge quando os requisitos/fila liberarem;
#       3 = merge não aconteceu (conflito ou outro erro real — ver saída do gh);
#       2 = uso incorreto.
#
# Merge queue (issue #495, RF-04): detectada pela API GraphQL do GitHub, campo
# `Repository.mergeQueue(branch:)` do branch base do PR (nulo = sem fila). Com fila ativa o script
# passa `--auto` e omite `--delete-branch` (o gh recusa `--delete-branch` num branch base com fila).
# `--auto` explícito força o auto-merge mesmo sem fila detectada (exige "Allow auto-merge" no
# repositório). Limitação: se a consulta GraphQL falhar (rede, permissão), a fila é tratada como
# ausente — o gh ainda enfileira sozinho num branch com fila, e a checagem de estado final
# reporta exit 4, mas o `--delete-branch` aí faria o gh falhar (exit 3 com a mensagem dele).

set -uo pipefail

auto_flag=0
pr=""

for arg in "$@"; do
  case "$arg" in
    --auto)
      auto_flag=1
      ;;
    *)
      if [ -z "$pr" ]; then
        pr="$arg"
      else
        echo "uso: vetor-merge.sh [--auto] <pr-number>" >&2
        exit 2
      fi
      ;;
  esac
done

if [ -z "$pr" ]; then
  echo "uso: vetor-merge.sh [--auto] <pr-number>" >&2
  exit 2
fi

# Uma única consulta aos campos escalares (todos de uma linha): mergeable, headRefName,
# baseRefName e title, na ordem. O body é multilinha, então tem consulta própria mais abaixo.
pr_meta=$(gh pr view "$pr" --json mergeable,headRefName,baseRefName,title \
  --jq '.mergeable, .headRefName, .baseRefName, .title' 2>/dev/null || true)
pr_meta=${pr_meta//$'\r'/}
{
  IFS= read -r mergeable
  IFS= read -r head_branch
  IFS= read -r base_branch
  IFS= read -r pr_title
} <<<"$pr_meta"

if [ "${mergeable:-}" = "CONFLICTING" ]; then
  echo "ERRO: PR #$pr está em estado CONFLICTING — requer sincronização/rebase local com a branch default." >&2
  exit 3
fi

# Detecta merge queue ativa no branch base. Falha da consulta = sem fila (ver limitação no cabeçalho).
queue_active=0
if [ -n "${base_branch:-}" ]; then
  has_queue=$(gh api graphql -F owner='{owner}' -F name='{repo}' -F branch="$base_branch" \
    -f query='query($owner: String!, $name: String!, $branch: String!) { repository(owner: $owner, name: $name) { mergeQueue(branch: $branch) { id } } }' \
    --jq '.data.repository.mergeQueue != null' 2>/dev/null || true)
  has_queue=${has_queue//$'\r'/}
  if [ "$has_queue" = "true" ]; then
    queue_active=1
  fi
fi

# Sai do modo draft se necessário (não falha se o PR já está ready).
gh pr ready "$pr" 2>/dev/null || true

# Issue #325: repassa subject/body originais no squash para evitar que commits
# intermediários com Refs #N fechem issues prematuramente.
pr_body=$(gh pr view "$pr" --json body -q .body 2>/dev/null || echo "")

merge_args=("$pr" "--squash")
if [ "$queue_active" -eq 0 ]; then
  merge_args+=("--delete-branch")
fi
if [ "$auto_flag" -eq 1 ] || [ "$queue_active" -eq 1 ]; then
  merge_args+=("--auto")
fi

if [ -n "${pr_title:-}" ]; then
  merge_args+=("--subject" "$pr_title")
fi
if [ -n "$pr_body" ]; then
  merge_args+=("--body" "$pr_body")
fi

# Issue #338: quando o merge aconteceu no remoto mas a branch remota sobreviveu (cleanup local do
# gh abortou, ou a fila não permite --delete-branch), apaga-a explicitamente.
delete_remote_branch() {
  if [ -n "${head_branch:-}" ]; then
    git push origin --delete "$head_branch" 2>/dev/null || true
  fi
}

gh_exit=0
gh pr merge "${merge_args[@]}" || gh_exit=$?

# O exit do gh NÃO diz se o PR foi mergeado: exit 0 também cobre "auto-merge habilitado" e "adicionado
# à merge queue" (PR ainda OPEN), e exit não-zero pode ser só o cleanup local da branch (ex.:
# "fatal: '<default>' is already used by worktree at ..." com worktrees paralelos). Confirme o estado
# real antes de classificar.
state=$(gh pr view "$pr" --json state -q .state 2>/dev/null || echo "UNKNOWN")
state=${state//$'\r'/}

if [ "$state" = "MERGED" ]; then
  if [ "$gh_exit" -ne 0 ] || [ "$queue_active" -eq 1 ]; then
    delete_remote_branch
  fi
  echo "PR #$pr mergeado no remoto; branch remota verificada/removida."
  exit 0
fi

if [ "$gh_exit" -eq 0 ]; then
  if [ "$state" = "OPEN" ]; then
    echo "PR #$pr ENFILEIRADO (auto-merge/merge queue): o GitHub conclui o squash merge quando os requisitos liberarem — ainda NÃO mergeado."
    exit 4
  fi
  if [ "$state" = "UNKNOWN" ]; then
    # Estado ilegível após exit 0 do gh (ex.: falha transitória de rede): mantém o comportamento
    # anterior de confiar no gh, mas avisa que o merge não foi confirmado.
    echo "AVISO: PR #$pr — gh pr merge saiu com 0, mas o estado não pôde ser confirmado." >&2
    exit 0
  fi
fi

echo "PR #$pr NÃO foi mergeado (state=$state) — trate como conflito/erro real." >&2
exit 3
