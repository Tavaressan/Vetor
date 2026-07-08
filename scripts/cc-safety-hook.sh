#!/usr/bin/env bash
# Adaptador PreToolUse do Claude Code para o safety gate do Vetor.
#
# Contrato do Claude Code (code.claude.com/docs/en/hooks): o hook recebe um JSON
# no stdin com o comando em .tool_input.command (e o diretório da chamada em .cwd)
# e deve sair com código 2 para BLOQUEAR a chamada (exit 1 é erro não-bloqueante).
# Este adaptador extrai comando+cwd e delega a política ao scripts/safety-check.sh
# compartilhado — que sai 1 ao violar — traduzindo 1 -> 2.
#
# O safety-check.sh permanece com contrato próprio para continuar servindo ao
# Antigravity (hooks.json na raiz, matcher run_command).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT="$(cat)"

# Fast bypass: safety-check.sh só age em "git push" e "gh pr (create|ready|merge)"
# (ver scripts/safety-check.sh) — evita 2x python3 por chamada para todo o resto.
if [[ ! "$INPUT" =~ git[[:space:]]+push ]] && [[ ! "$INPUT" =~ gh[[:space:]]+pr[[:space:]]+(create|ready|merge) ]]; then
  exit 0
fi

COMMAND="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input", {}).get("command", ""))' <<<"$INPUT")"
HOOK_CWD="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("cwd", ""))' <<<"$INPUT")"

if [ -z "$COMMAND" ]; then
  exit 0
fi

# A regra do worker não-GREEN lê git e status file relativos ao diretório da
# chamada interceptada — posicione o cwd antes de delegar a política.
if [ -n "$HOOK_CWD" ] && [ -d "$HOOK_CWD" ]; then
  cd "$HOOK_CWD"
fi

STATUS=0
"$SCRIPT_DIR/safety-check.sh" "$COMMAND" || STATUS=$?

if [ "$STATUS" -eq 1 ]; then
  exit 2
fi

exit 0
