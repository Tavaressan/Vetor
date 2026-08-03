#!/usr/bin/env bash
# Wrapper de PATH para o hook SessionStart (issue #115).
#
# hooks/hooks.json invoca `deno run -A scripts/session-check.ts` diretamente. Em ambientes
# sem Deno no PATH, isso falha com "deno: not found" cru, sem indicar que Deno é dependência
# do plugin nem como resolver. Este wrapper é shell puro (não depende do próprio deno) e
# checa a dependência antes de delegar ao script real.
#
# Contrato do Claude Code (hook SessionStart): exit 0 sempre; a mensagem acionável vai em
# hookSpecificOutput.additionalContext, igual ao que session-check.ts já faz.

set -uo pipefail

if ! command -v deno >/dev/null 2>&1; then
  message="Vetor: Deno não foi encontrado no PATH deste ambiente. O Vetor depende do Deno "
  message+="para rodar seus hooks (safety-check, preparação de worktree, auto-detecção). "
  message+="Instale com \`curl -fsSL https://deno.land/install.sh | sh\` e garanta que o "
  message+="binário fique num diretório já no PATH (ajuste \`DENO_INSTALL\` se o shell deste "
  message+="ambiente não carregar o profile, ex.: sandboxes). Veja a seção Pré-requisitos do "
  message+="README do plugin."
  # shellcheck disable=SC2016
  printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$message"
  exit 0
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec deno run -A "$script_dir/session-check.ts"
