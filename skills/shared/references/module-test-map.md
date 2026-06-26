# Module Test Map — Alfabra Vector

Referência canônica dos comandos de teste headless por módulo. Derivada de `.github/workflows/ci.yml`.
Consumida por `worktree-ship`, `fix-loop-agent` e `guardian`.

---

## Comandos por módulo

| Módulo | Comando headless | Notas |
|--------|-----------------|-------|
| `rust-services` | `cd rust-services && cargo fmt --all -- --check && cargo clippy --workspace -- -D warnings && cargo test --workspace` | Formato + lint + testes no workspace inteiro |
| `java-core` | `cd java-core && chmod +x gradlew && ./gradlew test` | Unitários; sem DB externo |
| `java-core-integ` | `cd java-core && chmod +x gradlew && ./gradlew integrationTest` | Requer PostgreSQL vivo; pular em sandbox e reportar "skipped (requires DB)" |
| `frontend` | `cd frontend && npm ci && npm run lint && npm test && npm run build` | Lint + unit + build completo |
| `python-services` | `pip install -r python-services/crew-worker/requirements.txt && pip install black flake8 pytest && black --check python-services && flake8 python-services --count --select=E9,F63,F7,F82 --show-source --statistics && pytest python-services --ignore=python-services/crew-worker/.venv \|\| [ $? -eq 5 ]` | Exit 5 (sem testes coletados) = OK |

## Detecção de módulo por arquivos alterados

Para determinar qual módulo testar, inspecione `git diff master --name-only` e mapeie os prefixos:

| Prefixo do path | Módulo |
|-----------------|--------|
| `rust-services/` | `rust-services` |
| `java-core/` | `java-core` |
| `java-core/src/main/resources/db/migration/` | `java-core` + `java-core-integ` (se DB disponível) |
| `frontend/` | `frontend` |
| `python-services/` | `python-services` |

Se arquivos de múltiplos módulos foram alterados, execute todos os módulos afetados em sequência.

## Regras de execução

### Regra sandbox (CLAUDE.md)
- **Docker:** uma tentativa por sessão; se bloqueado pelo usuário ou pelo sistema, troca permanentemente para comandos headless desta tabela
- **Docker isolado:** usar `docker compose -p <slug>` para evitar conflito de portas entre worktrees paralelos
- **`java-core-integ`:** só executar em ambiente com DB disponível (docker ou CI); em headless, pular e reportar como "skipped (requires DB)" no sumário

### Exclusões obrigatórias
Todo `find` ou `grep` executado pelos skills deve excluir:
- `.claude/worktrees/*` — evita contaminação por worktrees aninhados
- `node_modules/`, `target/`, `.next/`, `__pycache__/`, `.venv/`
