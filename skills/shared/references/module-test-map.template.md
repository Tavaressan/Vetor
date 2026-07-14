# Module Test Map — TEMPLATE

> **Este é um template.** Copie-o para o seu projeto e preencha com os comandos do
> SEU repositório:
>
> ```bash
> mkdir -p .claude/vetor
> cp "$CLAUDE_PLUGIN_ROOT/skills/shared/references/module-test-map.template.md" \
>    .claude/vetor/module-test-map.md
> # edite .claude/vetor/module-test-map.md
> ```
>
> As skills `worktree-ship`, `fix-loop-agent` e `guardian` procuram a cópia preenchida
> em `.claude/vetor/module-test-map.md`. Se ela não existir, tentam auto-detectar os
> comandos a partir de `.github/workflows/*.yml`; só então recorrem a este template.

Referência canônica dos comandos de teste headless por módulo. O ideal é derivá-la do
seu pipeline de CI (ex.: `.github/workflows/ci.yml`).

---

## Comandos por módulo

Substitua as linhas abaixo pelos módulos e comandos do seu projeto. Cada comando deve
ser **headless** (sem interação) e retornar exit code 0 em caso de sucesso.

| Módulo            | Comando headless                                  | Notas |
|-------------------|---------------------------------------------------|-------|
| `<seu-modulo-1>`  | `<comando de format + lint + test>`               | `<observações>` |
| `<seu-modulo-2>`  | `<comando de build + test>`                        | `<observações>` |
| `<modulo-integ>`  | `<comando de testes de integração>`                | Requer serviço externo (DB etc.); pular em sandbox e reportar "skipped (requires <dep>)" |

<!--
Exemplo ilustrativo (remova após preencher):

| `api`           | `cd api && deno task test`                              | Deno; deps vêm do cache global |
| `core`          | `cd core && deno test -A`                               | Deno sem task `test` definida |
| `backend`       | `cd backend && npm ci && npm run lint && npm test`      | Node: lint + unit |
| `backend-integ` | `cd backend && npm run test:integration`                | Requer DB vivo; pular em sandbox |
-->

## Detecção de módulo por arquivos alterados

Para determinar qual módulo testar, inspecione `git diff <default-branch> --name-only`
e mapeie os prefixos de path aos módulos:

| Prefixo do path     | Módulo            |
|---------------------|-------------------|
| `<seu-modulo-1>/`   | `<seu-modulo-1>`  |
| `<seu-modulo-2>/`   | `<seu-modulo-2>`  |

Se arquivos de múltiplos módulos foram alterados, execute todos os módulos afetados em
sequência.

## Regras de execução

### Regra sandbox
- **Docker:** uma tentativa por sessão; se bloqueado pelo usuário ou pelo sistema, troca
  permanentemente para comandos headless desta tabela.
- **Docker isolado:** usar `docker compose -p <slug>` para evitar conflito de portas entre
  worktrees paralelos.
- **Testes que exigem serviço externo (DB, broker, etc.):** só executar em ambiente com a
  dependência disponível (docker ou CI); em headless, pular e reportar como
  "skipped (requires <dep>)" no sumário.

### Exclusões obrigatórias
Todo `find` ou `grep` executado pelos skills deve excluir:
- `.claude/worktrees/*` — evita contaminação por worktrees aninhados
- `node_modules/`, `target/`, `.next/`, `__pycache__/`, `.venv/`, `build/`, `dist/`
