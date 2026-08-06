#!/usr/bin/env bash
# Checagens determinísticas compartilhadas pelas skills do Vetor.
#
# Uso: vetor-checks.sh <subcomando> [args]
#   default-branch             imprime a branch default do repositório (nunca assume master)
#   in-worktree                exit 0 se o cwd é um worktree linkado; exit 1 se é o root
#   migrations                 exit 1 se há versões de migration duplicadas (convenção Flyway)
#   debug-scan <base-branch>   exit 1 se o diff vs. a base contém padrões de debug/teste exclusivo
#   validate-issue-ref <valor> exit 1 se valor não for inteiro positivo; exit 0 caso contrário
#   safe-remove-worktree <path> remove o worktree somente se não houver worktree filho ativo
#   sync-root                  tenta retornar o repositório principal para a branch default de forma segura
#
# Exit codes: 0 = passou; 1 = checagem falhou (a skill deve parar e mostrar a saída); 2 = uso incorreto.

set -uo pipefail

cmd="${1:-}"

case "$cmd" in
  default-branch)
    DEFAULT_BRANCH=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
    [ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | sed -n '/HEAD branch/s/.*: //p')
    [ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH=master
    echo "$DEFAULT_BRANCH"
    ;;

  in-worktree)
    # Contrato estável para uso EXTERNO ao plugin (issue #129): hooks/scripts de projetos
    # consumidores podem chamar `vetor-checks.sh in-worktree` diretamente para decidir se o
    # cwd é um worktree linkado (exit 0) ou o repositório principal (exit 1), sem stdout.
    # Não reimplemente essa comparação com `pwd` vs `git worktree list` — os formatos de path
    # nunca coincidem no Windows/Git Bash, o que faz a comparação ingênua concluir "worktree"
    # mesmo estando no root.
    git_dir=$(git rev-parse --git-dir 2>/dev/null) || { echo "não é um repositório git" >&2; exit 1; }
    common_dir=$(git rev-parse --git-common-dir 2>/dev/null)
    if [ "$(cd "$git_dir" && pwd)" = "$(cd "$common_dir" && pwd)" ]; then
      echo "cwd é o root do repositório, não um worktree linkado" >&2
      exit 1
    fi
    ;;

  migrations)
    # Colisão semântica invisível ao git: dois arquivos com a mesma versão (V13__a.sql, V13__b.sql).
    dups=$(git ls-files '*/db/migration/V*__*.sql' \
      | sed -E 's#.*/V([0-9]+)__.*#\1#' | sort | uniq -d)
    if [ -n "$dups" ]; then
      echo "FALHA: colisão de versão de migration — versões duplicadas:" >&2
      for v in $dups; do
        echo "  V$v:" >&2
        git ls-files "*/db/migration/V${v}__*.sql" | sed 's/^/    /' >&2
      done
      echo "Renumere a migration deste worker para a próxima versão livre antes de prosseguir." >&2
      exit 1
    fi
    ;;

  debug-scan)
    base="${2:?uso: vetor-checks.sh debug-scan <base-branch>}"
    # Grep only added lines from diff (lines starting with +), not the entire file content.
    # The caller MUST pass origin/$DEFAULT_BRANCH (not local $DEFAULT_BRANCH) to avoid
    # Stale branch references in worktrees (issue #70).
    # Exclude script/test files that define or test the regex to avoid false positives (issue #108, #109)
    hits=$(git diff "$base" -U0 -- '*.ts' '*.sh' '*.js' '*.tsx' '*.jsx' \
      ':!scripts/vetor-checks.sh' ':!scripts/lib/vetor_checks_test.ts' ':!skills/**/*.md' 2>/dev/null \
      | grep -E '^\+' | grep -vE '^\+\+\+' \
      | grep -nE 'console\.log|var_dump|fit\(|fdescribe\(|it\.only' 2>/dev/null || true)
    if [ -n "$hits" ]; then
      echo "FALHA: padrões de debug/teste exclusivo no diff (remova antes do push):" >&2
      echo "$hits" >&2
      exit 1
    fi
    ;;

  validate-issue-ref)
    valor="${2:?uso: vetor-checks.sh validate-issue-ref <valor>}"
    if ! [[ "$valor" =~ ^[1-9][0-9]*$ ]]; then
      echo "ERRO: issue# deve ser um inteiro positivo, recebido \"$valor\"" >&2
      exit 1
    fi
    ;;

  safe-remove-worktree)
    target="${2:?uso: vetor-checks.sh safe-remove-worktree <path>}"
    target=$(cd "$target" && pwd -P) || {
      echo "ERRO: worktree para cleanup não encontrado: $target" >&2
      exit 1
    }

    children=()
    while IFS= read -r line; do
      case "$line" in
        "worktree "*)
          candidate="${line#worktree }"
          candidate=$(cd "$candidate" 2>/dev/null && pwd -P) || continue
          case "$candidate" in
            "$target"/*) children+=("$candidate") ;;
          esac
          ;;
      esac
    done < <(git worktree list --porcelain)

    if [ "${#children[@]}" -gt 0 ]; then
      echo "FALHA: cleanup bloqueado; o worktree $target contém worktree(s) ativo(s):" >&2
      printf '  %s\n' "${children[@]}" >&2
      echo "Remova ou realoque os worktrees filhos antes de remover o pai." >&2
      exit 1
    fi

    git worktree remove "$target"
    ;;

  sync-root)
    # Tenta retornar a raiz do repo para a branch default se a branch atual estiver limpa
    # e sem commits locais pendentes vs remote (ou sem remote tracker caso já deletada).
    ROOT=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null | xargs dirname)
    [ -z "$ROOT" ] && exit 0
    cd "$ROOT" || exit 0
    
    DEFAULT_BRANCH=$("$0" default-branch)
    current=$(git branch --show-current 2>/dev/null)
    [ -z "$current" ] || [ "$current" = "$DEFAULT_BRANCH" ] && exit 0
    
    # 1. Verifica se tem uncommitted changes
    if ! git diff-index --quiet HEAD --; then
      echo "AVISO: root tem mudanças pendentes na branch $current. Não mudando para $DEFAULT_BRANCH." >&2
      exit 0
    fi
    
    # 2. Verifica se a branch tem commits que não estão na default
    if ! git merge-base --is-ancestor HEAD "origin/$DEFAULT_BRANCH" 2>/dev/null; then
      echo "AVISO: root está na branch $current que possui commits não integrados em origin/$DEFAULT_BRANCH. Não mudando para $DEFAULT_BRANCH." >&2
      exit 0
    fi
    
    git checkout "$DEFAULT_BRANCH" >/dev/null 2>&1
    git pull origin "$DEFAULT_BRANCH" >/dev/null 2>&1
    echo "Root sincronizado com $DEFAULT_BRANCH (branch anterior: $current estava limpa e mesclada)."
    ;;

  *)
    echo "uso: vetor-checks.sh <default-branch|in-worktree|migrations|debug-scan <base-branch>|validate-issue-ref <valor>|safe-remove-worktree <path>|sync-root>" >&2
    exit 2
    ;;
esac

exit 0
