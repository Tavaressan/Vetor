#!/bin/bash
# Safety check and auto-formatting script for Vetor plugin running on Google Antigravity.
# Intercepts and validates shell commands before execution.

COMMAND="$@"

# 1. Block git push to protected branches
if [[ "$COMMAND" =~ "git push" ]]; then
  if [[ "$COMMAND" =~ "main" || "$COMMAND" =~ "master" || "$COMMAND" =~ "production" ]]; then
    echo "ERROR: Push to protected branches (main, master, production) is prohibited by Vetor Safety Hook." >&2
    exit 1
  fi
fi

# 2. Intercept git commit for smart formatting / pre-commit integration
if [[ "$COMMAND" =~ "git commit" ]]; then
  STAGED_FILES=$(git diff --name-only --cached 2>/dev/null)
  
  if [ -n "$STAGED_FILES" ]; then
    if [ -f ".pre-commit-config.yaml" ]; then
      echo "[Vetor:Hook] pre-commit detectado no repositório. Executando hooks do projeto..."
      # Run pre-commit on staged files
      if command -v pre-commit >/dev/null 2>&1; then
        pre-commit run --files $STAGED_FILES
        # Re-add files in case hooks formatted them
        git add $STAGED_FILES
      else
        echo "WARNING: .pre-commit-config.yaml exists but pre-commit CLI is not installed." >&2
      fi
    else
      echo "[Vetor:Hook] pre-commit não detectado. Executando formatadores fallback..."
      # Fallback formatting for Javascript / Typescript
      if command -v prettier >/dev/null 2>&1; then
        JS_TS_FILES=$(echo "$STAGED_FILES" | grep -E '\.(js|ts|jsx|tsx)$')
        if [ -n "$JS_TS_FILES" ]; then
          echo "Formatting JS/TS files with Prettier..."
          prettier --write $JS_TS_FILES && git add $JS_TS_FILES
        fi
      fi
      
      # Fallback formatting for Python
      if command -v black >/dev/null 2>&1; then
        PY_FILES=$(echo "$STAGED_FILES" | grep -E '\.py$')
        if [ -n "$PY_FILES" ]; then
          echo "Formatting Python files with Black..."
          black $PY_FILES && git add $PY_FILES
        fi
      fi

      # Fallback formatting for Rust
      if command -v rustfmt >/dev/null 2>&1; then
        RS_FILES=$(echo "$STAGED_FILES" | grep -E '\.rs$')
        if [ -n "$RS_FILES" ]; then
          echo "Formatting Rust files with rustfmt..."
          rustfmt $RS_FILES && git add $RS_FILES
        fi
      fi
    fi
  fi
fi

exit 0
