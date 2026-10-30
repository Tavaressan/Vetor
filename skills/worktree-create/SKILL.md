---
name: worktree-create
description: Criação headless de worktree — sem prompts interativos, todos os parâmetros via args. Primitivo usado pelo coordinator e disponível como slash command standalone.
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
/vetor:worktree-create <type> <slug> [issue#] [--carry-changes]
/vetor:worktree-create --from-branch <branch>
```

- `<type>`: obrigatório — um de `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `ci`
- `<slug>`: obrigatório — kebab-case, máximo 30 caracteres (ex.: `embedding-retry`, `auth-refresh`)
- `[issue#]`: opcional — número inteiro da issue GitHub
- `[--carry-changes]`: opcional — transporta mudanças rastreadas do root (uso standalone)

---

## Comportamento

### 1 — Validação de args

Verifique os argumentos recebidos usando o script determinístico:

```bash
[ -z "$issue_ref" ] || scripts/vetor-checks.sh validate-issue-ref "$issue_ref" || exit 1
```

Valide também:

- Se `<type>` não for um dos valores aceitos (`feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `ci`):
  ```
  ERRO: tipo inválido "<type>". Valores aceitos: feat, fix, chore, refactor, docs, test, ci
  ```
  Aborte.

- Se `<slug>` não for kebab-case ou tiver mais de 30 caracteres:
  ```
  ERRO: slug inválido "<slug>". Use kebab-case com no máximo 30 caracteres.
  ```
  Aborte.

### 2 — Derivar nomes

Detecte a branch default do repositório: leia `../shared/references/project-conventions.md` e resolva `$DEFAULT_BRANCH` conforme descrito lá (não assuma `master`).

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

### 4 — Atualizar root e criar worktree

Antes de qualquer `git pull`, detecte mudanças rastreadas (o `update-index` evita acusar root sujo
só porque o mtime de um arquivo mudou):

```bash
git update-index -q --refresh
git diff-index --quiet HEAD --
```

Se o comando indicar root sujo sem `--carry-changes`, aborte antes de `pull` ou `worktree add` e liste somente os nomes:

```bash
git diff HEAD --name-only
```

Informe que a opção `--carry-changes` permite transportar essas mudanças. Se o root estiver limpo, mantenha o fluxo atual, com ou sem a opção:

```bash
git pull origin "$DEFAULT_BRANCH"
git worktree add -b <branch> .claude/worktrees/<slug> "$DEFAULT_BRANCH"
```

Se `git pull` falhar, continue da branch default local e avise como no fluxo existente. Se `git worktree add` falhar, aborte.

Com root sujo e `--carry-changes`, nunca rode `git pull` — atualize só a referência remota e crie o worktree a partir dela:

```bash
git fetch origin "$DEFAULT_BRANCH"
git worktree add -b <branch> .claude/worktrees/<slug> "origin/$DEFAULT_BRANCH"
deno run -A "$SKILL_DIR/../../scripts/prepare-worktree.ts" --path .claude/worktrees/<slug>
bash "$SKILL_DIR/../../scripts/vetor-checks.sh" carry-changes .claude/worktrees/<slug> <branch>
```

Se o `git fetch` falhar, avise e crie o worktree a partir da branch default local
(`git worktree add -b <branch> .claude/worktrees/<slug> "$DEFAULT_BRANCH"`), seguindo com o
`prepare-worktree` e o `carry-changes` normalmente. O subcomando cria um único patch do diff
rastreado total (renames viram remoção + criação), aplica-o com `git apply --3way`, verifica
ausência de entradas não mescladas e presença de todos os arquivos alterados, salva o backup em
`.claude/vetor/carry/<branch com / trocada por ->.patch` (diretório que se auto-ignora) e só então
limpa do root os arquivos transportados. Nunca mostre o conteúdo do patch; mensagens listam
somente paths. Staged/unstaged não é preservado: tudo chega como alteração não staged no worktree.

Se `carry-changes` falhar:

- **exit 3** (falhou antes do backup — conflito, aplicação ou verificação): o root está intacto e o
  worktree já foi devolvido a `HEAD`. Remova o worktree com `bash "$SKILL_DIR/../../scripts/vetor-checks.sh" safe-remove-worktree .claude/worktrees/<slug>`
  e a branch com `bash "$SKILL_DIR/../../scripts/vetor-checks.sh" delete-merged-branch <branch>`,
  liste os paths reportados e aborte. Oriente resolver as mudanças manualmente e repetir a criação.
- **exit 4** (transporte feito, limpeza do root incompleta): **não remova o worktree** — ele já
  tem as mudanças. Informe o backup e os paths reportados e oriente concluir a limpeza do root à mão.
- **exit 1** (nada a transportar ou erro antes da aplicação): o root está intacto; remova o worktree
  e a branch como no exit 3 e aborte.

### 4.a — Modo `--from-branch` (PR sem worktree local, issue #527)

Recria um worktree para uma branch que já existe no remoto (PR preparado em outra máquina). Pula os
passos 1 a 4. Se a branch ou o path `.claude/worktrees/<slug>` (slug = branch com `/` trocada por `-`)
já existirem localmente, aborte como no passo 3.

```bash
git fetch origin <branch>
git worktree add -b <branch> .claude/worktrees/<slug> origin/<branch>
```

Siga com 4.b e 5. Nunca use `git branch -D` nem `reset --hard`.

### 4.b — Preparar dependências

Delegue ao script determinístico — ele detecta o runtime e faz o que couber (Deno puro é no-op,
pois o cache `$DENO_DIR` já é global; Node ganha um link para o `node_modules` da raiz):

> O path relativo abaixo resolve a partir do diretório desta própria skill (informado ao carregar,
> ex. "Base directory for this skill: ..."), não do `cwd` de execução — defina uma vez:
> ```bash
> SKILL_DIR="<path absoluto informado como 'Base directory for this skill' no carregamento>"
> ```
> e use `"$SKILL_DIR/../../scripts/..."` em todo comando abaixo, nunca o path relativo isolado.

```bash
deno run -A "$SKILL_DIR/../../scripts/prepare-worktree.ts" --path .claude/worktrees/<slug>
```

No fluxo `--carry-changes`, não repita esta chamada: o passo 4 já prepara o worktree antes do transporte. Nos demais casos, execute o script. Ele é tolerante a falhas: avisa em stderr e sai com 0 mesmo se a preparação falhar. Prossiga
normalmente — o worker instala o que faltar.

> No fluxo do `coordinator`, o worktree é criado pelo harness (`isolation: "worktree"`) e a
> preparação roda sozinha via hook `WorktreeCreate`. Esta chamada só é necessária aqui, no uso
> standalone do skill. A exceção é o pre-warming (RF-06), opt-in com `prewarmWorktrees: true` em
> `.claude/vetor/config.json`: aí o coordinator cria e prepara os worktrees da primeira onda
> antecipadamente com `scripts/prewarm-worktrees.ts` (`../shared/references/worktree-prewarm.md`).

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
- Nunca faça push ou crie PR — isso é responsabilidade do `ship`
- Se invocado como primitivo por outro skill (ex.: `coordinator`), o `EnterWorktree` afeta apenas a sessão local do invocador
