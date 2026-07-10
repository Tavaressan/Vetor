#!/bin/bash
# Auto-detection script for project testing structure
# Generates .claude/vetor/module-test-map.md automatically.

TARGET_DIR=".claude/vetor"
TARGET_FILE="$TARGET_DIR/module-test-map.md"

if [ -f "$TARGET_FILE" ]; then
  echo '{"status": "skipped", "reason": "already_exists"}'
  exit 0
fi

mkdir -p "$TARGET_DIR"

# Detect project language and packages
LENG="unknown"
TEST_CMD="echo 'No test command found' && exit 1"
DETECTED_MODULES=""

# Scan files in root to detect project type
if [ -f "package.json" ]; then
  LENG="nodejs"
  TEST_CMD="npm test"
  if [ -f "pnpm-lock.yaml" ]; then
    TEST_CMD="pnpm test"
  elif [ -f "yarn.lock" ]; then
    TEST_CMD="yarn test"
  fi
elif [ -f "Cargo.toml" ]; then
  LENG="rust"
  TEST_CMD="cargo test"
elif [ -f "go.mod" ]; then
  LENG="go"
  TEST_CMD="go test ./..."
elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ] || [ -f "poetry.lock" ]; then
  LENG="python"
  TEST_CMD="pytest"
fi

# Detect modules (subfolders excluding build, tests, doc, git, etc.)
MODULE_MAPPING=""
# Find top-level subdirectories that look like modules (contain config files or are code folders)
for dir in */; do
  dir=${dir%/} # remove trailing slash
  if [[ "$dir" =~ ^(\.git|\.github|\.claude|node_modules|target|build|dist|venv|\.venv|tests|docs|legacy)$ ]]; then
    continue
  fi
  
  # Check if directory exists
  if [ -d "$dir" ]; then
    # Add mapping
    MODULE_MAPPING="${MODULE_MAPPING}| \`${dir}/\` | \`${dir}\` |"$'\n'
    
    # Try to detect technology inside the folder
    module_cmd="$TEST_CMD"
    if [ -f "$dir/package.json" ]; then
      module_cmd="npm test"
      [ -f "$dir/pnpm-lock.yaml" ] && module_cmd="pnpm test"
      [ -f "$dir/yarn.lock" ] && module_cmd="yarn test"
      module_cmd="cd $dir && $module_cmd"
    elif [ -f "$dir/Cargo.toml" ]; then
      module_cmd="cd $dir && cargo test"
    elif [ -f "$dir/go.mod" ]; then
      module_cmd="cd $dir && go test ./..."
    elif [ -f "$dir/requirements.txt" ] || [ -f "$dir/pyproject.toml" ]; then
      module_cmd="cd $dir && pytest"
    elif [ -f "$dir/build.gradle" ] || [ -f "$dir/build.gradle.kts" ] || [ -f "$dir/gradlew" ]; then
      module_cmd="cd $dir && ./gradlew test"
    else
      # Nothing found at this level; look one level below for nested modules
      nested_dir=""
      for sub in "$dir"/*/; do
        sub=${sub%/}
        if [ -f "$sub/package.json" ] || [ -f "$sub/requirements.txt" ] || [ -f "$sub/pyproject.toml" ]; then
          nested_dir="$sub"
          break
        fi
      done

      if [ -n "$nested_dir" ] && [ -f "$nested_dir/package.json" ]; then
        nested_cmd="npm test"
        [ -f "$nested_dir/pnpm-lock.yaml" ] && nested_cmd="pnpm test"
        [ -f "$nested_dir/yarn.lock" ] && nested_cmd="yarn test"
        module_cmd="cd $nested_dir && $nested_cmd"
      elif [ -n "$nested_dir" ]; then
        module_cmd="cd $nested_dir && pytest"
      elif [ "$LENG" != "unknown" ]; then
        # fallback command
        module_cmd="cd $dir && $TEST_CMD"
      else
        module_cmd="cd $dir && echo 'Run tests' && exit 0"
      fi
    fi
    DETECTED_MODULES="${DETECTED_MODULES}| \`${dir}\` | \`${module_cmd}\` | Auto-detectado |"$'\n'
  fi
done

# If no directories detected, use root
if [ -z "$DETECTED_MODULES" ]; then
  DETECTED_MODULES="| \`root\` | \`${TEST_CMD}\` | Módulo raiz do projeto |"$'\n'
  MODULE_MAPPING="| \`./\` | \`root\` |"$'\n'
fi

# Write file
cat <<EOF > "$TARGET_FILE"
# Module Test Map — Auto-Generated

Este arquivo foi gerado automaticamente pelo script de auto-detecção do Vetor.
Ajuste os comandos e mapeamentos conforme necessário para o seu projeto.

---

## Comandos por módulo

| Módulo | Comando headless | Notas |
|--------|------------------|-------|
$DETECTED_MODULES
## Detecção de módulo por arquivos alterados

| Prefixo do path | Módulo |
|-----------------|--------|
$MODULE_MAPPING
## Regras de execução

### Regras Sandbox e Exclusões
Todo comando executado pelas skills deve excluir pastas de builds e dependências padrão.
EOF

echo "{\"status\": \"created\", \"language\": \"$LENG\", \"path\": \"$TARGET_FILE\"}"
exit 0
