# Module Test Map — Auto-Gerado

Gerado pela auto-detecção do Vetor (runtime: **deno**).
Revise os comandos: eles são executados de forma headless pelo `fix-loop-agent` e pelo `worktree-ship`.

---

## Comandos por módulo

| Módulo | Comando headless | Notas |
|--------|------------------|-------|
| `root` | `deno task test` | Módulo raiz |

## Detecção de módulo por arquivos alterados

| Prefixo do path | Módulo |
|-----------------|--------|
| `./` | `root` |

## Regras de execução

### Exclusões obrigatórias
Todo `find`/`grep` executado pelas skills deve excluir:
`.claude/worktrees/*`, `node_modules/`, `target/`, `build/`, `dist/`, `.venv/`, `__pycache__/`.
