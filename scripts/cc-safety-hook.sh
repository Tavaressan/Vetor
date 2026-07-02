#!/usr/bin/env bash
# Adaptador PreToolUse do Claude Code para o safety gate do Vetor.
#
# Contrato do Claude Code (code.claude.com/docs/en/hooks): o hook recebe um JSON
# no stdin com o comando em .tool_input.command e deve sair com código 2 para
# BLOQUEAR a chamada (exit 1 é erro não-bloqueante). Este adaptador extrai o
# comando e delega a política ao scripts/safety-check.sh compartilhado — que sai 1
# ao violar (push para branch protegida) — traduzindo 1 -> 2.
#
# O safety-check.sh permanece intocado para continuar servindo ao Antigravity, que
# usa outro contrato (hooks.json na raiz, matcher run_command).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT="$(cat)"
COMMAND="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input", {}).get("command", ""))' <<<"$INPUT")"

if [ -z "$COMMAND" ]; then
  exit 0
fi

STATUS=0
"$SCRIPT_DIR/safety-check.sh" "$COMMAND" || STATUS=$?

if [ "$STATUS" -eq 1 ]; then
  exit 2
fi

exit 0
