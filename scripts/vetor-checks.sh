#!/usr/bin/env bash
# Checagens determinísticas compartilhadas pelas skills do Vetor.
#
# Uso: vetor-checks.sh <subcomando> [args]
#   default-branch             imprime a branch default do repositório (nunca assume master)
#   repo-root                  imprime o path absoluto do repositório principal (root), mesmo
#                               quando executado de dentro de um worktree linkado (issue #160) —
#                               use para resolver arquivos como .claude/vetor/module-test-map.md
#                               e .claude/vetor/config.json, que não são materializados em
#                               worktrees quando .claude/ está no .gitignore do projeto-alvo
#   in-worktree                exit 0 se o cwd é um worktree linkado; exit 1 se é o root
#   migrations                 exit 1 se há versões de migration duplicadas (convenção Flyway)
#   debug-scan <base-branch>   exit 1 se o diff vs. a base contém padrões de debug/teste exclusivo
#   validate-issue-ref <valor> exit 1 se valor não for inteiro positivo; exit 0 caso contrário
#   safe-remove-worktree <path> remove o worktree somente se não houver worktree filho ativo;
#                               exit 1 se, após o remove, sobrar diretório residual em disco (#157)
#   sync-root                  tenta retornar o repositório principal para a branch default de forma segura
#   worktree-audit              lista worktrees linkados (exceto o root) com idade/tamanho/uncommitted
#   find-orphan-status [dir]   lista status files sem worktree correspondente (default: .claude/vetor/status)
#   archive-orphan-status <path> move um status file órfão para <dir>/archive/
#   architectural-risk [map] [days]  fan-in (deletion test) dos módulos tocados nos últimos <days>
#                               dias (default 7), resolvidos via module-test-map.md (default
#                               .claude/vetor/module-test-map.md). Uma linha por módulo tocado:
#                               <módulo>|<fan-in>|<candidate:yes/no> (candidate se fan-in > 10)
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

  repo-root)
    common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
    root=""
    [ -n "$common_dir" ] && root=$(dirname "$common_dir")
    [ -z "$root" ] && { echo "não é um repositório git" >&2; exit 1; }
    echo "$root"
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
      ':!scripts/vetor-checks.sh' ':!scripts/tests/vetor-checks_test.ts' ':!skills/**/*.md' \
      ':!.opencode/scripts/vetor-checks.sh' ':!.opencode/skills/**/*.md' \
      ':!opencode/scripts/vetor-checks.sh' ':!opencode/skills/**/*.md' 2>/dev/null \
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
    remove_status=$?

    # git worktree remove DESREGISTRA o worktree e só então tenta apagar o diretório. No
    # Windows, artefatos de build (build/, .gradle/, node_modules/) costumam estourar o limite
    # de 260 caracteres e a exclusão falha com "Filename too long", deixando um diretório órfão
    # que nenhuma outra checagem detecta (issue #157).
    #
    # O fallback abaixo só pode rodar quando remove_status -eq 0: nesse caso o git já
    # desregistrou o worktree e o diretório em disco é resíduo seguro de remover. Se
    # remove_status != 0, o git recusou a remoção inteira (ex.: worktree sujo, sem --force) —
    # o worktree segue registrado e o diretório pode conter trabalho não commitado; forçar a
    # exclusão nesse caso apagaria dados e deixaria metadata do git órfã (achado do code review
    # da PR #169).
    if [ "$remove_status" -eq 0 ] && [ -d "$target" ]; then
      case "$(uname -s 2>/dev/null)" in
        MINGW*|MSYS*|CYGWIN*)
          # Contorna o limite de path do Windows com o prefixo \\?\, que aceita paths > 260 chars.
          win_path=$(cygpath -w "$target" 2>/dev/null) || win_path=""
          if [ -n "$win_path" ]; then
            cmd //c rd /s /q "\\\\?\\$win_path" 2>/dev/null
          fi
          ;;
      esac
    fi

    if [ "$remove_status" -ne 0 ]; then
      echo "ERRO: git worktree remove recusou remover '$target' (worktree ainda registrado — possível uncommitted work). Resolva manualmente (git worktree remove --force, se apropriado) antes de prosseguir." >&2
      exit 1
    fi

    if [ -d "$target" ]; then
      echo "ERRO: git worktree remove desregistrou '$target' do git, mas o diretório permanece em disco (possível 'Filename too long' no Windows). Remova manualmente antes de prosseguir." >&2
      exit 1
    fi
    ;;

  sync-root)
    # Tenta retornar a raiz do repo para a branch default se a branch atual estiver limpa
    # e sem commits locais pendentes vs remote (ou sem remote tracker caso já deletada).
    common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
    ROOT=""
    [ -n "$common_dir" ] && ROOT=$(dirname "$common_dir")
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

  worktree-audit)
    # Emite uma linha por worktree linkado (exclui o root) no formato:
    #   <path>|<branch>|<age_days>|<size_kb>|<uncommitted:yes/no>
    # "age_days" é medido a partir do timestamp do último commit do worktree (proxy de
    # staleness — evita depender de mtime de diretório, que muda a qualquer escrita).
    common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
    main_worktree=""
    [ -n "$common_dir" ] && main_worktree=$(dirname "$common_dir")
    now_ts=$(date +%s)
    path=""
    branch=""
    while IFS= read -r line; do
      case "$line" in
        "worktree "*)
          path="${line#worktree }"
          branch=""
          ;;
        "branch refs/heads/"*)
          branch="${line#branch refs/heads/}"
          ;;
        "")
          if [ -n "$path" ] && [ "$path" != "$main_worktree" ] && [ -d "$path" ]; then
            last_commit_ts=$(git -C "$path" log -1 --format=%ct 2>/dev/null || echo "$now_ts")
            age_days=$(( (now_ts - last_commit_ts) / 86400 ))
            size_kb=$(du -sk "$path" 2>/dev/null | cut -f1)
            if [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]; then
              uncommitted="yes"
            else
              uncommitted="no"
            fi
            echo "${path}|${branch:-detached}|${age_days}|${size_kb:-0}|${uncommitted}"
          fi
          path=""
          branch=""
          ;;
      esac
    done < <(git worktree list --porcelain; echo "")
    ;;

  find-orphan-status)
    # Lista status files (`.claude/vetor/status/*.md`) cujo worktree correspondente não
    # existe mais em `git worktree list`. Report-only — não move nem apaga nada.
    status_dir="${2:-.claude/vetor/status}"
    [ -d "$status_dir" ] || exit 0
    active=$(git worktree list --porcelain | sed -n 's#^branch refs/heads/##p' | tr '/' '-')
    for f in "$status_dir"/*.md; do
      [ -e "$f" ] || continue
      name=$(basename "$f" .md)
      if ! printf '%s\n' "$active" | grep -qx "$name"; then
        echo "$f"
      fi
    done
    ;;

  archive-orphan-status)
    # Move um status file órfão para <dir>/archive/ (não apaga — recolhimento reversível).
    target="${2:?uso: vetor-checks.sh archive-orphan-status <path-do-status-file>}"
    [ -f "$target" ] || {
      echo "ERRO: status file não encontrado: $target" >&2
      exit 1
    }
    status_dir=$(dirname "$target")
    archive_dir="$status_dir/archive"
    mkdir -p "$archive_dir"
    mv "$target" "$archive_dir/"
    echo "Arquivado: $archive_dir/$(basename "$target")"
    ;;

  architectural-risk)
    # Deletion test (issue #181/#198): fan-in dos módulos tocados nos últimos <days> dias, via
    # heurística textual de import/require — read-only, barato, cron-compatível. Módulo com
    # fan-in > 10 é candidato a revisão de design (threshold ajustável, não hard cap).
    map="${2:-.claude/vetor/module-test-map.md}"
    days="${3:-7}"
    [ -f "$map" ] || exit 0

    # Extrai a tabela "Prefixo do path | Módulo" do module-test-map.md.
    prefixes=()
    mod_names=()
    while IFS='|' read -r _ prefix mod _; do
      prefix=$(printf '%s' "$prefix" | sed -E 's/^[[:space:]]*`?//; s/`?[[:space:]]*$//')
      mod=$(printf '%s' "$mod" | sed -E 's/^[[:space:]]*`?//; s/`?[[:space:]]*$//')
      [ -z "$prefix" ] && continue
      case "$prefix" in
        Prefixo*|---*) continue ;;
      esac
      prefixes+=("$prefix")
      mod_names+=("$mod")
    done < <(sed -n '/Prefixo do path/,/^$/p' "$map")

    [ "${#prefixes[@]}" -eq 0 ] && exit 0

    touched_files=$(git log --since="${days} days ago" --name-only --pretty=format: 2>/dev/null \
      | sort -u | grep -v '^$')
    [ -z "$touched_files" ] && exit 0

    touched_modules=()
    while IFS= read -r file; do
      for i in "${!prefixes[@]}"; do
        prefix="${prefixes[$i]}"
        # "./" é o catch-all de repositório de módulo único (ex.: module-test-map.md
        # auto-gerado) — não é um prefixo literal de `git log --name-only`, que nunca
        # antepõe "./" aos paths.
        if [ "$prefix" = "./" ]; then
          matched=1
        else
          case "$file" in
            "$prefix"*) matched=1 ;;
            *) matched=0 ;;
          esac
        fi
        if [ "$matched" -eq 1 ]; then
          touched_modules+=("${mod_names[$i]}")
          break
        fi
      done
    done <<< "$touched_files"
    [ "${#touched_modules[@]}" -eq 0 ] && exit 0

    unique_modules=$(printf '%s\n' "${touched_modules[@]}" | sort -u | grep -v '^$')
    [ -z "$unique_modules" ] && exit 0

    while IFS= read -r module; do
      count=$(grep -rlE "(import|require).*['\"].*${module}" . \
        --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" \
        --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=worktrees \
        --exclude-dir=target --exclude-dir=.next --exclude-dir=__pycache__ --exclude-dir=.venv \
        2>/dev/null | wc -l)
      candidate="no"
      [ "$count" -gt 10 ] && candidate="yes"
      echo "${module}|${count}|${candidate}"
    done <<< "$unique_modules"
    ;;

  *)
    echo "uso: vetor-checks.sh <default-branch|repo-root|in-worktree|migrations|debug-scan <base-branch>|validate-issue-ref <valor>|safe-remove-worktree <path>|sync-root|worktree-audit|find-orphan-status [dir]|archive-orphan-status <path>|architectural-risk [map] [days]>" >&2
    exit 2
    ;;
esac

exit 0
