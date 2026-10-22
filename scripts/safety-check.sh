#!/usr/bin/env bash
# Safety gate do Vetor — adaptador para o runner multiplataforma Node.js.
#
# Antigravity invoca hooks.json diretamente via `node ./scripts/safety-check-antigravity.js`.
# Este script preserva compatibilidade caso seja invocado diretamente em ambientes Bash.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$script_dir/safety-check-antigravity.js" "$@"
