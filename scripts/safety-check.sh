#!/bin/bash
# Safety check and auto-formatting script for Vetor plugin running on Google Antigravity.
# Intercepts and validates shell commands before execution.

COMMAND="$@"

# 1. Block git push to protected branches
if [[ "$COMMAND" =~ "git push" ]]; then
  # Extract the git push command (before any && or ||)
  push_cmd=$(echo "$COMMAND" | sed 's/^\(.*git push[^&|]*\).*/\1/')

  # Extract the destination branch from the git push command
  # Pattern: git push [options] [remote] <branch>
  # Use grep + sed to capture the branch name (last non-flag argument)
  # This handles cases like:
  #   git push origin branch-name
  #   git push origin branch-name:remote-name
  #   git push --force origin branch-name
  dest_branch=$(echo "$push_cmd" | grep -oE '[^ ]+(:[^ ]+)?$' | sed 's/:.*$//')

  # Check if the destination branch is a protected branch
  if [[ "$dest_branch" == "main" ]] || [[ "$dest_branch" == "master" ]] || [[ "$dest_branch" == "production" ]]; then
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
