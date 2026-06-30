---
name: worktree-create
description: Criação headless de worktree — sem prompts interativos, todos os parâmetros via args. Primitivo usado pelo issue-coordinator e disponível como slash command standalone.
license: Proprietary
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

Detecte a branch default do repositório (não assuma `master`):

```bash
DEFAULT_BRANCH=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | sed -n '/HEAD branch/s/.*: //p')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH=master
```

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
