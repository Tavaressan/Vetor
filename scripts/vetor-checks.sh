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
#   validate-ship-args [args]  valida e parseia flags do /vetor:ship (--prepare, --finalize, legado)
#   check-disjoint <candidata> <outra>...  compara a branch candidata com cada uma das outras da onda
#                               (cache de arquivos tocados, ou git diff se ausente): DISJOINT exit 0 |
#                               uma linha OVERLAP por branch que sobrepõe, exit 1 | exit 2 = dados
#                               indisponíveis (#495)
#   auto-ship-gates <PR> <worktree-path>  avalia os 4 gates da entrega autônoma em --headless (CI SUCCESS,
#                               revisões sem blocker, migrations sem colisão, MERGEABLE), uma linha
#                               GATE por gate + VERDICT: exit 0 = PASS | 1 = FAIL (PR fica aberto) |
#                               3 = PENDING (reavaliar) | 2 = uso incorreto (#497)
#   migrations [--against <ref>]  colisão de versão de migration na árvore atual; com --against soma
#                               as migrations de <ref> (ex.: origin/<default>) (#497)
#   carry-changes <worktree-path> <branch>  transporta as mudanças rastreadas do root para o
#                               worktree recém-criado e limpa o root (#428). exit 3 = falhou antes
#                               do backup (root intacto, worktree devolvido a HEAD, pode remover);
#                               exit 4 = transporte feito, limpeza do root incompleta (preservar
#                               o worktree e o backup em .claude/vetor/carry/)
#   safe-remove-worktree <path> remove o worktree somente se não houver worktree filho ativo;
#                               exit 1 se, após o remove, sobrar diretório residual em disco (#157)
#   prepare <worktree> <issue#...> [--test-cmd <cmd>]  Pre-Ship completo sem LLM (#543): sync com a
#                               default, migrations, debug-scan, testes dos módulos tocados (pulados
#                               quando HEAD == SHA da linha `Tested:` do status file e o sync não trouxe
#                               commits, #542), push, PR draft (corpo via --body-file) e PR_STAGED +
#                               preship.json. Exit: 0 = PR_STAGED | 1 = validação (branch, migrations,
#                               debug-scan, config) | 2 = uso | 3 = teste ou sync falhou (worktree
#                               intacto) | 5 = push ou PR falhou
#   finalize <PR> <branch> [--auto]  merge via vetor-merge.sh e, só com merge concluído, sync-root +
#                               cleanup completo (worktree, branch, status, preship.json) (#543).
#                               Exit: 0 = mergeado e limpo | 3 = merge não aconteceu | 4 = enfileirado
#                               (tudo preservado) | 5 = mergeado com cleanup incompleto | 2 = uso
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
SELF="$0"
case "$SELF" in */*) SELF="$(cd "$(dirname "$SELF")" && pwd -P)/$(basename "$SELF")" ;; esac

# --- prepare / finalize determinísticos (issues #543, #542) -------------------------------------
# Funções chamadas pelos subcomandos `prepare` e `finalize` (definidas antes do `case`).

_vc_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Módulos tocados pelos arquivos alterados (stdin: um path por linha) segundo a tabela
# "Prefixo do path | Módulo" do module-test-map.md ($1). Primeiro prefixo que casa vence.
_vc_modules_for_files() {
  local map="$1" prefixes=() mods=() prefix mod file i seen=""
  while IFS='|' read -r _ prefix mod _; do
    prefix=$(printf '%s' "$prefix" | sed -E 's/^[[:space:]]*`?//; s/`?[[:space:]]*$//')
    mod=$(printf '%s' "$mod" | sed -E 's/^[[:space:]]*`?//; s/`?[[:space:]]*$//')
    case "$prefix" in ""|Prefixo*|---*) continue ;; esac
    prefixes+=("$prefix"); mods+=("$mod")
  done < <(sed -n '/Prefixo do path/,/^$/p' "$map")
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    for i in "${!prefixes[@]}"; do
      if [ "${prefixes[$i]}" = "./" ] || [[ "$file" == "${prefixes[$i]}"* ]]; then
        case " $seen " in *" ${mods[$i]} "*) ;; *) seen="$seen ${mods[$i]}"; echo "${mods[$i]}" ;; esac
        break
      fi
    done
  done
}

# Comando headless de um módulo ($2) na tabela "Módulo | Comando headless" do map ($1).
_vc_command_for_module() {
  awk -F'|' -v m="$2" '
    function trim(s) { gsub(/^[ \t]*`?|`?[ \t]*$/, "", s); return s }
    /Comandos por módulo/ { on = 1; next }
    /^## / { on = 0 }
    on && NF >= 3 && trim($2) == m { print trim($3); exit }' "$1"
}

_vc_prepare() {
  local worktree="" issues=() test_cmd=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --test-cmd) test_cmd="${2:?--test-cmd exige um comando}"; shift 2 ;;
      *) if [ -z "$worktree" ]; then worktree="$1"; else issues+=("$1"); fi; shift ;;
    esac
  done
  if [ -z "$worktree" ] || [ "${#issues[@]}" -eq 0 ]; then
    echo "uso: vetor-checks.sh prepare <worktree> <issue#...> [--test-cmd <cmd>]" >&2; return 2
  fi
  local n
  for n in "${issues[@]}"; do
    [[ "$n" =~ ^[1-9][0-9]*$ ]] || { echo "ERRO: issue# inválido: \"$n\"" >&2; return 2; }
  done
  cd "$worktree" 2>/dev/null || { echo "ERRO: worktree inexistente: $worktree" >&2; return 1; }
  "$SELF" in-worktree || return 1

  local branch default root sanitized status_file
  branch=$(git branch --show-current)
  default=$("$SELF" default-branch)
  [ -n "$branch" ] && [ "$branch" != "$default" ] || { echo "ERRO: branch inválida para o Pre-Ship: '${branch}'" >&2; return 1; }
  root=$("$SELF" repo-root) || return 1
  sanitized="${branch//\//-}"
  status_file="$root/.claude/vetor/status/${sanitized}.md"

  # 1. Sincroniza com a default (conflito -> aborta o merge e devolve ao LLM, exit 3)
  local head_before head_after synced=0
  git fetch origin "$default" >/dev/null 2>&1 || { echo "FALHA(sync): git fetch origin $default falhou" >&2; return 3; }
  head_before=$(git rev-parse HEAD)
  if ! git merge --no-edit "origin/$default" >/dev/null 2>&1; then
    git merge --abort >/dev/null 2>&1 || true
    echo "FALHA(sync): conflito ao mesclar origin/$default; merge abortado, worktree intacto. Resolva seguindo conflict-resolution.md." >&2
    return 3
  fi
  head_after=$(git rev-parse HEAD)
  [ "$head_before" != "$head_after" ] && synced=1

  # 2. Migrations e debug-scan
  "$SELF" migrations --against "origin/$default" || return 1
  "$SELF" debug-scan "origin/$default" || return 1

  # 3. Testes locais (#542: pula quando HEAD == SHA testado no GREEN e o sync não trouxe nada)
  local tested_line tested_sha="" tested_cmd="" tests_summary="" dirty
  tested_line=$(grep -m1 '^Tested:' "$status_file" 2>/dev/null || true)
  if [[ "$tested_line" =~ ^Tested:[[:space:]]+([0-9a-f]{7,40})[[:space:]]+(.*)[[:space:]]+pass[[:space:]]*$ ]]; then
    tested_sha="${BASH_REMATCH[1]}"; tested_cmd="${BASH_REMATCH[2]}"
  fi
  dirty=$(git status --porcelain --untracked-files=no)
  if [ -n "$tested_sha" ] && [ -z "$test_cmd" ] && [ "$synced" -eq 0 ] && [ -z "$dirty" ] \
     && [ "$(git rev-parse HEAD)" = "$(git rev-parse "$tested_sha" 2>/dev/null || echo x)" ]; then
    tests_summary="skipped: HEAD ${head_after:0:12} já testado no GREEN ($tested_cmd) e o sync não trouxe commits"
    echo "Testes locais pulados: $tests_summary"
  else
    local cmds=() mod cmd map="$root/.claude/vetor/module-test-map.md" reason=""
    [ -n "$tested_sha" ] && [ -z "$test_cmd" ] && reason=" (HEAD difere do SHA testado ou o sync trouxe commits: testando de novo)"
    if [ -n "$test_cmd" ]; then
      cmds+=("$test_cmd")
    else
      [ -f "$map" ] || { echo "ERRO: $map ausente e sem --test-cmd (rode /vetor:install)" >&2; return 1; }
      while IFS= read -r mod; do
        cmd=$(_vc_command_for_module "$map" "$mod")
        case "$cmd" in ""|*"sem suíte de testes"*) echo "Módulo $mod: skipped (no test suite)"; continue ;; esac
        cmds+=("$cmd")
      done < <(git diff --name-only "origin/$default" | _vc_modules_for_files "$map")
    fi
    local log; log=$(mktemp)
    for cmd in "${cmds[@]}"; do
      echo "Rodando: $cmd$reason"
      if ! bash -c "$cmd" >"$log" 2>&1; then
        echo "FALHA(teste): '$cmd' não passou. Últimas 30 linhas:" >&2
        tail -n 30 "$log" >&2; rm -f "$log"; return 3
      fi
    done
    rm -f "$log"
    tests_summary="${#cmds[@]} comando(s) passaram: ${cmds[*]:-nenhum (sem módulos com suíte)}"
  fi

  # 4. Push (3 tentativas)
  local tries=0
  until git push -u origin "$branch" >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -ge 3 ] && { echo "FALHA(push): git push -u origin $branch falhou após 3 tentativas" >&2; return 5; }
    sleep "${VETOR_PUSH_RETRY_DELAY:-2}"
  done

  # 5. PR draft (título/corpo determinísticos, corpo via --body-file)
  local pr_number pr_url subjects count title body_file type slug summary
  pr_number=$(gh pr list --head "$branch" --state open --json number -q '.[0].number' 2>/dev/null || true)
  if [ -z "$pr_number" ]; then
    subjects=$(git log --no-merges --format=%s "origin/$default..HEAD")
    count=$(printf '%s\n' "$subjects" | sed '/^$/d' | wc -l)
    if [ "$count" -eq 1 ] && ! printf '%s' "$subjects" | LC_ALL=C grep -q '[[:cntrl:]]'; then
      title="$subjects"
    else
      type="${branch%%/*}"; [ "$type" = "$branch" ] && type="chore"
      slug="${branch#*/}"; slug=$(printf '%s' "$slug" | sed -E 's/^[0-9]+-//')
      summary=$(printf '%s\n' "$subjects" | sed '/^$/d' | tr -d '[:cntrl:]' | paste -sd ';' - | sed 's/;/; /g')
      title="${type}(${slug}): ${summary:-atualização}"
    fi
    body_file=$(mktemp)
    {
      echo "## Resumo"
      # neutraliza palavras de fechamento (Closes/Fixes/Resolves #N) e @menções com crases
      printf '%s\n' "$subjects" | sed '/^$/d' \
        | sed -E 's/\b((close[sd]?|fix(e[sd])?|resolve[sd]?)[[:space:]:]+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#[0-9]+)/`\1`/Ig; s/(^|[^`A-Za-z0-9_])(@[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)?)/\1`\2`/g; s/^/- /'
      echo; echo "## Módulos testados"; echo "- $tests_summary"
      echo; echo "## Issue relacionada"
      for n in "${issues[@]}"; do echo "Closes #$n"; done
      echo; echo "🤖 Desenvolvido com [Claude Code](https://claude.ai/code)"
    } >"$body_file"
    pr_url=$(gh pr create --title "$title" --body-file "$body_file" --draft --base "$default" 2>&1) \
      || { echo "FALHA(pr): gh pr create falhou: $pr_url" >&2; rm -f "$body_file"; return 5; }
    rm -f "$body_file"
    pr_url=$(printf '%s\n' "$pr_url" | grep -Eo 'https?://[^ ]+/pull/[0-9]+' | tail -n1)
    pr_number="${pr_url##*/}"
  else
    pr_url=$(gh pr view "$pr_number" --json url -q .url 2>/dev/null || true)
  fi
  [[ "$pr_number" =~ ^[0-9]+$ ]] || { echo "FALHA(pr): número do PR não identificado" >&2; return 5; }

  # 6. Dispara o CI (snapshot, sem esperar) e registra PR_STAGED + preship.json
  gh pr checks "$pr_number" >/dev/null 2>&1 || true
  mkdir -p "$root/.claude/vetor/status"
  local iter
  iter=$(grep -m1 '^Iteration:' "$status_file" 2>/dev/null || echo "Iteration: 1/5 (Issue #${issues[0]})")
  {
    echo "# Agent Status — $branch"
    echo "Updated: $(_vc_now)"
    echo "Status: PR_STAGED"
    echo "PR: #$pr_number ($pr_url)"
    echo "$iter"
    [ -n "$tested_line" ] && echo "$tested_line"
    echo "Last action: Pre-ship concluído (PR draft #$pr_number criado, CI disparado; testes: $tests_summary)"
    echo "Next: Revisões consultivas pelo coordinator e, com o CI verde, /vetor:ship --finalize $pr_number"
  } >"$status_file"
  local jbranch jurl
  jbranch=$(printf '%s' "$branch" | sed 's/\\/\\\\/g; s/"/\\"/g')
  jurl=$(printf '%s' "$pr_url" | sed 's/\\/\\\\/g; s/"/\\"/g')
  cat >"$root/.claude/vetor/status/${sanitized}-preship.json" <<JSON
{
  "branch": "$jbranch",
  "prNumber": $pr_number,
  "prUrl": "$jurl",
  "headSha": "$(git rev-parse HEAD)",
  "stagedAt": "$(_vc_now)",
  "ciStatus": "PENDING",
  "reviewsStatus": "PENDING"
}
JSON
  echo "PR_STAGED #$pr_number $pr_url"
  return 0
}

_vc_finalize() {
  local pr="" branch="" merge_flags=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --auto) merge_flags+=(--auto); shift ;;
      *) if [ -z "$pr" ]; then pr="$1"; elif [ -z "$branch" ]; then branch="$1"; else pr=""; break; fi; shift ;;
    esac
  done
  if ! [[ "$pr" =~ ^[1-9][0-9]*$ ]] || [ -z "$branch" ]; then
    echo "uso: vetor-checks.sh finalize <PR> <branch> [--auto]" >&2; return 2
  fi
  local merge_sh root wt
  merge_sh="$(cd "$(dirname "$SELF")" && pwd -P)/vetor-merge.sh"
  root=$("$SELF" repo-root) || return 2
  wt=$(git worktree list --porcelain | awk -v b="refs/heads/$branch" '/^worktree /{p=substr($0,10)} $0=="branch " b {print p; exit}')

  # Pré-condições (sem merge se falharem): branch confere com o PR e CI verde
  local head_ref checks bad
  head_ref=$(gh pr view "$pr" --json headRefName -q .headRefName 2>/dev/null || true)
  if [ "$head_ref" != "$branch" ]; then
    echo "ERRO: <branch> '$branch' difere do headRefName do PR #$pr ('${head_ref:-desconhecido}'); nada foi feito." >&2
    return 2
  fi
  checks=$(gh pr view "$pr" --json statusCheckRollup -q '.statusCheckRollup[]? | if .__typename == "StatusContext" then .state elif .status == "COMPLETED" then .conclusion else "PENDING" end' 2>/dev/null) \
    || { echo "FALHA(ci): não foi possível ler os checks do PR #$pr; sem merge." >&2; return 3; }
  bad=$(printf '%s\n' "$checks" | sed '/^$/d' | grep -Evx 'SUCCESS|SKIPPED|NEUTRAL' | sort -u | paste -sd ' ' - || true)
  if [ -n "$bad" ]; then
    echo "FALHA(ci): PR #$pr com checks pendentes ou falhos ($bad); sem merge." >&2
    return 3
  fi

  local code=0
  bash "$merge_sh" ${merge_flags[@]+"${merge_flags[@]}"} "$pr" || code=$?
  case "$code" in
    0) ;;
    4) echo "PR #$pr ENFILEIRADO: worktree, branch e status preservados (sem sync-root nem cleanup)."; return 4 ;;
    *) return "$code" ;;
  esac

  cd "$root" || return 5
  local fail=0
  "$SELF" sync-root || fail=1
  if [ -n "$wt" ] && [ "$wt" != "$root" ]; then
    "$SELF" safe-remove-worktree "$wt" || fail=1
  fi
  if [ "$fail" -eq 0 ]; then
    "$SELF" delete-merged-branch "$branch" || fail=1
    "$SELF" clean-status "$branch" || fail=1
  fi
  if [ "$fail" -ne 0 ]; then
    echo "AVISO: PR #$pr mergeado, mas o cleanup ficou incompleto (worktree/branch/status preservados quando aplicável)." >&2
    return 5
  fi
  echo "PR #$pr mergeado e cleanup completo (worktree, branch, status e preship.json)."
  return 0
}

case "$cmd" in
  prepare)
    shift
    _vc_prepare "$@"
    exit $?
    ;;

  finalize)
    shift
    _vc_finalize "$@"
    exit $?
    ;;

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
    # `--against <ref>` (issue #497) soma à árvore atual as migrations de <ref> (ex.: origin/<default>):
    # um PR preparado antes de outro ser mergeado não enxerga, na própria árvore, a migration que
    # colidiria com a dele. Limitação: uma migration que o PR removeu e a <ref> ainda tem conta como presente.
    migration_files=$(git ls-files '*/db/migration/V*__*.sql')
    if [ "${2:-}" = "--against" ]; then
      against="${3:?uso: vetor-checks.sh migrations [--against <ref>]}"
      if ! git rev-parse --verify -q "${against}^{tree}" >/dev/null; then
        echo "FALHA: ref inexistente para --against: $against" >&2
        exit 2
      fi
      ref_files=$(git ls-tree -r --name-only "$against" | grep -E '/db/migration/V[0-9]+__.*\.sql$' || true)
      migration_files=$(printf '%s\n%s\n' "$migration_files" "$ref_files" | sed '/^$/d' | sort -u)
    fi
    dups=$(printf '%s\n' "$migration_files" | sed '/^$/d' \
      | sed -E 's#.*/V([0-9]+)__.*#\1#' | sort | uniq -d)
    if [ -n "$dups" ]; then
      echo "FALHA: colisão de versão de migration — versões duplicadas:" >&2
      for v in $dups; do
        echo "  V$v:" >&2
        printf '%s\n' "$migration_files" | grep -E "/V${v}__" | sed 's/^/    /' >&2
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
    # console.log(JSON.stringify(...)) é saída estruturada intencional de CLI wrappers (issue #245).
    # A exclusão vale só para o padrão de console.log: o awk remove essa assinatura de uma cópia da
    # linha antes de casar os padrões, então it.only/fit(/etc. (e outro console.log) na mesma linha
    # continuam sendo detectados, e a linha original é a que aparece no relatório.
    # Trade-off conhecido: um console.log(JSON.stringify(state)) esquecido como debug num arquivo
    # comum também passa — o scan não distingue debug esquecido de saída de CLI.
    hits=$(git diff "$base" -U0 -- '*.ts' '*.sh' '*.js' '*.tsx' '*.jsx' \
      ':!scripts/vetor-checks.sh' ':!scripts/tests/vetor-checks_test.ts' ':!skills/**/*.md' \
      ':!.opencode/scripts/vetor-checks.sh' ':!.opencode/scripts/vetor-checks_test.ts' ':!.opencode/skills/**/*.md' \
      ':!opencode/scripts/vetor-checks.sh' ':!opencode/scripts/vetor-checks_test.ts' ':!opencode/skills/**/*.md' 2>/dev/null \
      | grep -E '^\+' | grep -vE '^\+\+\+' \
      | awk '{ l = $0; gsub(/console\.log\(JSON\.stringify\(/, "", l)
               if (l ~ /console\.log|var_dump|fit\(|fdescribe\(|it\.only/) print NR ":" $0 }' || true)
    if [ -n "$hits" ]; then
      echo "FALHA: padrões de debug/teste exclusivo no diff (remova antes do push):" >&2
      echo "$hits" >&2
      exit 1
    fi
    ;;

  check-disjoint)
    shift
    if [ "$#" -lt 2 ]; then
      echo "uso: vetor-checks.sh check-disjoint <candidata> <outra> [<outra>...]" >&2
      exit 2
    fi
    root=$("$0" repo-root 2>/dev/null || echo ".")
    default_branch=$("$0" default-branch 2>/dev/null || echo "")
    script_dir=$(cd "$(dirname "$0")" && pwd -P)
    deno run -A "$script_dir/disjoint-check.ts" "$root" ${default_branch:+"--default-branch=$default_branch"} "$@"
    # O exit da CLI (0 disjunto, 1 sobreposição, 2 dados indisponíveis) é o resultado do check.
    exit $?
    ;;

  auto-ship-gates)
    pr="${2:?uso: vetor-checks.sh auto-ship-gates <PR> <worktree-path>}"
    worktree="${3:?uso: vetor-checks.sh auto-ship-gates <PR> <worktree-path>}"
    default_branch=$("$0" default-branch 2>/dev/null || echo "")
    script_dir=$(cd "$(dirname "$0")" && pwd -P)
    deno run -A "$script_dir/auto-ship-gates.ts" "$pr" "--worktree=$worktree" ${default_branch:+"--default-branch=$default_branch"}
    # O exit da CLI (0 PASS, 1 FAIL, 3 PENDING, 2 uso) é o resultado dos gates.
    exit $?
    ;;

  validate-ship-args)
    shift
    mode="full"
    target=""

    while [ $# -gt 0 ]; do
      case "$1" in
        --prepare)
          if [ "$mode" != "full" ]; then
            echo "ERRO: flags conflitantes no ship (--prepare e --finalize não podem ser usadas juntas)" >&2
            exit 1
          fi
          mode="prepare"
          shift
          ;;
        --finalize)
          if [ "$mode" != "full" ]; then
            echo "ERRO: flags conflitantes no ship (--prepare e --finalize não podem ser usadas juntas)" >&2
            exit 1
          fi
          mode="finalize"
          shift
          if [ $# -eq 0 ] || [[ "$1" == --* ]]; then
            echo "ERRO: --finalize exige o número da PR como argumento (ex.: /vetor:ship --finalize 42)" >&2
            exit 1
          fi
          target="$1"
          shift
          ;;
        --*)
          echo "ERRO: flag desconhecida para /vetor:ship: \"$1\"" >&2
          exit 1
          ;;
        *)
          if [ -n "$target" ]; then
            echo "ERRO: argumentos excessivos no ship: \"$1\"" >&2
            exit 1
          fi
          target="$1"
          shift
          ;;
      esac
    done

    if [ "$mode" = "finalize" ]; then
      if ! [[ "$target" =~ ^[1-9][0-9]*$ ]]; then
        echo "ERRO: PR-number para --finalize deve ser um inteiro positivo, recebido \"$target\"" >&2
        exit 1
      fi
    elif [ -n "$target" ]; then
      if ! [[ "$target" =~ ^[1-9][0-9]*$ ]]; then
        echo "ERRO: issue# para ship deve ser um inteiro positivo, recebido \"$target\"" >&2
        exit 1
      fi
    fi

    echo "$mode $target" | sed 's/ *$//'
    ;;

  validate-issue-ref)
    valor="${2:?uso: vetor-checks.sh validate-issue-ref <valor>}"
    if ! [[ "$valor" =~ ^[1-9][0-9]*$ ]]; then
      echo "ERRO: issue# deve ser um inteiro positivo, recebido \"$valor\"" >&2
      exit 1
    fi
    ;;

  carry-changes)
    worktree="${2:?uso: vetor-checks.sh carry-changes <worktree-path> <branch>}"
    branch="${3:?uso: vetor-checks.sh carry-changes <worktree-path> <branch>}"
    files=()
    # Encerra listando só os nomes dos arquivos, nunca o conteúdo do patch (RNF-02 da #428).
    carry_fail() {
      echo "ERRO: $2 Arquivos:" >&2
      printf '%s\n' ${files[@]+"${files[@]}"} >&2
      exit "$1"
    }
    # Falha antes do backup: devolve o worktree recém-criado (sem trabalho do usuário) a HEAD para
    # que safe-remove-worktree consiga removê-lo mesmo após um conflito; o root fica intacto.
    carry_abort() {
      git -C "$worktree" reset -q --hard HEAD >/dev/null 2>&1
      git -C "$worktree" clean -fdq >/dev/null 2>&1
      carry_fail 3 "$1"
    }
    patch=$(mktemp) || { echo "ERRO: captura do patch falhou; root preservado." >&2; exit 1; }
    trap 'rm -f "$patch"' EXIT
    # --no-renames: um rename vira remoção + criação, e a origem também entra na limpeza do root.
    git diff HEAD --binary --no-renames > "$patch" || { echo "ERRO: captura do patch falhou; root preservado." >&2; exit 1; }
    while IFS= read -r -d '' file; do files+=("$file"); done < <(git diff HEAD --name-only --no-renames -z)
    [ "${#files[@]}" -gt 0 ] || { echo "ERRO: não há alterações rastreadas para transportar." >&2; exit 1; }
    git -C "$worktree" apply --3way "$patch" >/dev/null 2>&1 \
      || carry_abort "aplicação conflitou ou falhou; root preservado."
    [ -z "$(git -C "$worktree" ls-files -u)" ] \
      || carry_abort "aplicação deixou entradas não mescladas; root preservado."
    # Verifica antes do reset: o `apply --3way` deixa tudo no índice, inclusive arquivos novos,
    # que depois do reset viram não rastreados e somem de `git diff HEAD`.
    changed=()
    while IFS= read -r -d '' file; do changed+=("$file"); done < <(git -C "$worktree" diff HEAD --name-only --no-renames -z)
    # Busca linear em vez de array associativo: o bash 3.2 do macOS não tem `declare -A`.
    for file in "${files[@]}"; do
      found=0
      for other in ${changed[@]+"${changed[@]}"}; do
        if [ "$other" = "$file" ]; then found=1; break; fi
      done
      [ "$found" -eq 1 ] || carry_abort "verificação falhou; root preservado."
    done
    git -C "$worktree" reset -q --mixed HEAD >/dev/null 2>&1 \
      || carry_abort "não foi possível deixar as mudanças não staged; root preservado."
    root=$("$0" repo-root) || carry_abort "resolução do root falhou; root preservado."
    carry_dir="$root/.claude/vetor/carry"
    backup="$carry_dir/${branch//\//-}.patch"
    mkdir -p "$carry_dir" || carry_abort "backup falhou; root preservado."
    # Diretório que se auto-ignora: no projeto-alvo o .gitignore pode não cobrir .claude/vetor/carry/.
    [ -f "$carry_dir/.gitignore" ] || printf '*\n' > "$carry_dir/.gitignore" \
      || carry_abort "backup falhou; root preservado."
    cp "$patch" "$backup" || carry_abort "backup falhou; root preservado."
    tracked=()
    new_files=()
    for file in "${files[@]}"; do
      if git cat-file -e "HEAD:$file" 2>/dev/null; then tracked+=("$file"); else new_files+=("$file"); fi
    done
    # Daqui em diante o worktree já tem as mudanças: falha de limpeza usa exit 4 para a skill
    # preservar o worktree em vez de removê-lo.
    partial="transporte concluído, mas a limpeza do root ficou incompleta; worktree e backup ($backup) preservados."
    if [ "${#tracked[@]}" -gt 0 ]; then
      git restore --source=HEAD --staged --worktree -- "${tracked[@]}" || carry_fail 4 "$partial"
    fi
    if [ "${#new_files[@]}" -gt 0 ]; then
      git rm -q --cached -- "${new_files[@]}" >/dev/null 2>&1 || carry_fail 4 "$partial"
      rm -- "${new_files[@]}" || carry_fail 4 "$partial"
    fi
    echo "Transporte concluído; staged/unstaged não preservado. Backup: $backup"
    ;;

  safe-remove-worktree)
    requested="${2:?uso: vetor-checks.sh safe-remove-worktree <path>}"
    caller_pwd=$(pwd -P 2>/dev/null || pwd)
    # Issue #531: o path pedido fica em `requested` para as mensagens; `target` só recebe o
    # path resolvido quando ele existe em disco.
    if ! target=$(cd "$requested" 2>/dev/null && pwd -P); then
      # Ausente em disco: se o git também já o desregistrou, o cleanup já aconteceu (sucesso).
      # Se ainda está registrado, é inconsistência real (diretório apagado à mão) e segue erro.
      # Normaliza o path (sem a raiz existir): tira barra final, resolve relativo contra o cwd e
      # resolve o ancestral existente mais próximo com `pwd -P` (symlinks); no Windows/Git Bash
      # converte para a forma POSIX e ignora caixa. Aplicado aos dois lados da comparação.
      norm_missing_path() {
        local p="$1" rest="" base head
        case "$(uname -s 2>/dev/null)" in
          MINGW*|MSYS*|CYGWIN*) p=$(cygpath -u "$p" 2>/dev/null || printf '%s' "$p") ;;
        esac
        while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do p="${p%/}"; done
        case "$p" in /*) ;; *) p="$caller_pwd/$p" ;; esac
        while [ "${#p}" -gt 1 ] && ! [ -d "$p" ]; do
          base="${p##*/}"
          head="${p%/*}"
          [ -n "$head" ] || head="/"
          case "$base" in
            ""|".") ;;
            *) rest="/$base$rest" ;;
          esac
          p="$head"
        done
        p=$(cd "$p" 2>/dev/null && pwd -P || printf '%s' "$p")
        [ "$p" = "/" ] && [ -n "$rest" ] && p=""
        p="$p$rest"
        case "$(uname -s 2>/dev/null)" in
          MINGW*|MSYS*|CYGWIN*) p=$(printf '%s' "$p" | tr '[:upper:]' '[:lower:]') ;;
        esac
        printf '%s' "$p"
      }
      if ! wt_list=$(git worktree list --porcelain 2>&1); then
        echo "ERRO: não foi possível consultar git worktree list para $requested: $wt_list" >&2
        exit 1
      fi
      requested_norm=$(norm_missing_path "$requested")
      registered_missing=0
      while IFS= read -r line; do
        case "$line" in
          "worktree "*)
            if [ "$(norm_missing_path "${line#worktree }")" = "$requested_norm" ]; then
              registered_missing=1
              break
            fi
            ;;
        esac
      done <<< "$wt_list"
      if [ "$registered_missing" -eq 1 ]; then
        echo "ERRO: worktree para cleanup não encontrado em disco, mas ainda registrado no git: $requested" >&2
        exit 1
      fi
      echo "Worktree $requested já removido (ausente em disco e fora de git worktree list); nada a fazer."
      exit 0
    fi

    # Issue #411: detecta se o cwd atual da sessão está dentro do path alvo (ou é ele mesmo).
    # No Windows, manter o cwd dentro do diretório trava o handle do SO e impede remoção.
    cwd_in_target=0
    caller_pwd_norm="$caller_pwd"
    target_norm="$target"
    case "$(uname -s 2>/dev/null)" in
      MINGW*|MSYS*|CYGWIN*)
        caller_pwd_norm=$(printf '%s' "$caller_pwd" | tr '[:upper:]' '[:lower:]')
        target_norm=$(printf '%s' "$target" | tr '[:upper:]' '[:lower:]')
        ;;
    esac
    case "$caller_pwd_norm" in
      "$target_norm"|"$target_norm"/*) cwd_in_target=1 ;;
    esac
    pwd_norm="${PWD:-}"
    if [ -n "$pwd_norm" ]; then
      case "$(uname -s 2>/dev/null)" in
        MINGW*|MSYS*|CYGWIN*)
          pwd_norm=$(printf '%s' "$pwd_norm" | tr '[:upper:]' '[:lower:]')
          ;;
      esac
      case "$pwd_norm" in
        "$target_norm"|"$target_norm"/*) cwd_in_target=1 ;;
      esac
    fi

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

    # Issue #324: git worktree remove pode sair != 0 mesmo tendo desregistrado o worktree
    # (ex.: falha ao apagar o diretório por Permission Denied transitório no Windows).
    # Reconsulta se o worktree ainda está registrado no git.
    still_registered=0
    target_real=$(cd "$target" 2>/dev/null && pwd -P || echo "$target")
    while IFS= read -r line; do
      case "$line" in
        "worktree "*)
          wt_candidate="${line#worktree }"
          wt_candidate_real=$(cd "$wt_candidate" 2>/dev/null && pwd -P || echo "$wt_candidate")
          if [ "$wt_candidate" = "$target" ] || [ "$wt_candidate_real" = "$target_real" ]; then
            still_registered=1
            break
          fi
          ;;
      esac
    done < <(git worktree list --porcelain)

    if [ "$still_registered" -eq 1 ]; then
      echo "ERRO: git worktree remove recusou remover '$target' (worktree ainda registrado — possível uncommitted work). Resolva manualmente (git worktree remove --force, se apropriado) antes de prosseguir." >&2
      exit 1
    fi

    # Se já foi desregistrado do git, o diretório em disco é resíduo seguro de remover:
    if [ -d "$target" ]; then
      rmdir "$target" 2>/dev/null || true
      if [ -d "$target" ]; then
        case "$(uname -s 2>/dev/null)" in
          MINGW*|MSYS*|CYGWIN*)
            # Contorna o limite de path do Windows com o prefixo \\?\, que aceita paths > 260 chars.
            win_path=$(cygpath -w "$target" 2>/dev/null) || win_path=""
            if [ -n "$win_path" ]; then
              cmd //c rd /s /q "\\\\?\\$win_path" 2>/dev/null || true
            fi
            ;;
          *)
            rm -rf "$target" 2>/dev/null || true
            ;;
        esac
      fi
    fi

    if [ -d "$target" ]; then
      if [ "$cwd_in_target" -eq 1 ]; then
        echo "ERRO: git worktree remove desregistrou '$target' do git, mas o diretório permanece em disco porque o diretório de trabalho atual ($caller_pwd) está dentro dele. Mude para fora do worktree (ex.: cd \"\$(vetor-checks.sh repo-root)\") e remova o diretório residual manualmente." >&2
      else
        echo "ERRO: git worktree remove desregistrou '$target' do git, mas o diretório permanece em disco (possível 'Filename too long' no Windows). Remova manualmente antes de prosseguir." >&2
      fi
      exit 1
    fi
    ;;

  sync-root)
    # Tenta retornar a raiz do repo para a branch default se a branch atual estiver limpa
    # e sem commits locais pendentes vs remote (ou sem remote tracker caso já deletada).
    # Issue #322: quando o root já está na branch default, faz fetch e ff-only para que
    # a onda seguinte não nasça defasada em relação a origin/$DEFAULT_BRANCH.
    common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
    ROOT=""
    [ -n "$common_dir" ] && ROOT=$(dirname "$common_dir")
    [ -z "$ROOT" ] && exit 0
    cd "$ROOT" || exit 0
    
    DEFAULT_BRANCH=$("$0" default-branch)
    current=$(git branch --show-current 2>/dev/null)
    [ -z "$current" ] && exit 0

    # 1. Verifica se tem uncommitted changes
    if ! git diff-index --quiet HEAD --; then
      echo "AVISO: root tem mudanças pendentes na branch $current. Não sincronizando." >&2
      exit 0
    fi

    # Se já está na branch default:
    if [ "$current" = "$DEFAULT_BRANCH" ]; then
      git fetch origin "$DEFAULT_BRANCH" >/dev/null 2>&1 || true
      if git merge-base --is-ancestor HEAD "origin/$DEFAULT_BRANCH" 2>/dev/null; then
        if [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$DEFAULT_BRANCH" 2>/dev/null)" ]; then
          git merge --ff-only "origin/$DEFAULT_BRANCH" >/dev/null 2>&1
          echo "Root em $DEFAULT_BRANCH sincronizado com origin/$DEFAULT_BRANCH (fast-forward)."
        else
          echo "Root já está em $DEFAULT_BRANCH e atualizado com origin/$DEFAULT_BRANCH."
        fi
      elif git merge-base --is-ancestor "origin/$DEFAULT_BRANCH" HEAD 2>/dev/null; then
        echo "Root já está em $DEFAULT_BRANCH (à frente de origin/$DEFAULT_BRANCH)."
      else
        echo "AVISO: root em $DEFAULT_BRANCH divergiu de origin/$DEFAULT_BRANCH." >&2
      fi
      exit 0
    fi
    
    # 2. Se está em outra branch, verifica se tem commits que não estão na default
    if ! git merge-base --is-ancestor HEAD "origin/$DEFAULT_BRANCH" 2>/dev/null; then
      echo "AVISO: root está na branch $current que possui commits não integrados em origin/$DEFAULT_BRANCH. Não mudando para $DEFAULT_BRANCH." >&2
      exit 0
    fi
    
    git checkout "$DEFAULT_BRANCH" >/dev/null 2>&1 || { echo "ERRO: Falha ao mudar para a branch $DEFAULT_BRANCH." >&2; git checkout "$current" >/dev/null 2>&1; exit 1; }
    git fetch origin "$DEFAULT_BRANCH" >/dev/null 2>&1 || true
    git merge --ff-only "origin/$DEFAULT_BRANCH" >/dev/null 2>&1 || git pull origin "$DEFAULT_BRANCH" >/dev/null 2>&1
    echo "Root sincronizado com $DEFAULT_BRANCH (branch anterior: $current estava limpa e mesclada)."
    ;;

  delete-merged-branch)
    # Issue #341: apaga branch local após merge squash se confirmada como MERGED no remoto
    # ou com árvore idêntica à branch default (evita recusa de git branch -d e bypassa o
    # bloqueio incondicional de git branch -D do safety hook de forma segura).
    branch="${2:?uso: vetor-checks.sh delete-merged-branch <branch>}"
    if ! git show-ref --verify --quiet "refs/heads/$branch"; then
      echo "Branch $branch não existe localmente (já removida)."
      exit 0
    fi
    
    DEFAULT_BRANCH=$("$0" default-branch)
    pr_state=$(gh pr list --head "$branch" --state all --json state -q '.[0].state' 2>/dev/null || echo "")
    tree_identical=0
    # origin/<default> cobre a branch criada pelo --carry-changes a partir da referência remota
    # (#428), quando a default local está atrás porque o root sujo não recebeu pull.
    if git diff --quiet "$branch" "$DEFAULT_BRANCH" 2>/dev/null \
      || git diff --quiet "$branch" "origin/$DEFAULT_BRANCH" 2>/dev/null; then
      tree_identical=1
    fi

    if [ "$pr_state" = "MERGED" ] || [ "$tree_identical" -eq 1 ]; then
      git update-ref -d "refs/heads/$branch"
      echo "Branch local $branch removida com sucesso (mergeada ou idêntica à $DEFAULT_BRANCH)."
      exit 0
    else
      echo "ERRO: branch $branch não está confirmada como MERGED nem idêntica a $DEFAULT_BRANCH. Não removendo." >&2
      exit 1
    fi
    ;;

  clean-status)
    # Issue #344: normaliza a branch (<branch com / trocada por ->) e remove status file,
    # sentinela .stopguard e cache de touched-files.
    branch="${2:?uso: vetor-checks.sh clean-status <branch>}"
    sanitized="${branch//\//-}"
    common_dir=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
    ROOT=""
    [ -n "$common_dir" ] && ROOT=$(dirname "$common_dir")
    [ -z "$ROOT" ] && ROOT="."
    
    status_dir="$ROOT/.claude/vetor/status"
    rm -f "$status_dir/${sanitized}.md"
    rm -f "$status_dir/${sanitized}.md.stopguard"
    rm -f "$status_dir/${sanitized}-touched-files.json"
    rm -f "$status_dir/${sanitized}-preship.json"
    rm -f "$status_dir/${sanitized}-review.md"
    echo "Status e sentinelas da branch $branch ($sanitized) removidos com sucesso."
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
    echo "uso: vetor-checks.sh <default-branch|repo-root|in-worktree|migrations|debug-scan <base-branch>|validate-issue-ref <valor>|carry-changes <worktree-path> <branch>|safe-remove-worktree <path>|sync-root|worktree-audit|find-orphan-status [dir]|archive-orphan-status <path>|architectural-risk [map] [days]|check-disjoint <candidata> <outra>...|auto-ship-gates <PR> <worktree-path>|prepare <worktree> <issue#...>|finalize <PR> <branch>>" >&2
    exit 2
    ;;
esac

exit 0
