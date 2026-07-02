---
name: worktree-create
description: Criação headless de worktree — sem prompts interativos, todos os parâmetros via args. Primitivo usado pelo issue-coordinator e disponível como slash command standalone.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.0"
---

Você é o primitivo de criação de worktree do Vetor. Sua única responsabilidade é criar um worktree Git isolado de forma determinística, sem perguntas ao usuário.

---

## Sintaxe

```
/worktree-create <type> <slug> [issue#]
```

- `<type>`: obrigatório — um de `feat`, `fix`, `chore`, `refactor`
- `<slug>`: obrigatório — kebab-case, máximo 30 caracteres (ex.: `embedding-retry`, `auth-refresh`)
- `[issue#]`: opcional — número inteiro da issue GitHub

---

## Comportamento

### 1 — Validação de args

Verifique os argumentos recebidos:

- Se `<type>` não for um dos valores aceitos (`feat`, `fix`, `chore`, `refactor`):
  ```
  ERRO: tipo inválido "<type>". Valores aceitos: feat, fix, chore, refactor
  ```
  Aborte.

- Se `<slug>` não for kebab-case ou tiver mais de 30 caracteres:
  ```
  ERRO: slug inválido "<slug>". Use kebab-case com no máximo 30 caracteres.
  ```
  Aborte.

### 2 — Derivar nomes

Detecte a branch default do repositório: leia `$CLAUDE_PLUGIN_ROOT/skills/shared/references/project-conventions.md` e resolva `$DEFAULT_BRANCH` conforme descrito lá (não assuma `master`).

- **Branch:** `<type>/<issue#>-<slug>` se issue fornecida; `<type>/<slug>` caso contrário
- **Path:** `.claude/worktrees/<slug>`

### 3 — Verificar conflitos

Antes de criar, verifique se a branch ou o worktree já existem:

```bash
git branch --list "<branch>"
git worktree list | grep "<slug>"
```

Se qualquer um já existir:
```
ERRO: branch "<branch>" ou worktree ".claude/worktrees/<slug>" já existe.
Use outro slug ou remova o worktree existente com:
  git worktree remove .claude/worktrees/<slug>
  git branch -d <branch>
```
**Aborte.** Nunca entre silenciosamente em um worktree existente.

### 4 — Criar worktree

Execute em sequência:

```bash
git pull origin "$DEFAULT_BRANCH"

git worktree add -b <branch> .claude/worktrees/<slug> "$DEFAULT_BRANCH"
```

Se `git pull` falhar (ex.: rede indisponível), continue com a branch default local e avise:
```
AVISO: git pull falhou — criando worktree a partir da <default-branch> local.
```

Se `git worktree add` falhar, reporte o erro e aborte.

### 4.b — Preparar Dependências (Instalação Concorrente-Safe e Reuso de Cache)

Como a criação de worktrees é executada de forma serializada/sequencial, aproveite este momento seguro para preparar as dependências do novo diretório:
1. Verifique se `node_modules` já está presente no diretório do worktree `.claude/worktrees/<slug>` (isso ocorre se a configuração nativa do Claude Code `worktree.symlinkDirectories: ["node_modules"]` estiver ativa). Se já existir, pule a preparação de dependências do Node e prossiga.
2. Detecte o ecossistema do projeto-alvo a partir dos arquivos presentes no root.
3. Para projetos **Node** (onde exista `node_modules` no root do projeto principal e não esteja no worktree):
   - Crie as dependências no worktree `.claude/worktrees/<slug>` preferencialmente copiando ou linkando do root principal para evitar re-instalação lenta e prevenir conflitos com hooks de pre-commit (Husky/lint-staged):
     - **Link Simbólico (Rápido/Recomendado)**: Crie um link simbólico apontando para o `node_modules` do root:
       ```bash
       ln -s ../../../node_modules node_modules
       ```
     - **Cópia Otimizada (Clone CoW se link falhar ou para isolamento físico)**:
       - No macOS (APFS): `cp -Rc ../../../node_modules node_modules`
       - No Linux: `cp -a --reflink=auto ../../../node_modules node_modules`
   - Se o `node_modules` do root não existir, ou se a criação do link/cópia falhar, realize o fallback de instalação a partir do diretório do worktree:
     - **Node (pnpm)**: `pnpm install` (concorrente-safe e instantâneo via hard-links).
     - **Node (npm)**: `npm ci --prefer-offline --no-audit` (rápido e limpo).
     - **Node (yarn)**: `yarn install --prefer-offline`.
4. Para projetos **Python (poetry)**: Execute `poetry install --no-root` a partir do diretório do worktree.
5. Se a preparação de dependências falhar, imprima `AVISO: Falha ao preparar dependências no worktree. A compilação/teste local poderá falhar.`, mas continue (KISS/tolerância a falhas).

### 5 — Entrar no worktree

Use a ferramenta `EnterWorktree` com o path `.claude/worktrees/<slug>` para mudar o contexto de trabalho.

### 6 — Saída

Após criar e entrar no worktree com sucesso, imprima:

```json
{"branch": "<branch>", "path": ".claude/worktrees/<slug>", "issue": <N|null>}
```

E informe:
```
Worktree criado e ativado.
Branch: <branch>
Path: .claude/worktrees/<slug>
```

---

## Restrições

- Nunca faça perguntas ao usuário — todos os parâmetros vêm dos args
- Nunca entre em um worktree existente — sempre aborte com erro se houver conflito
- Nunca faça push ou crie PR — isso é responsabilidade do `worktree-ship`
- Se invocado como primitivo por outro skill (ex.: `issue-coordinator`), o `EnterWorktree` afeta apenas a sessão local do invocador
