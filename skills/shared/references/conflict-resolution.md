# Resolução de conflitos de merge

Procedimento compartilhado, usado pelo `worktree-ship` (passos 2 e 10) quando `git merge` da branch
default deixa arquivos conflitantes.

## 1 — Identificar os conflitos

```bash
git diff --name-only --diff-filter=U
```

## 2 — Lockfiles (KISS/YAGNI)

Para arquivos de lock na lista (`deno.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
`Cargo.lock`, `poetry.lock`):

1. `git checkout --theirs <lockfile-path>` — aceita a versão da branch default e limpa os marcadores.
2. Execute o instalador do projeto (`deno install`, `npm install`, `pnpm install`, `cargo build`,
   `poetry lock --no-update`) para que o próprio gerenciador regenere o lockfile reconciliado. O
   `runtime` gravado em `.claude/vetor/config.json` diz qual usar.
3. `git add <lockfile-path>`

Nunca mescle lockfile à mão.

## 3 — Conflitos aditivos em listas

Quando dois workers paralelos editam **a mesma linha** de um campo que agrega itens (scripts de
`package.json`, arrays JSON, strings concatenadas com `&&`) e **ambos os lados só adicionam**, aplique
**união aditiva** em vez de escolher um lado:

```json
<<<<<<< HEAD
"scripts": { "test": "jest unit && npm run lint" }
=======
"scripts": { "test": "jest unit && npm run e2e" }
>>>>>>> origin/master
```

Resolução:

```json
"scripts": { "test": "jest unit && npm run lint && npm run e2e" }
```

Remova duplicatas do resultado e `git add <arquivo>`.

Se um dos lados **remove** algo que o outro mantém, não é conflito aditivo — trate como código (§4).

## 4 — Demais arquivos de código

Localize os marcadores (`<<<<<<<`, `=======`, `>>>>>>>`), mescle logicamente as regras de negócio e
remova os marcadores.

## 5 — Validar

1. Execute os testes do módulo correspondente via `module-test-map`.
2. **Verde:** commite (`merge branch '$DEFAULT_BRANCH' and resolve conflicts`), `git push origin <branch>`.
3. **Vermelho:** chame o `fix-loop-agent` localmente. Se as iterações estourarem sem verde, aborte o
   merge, preserve o worktree e alerte o usuário.
