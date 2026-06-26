---
name: worktree-ship
description: Pipeline headless de entrega — test → push → PR draft → CI → merge → sync root → cleanup. Deve ser executado de dentro de um worktree.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.0"
---

Você é o pipeline de entrega do Alfabra Vector. Sua missão é levar código testado e verde de um worktree até o merge em master, sem intervenção manual exceto quando review é necessário.

---

## Sintaxe

```
/worktree-ship [issue#]
```

- `[issue#]`: opcional — número da issue GitHub para incluir `Closes #N` no PR

---

## Referência

Antes de executar testes, leia `.claude/skills/shared/references/module-test-map.md` para obter os comandos de teste do módulo e as regras de execução.

---

## Comportamento

### 1 — Guarda de contexto

Verifique se está dentro de um worktree:

```bash
git worktree list
```

Se o diretório atual for o root do repositório (e não um worktree em `.claude/worktrees/`):
```
ERRO: /worktree-ship deve ser executado de dentro de um worktree, não do root.
Use /worktree-create para criar um worktree primeiro.
```
**Aborte.**

Extraia a branch e o slug do worktree atual:
```bash
git branch --show-current
```

### 2 — Detecção de módulos alterados

```bash
git diff master --name-only
```

Mapeie os arquivos alterados aos módulos usando a tabela de detecção do `module-test-map.md`.

### 3 — Testes locais

Para cada módulo alterado, execute o comando headless correspondente do `module-test-map.md`.

**Regra sandbox:**
- Tente docker uma vez (se aplicável ao módulo, ex.: `java-core-integ`)
- Se bloqueado: troque permanentemente para o comando headless e registre no sumário
- `java-core-integ` sem DB: reporte "skipped (requires DB)" sem falhar

**Se algum teste falhar:**
```
FALHA: testes locais não passaram. Corrija antes de fazer ship.
Módulo: <módulo>
Saída: <últimas 30 linhas do log>
```
**Pare.** Não faça push de código vermelho.

### 4 — Push

```bash
git push -u origin <branch>
```

Se falhar por rede, tente até 4 vezes com backoff exponencial (2s, 4s, 8s, 16s).

### 5 — Criar PR draft

Construa o título a partir dos commits:
```bash
git log origin/master..HEAD --oneline
```

Crie o PR:
```bash
gh pr create \
  --title "<type>(<slug>): <resumo dos commits>" \
  --body "$(cat <<'EOF'
## Resumo
- <bullet points das mudanças principais, derivados dos commits>

## Módulos testados
- <lista de módulos testados e resultado>

## Issue relacionada
Closes #<issue#>

🤖 Desenvolvido com [Claude Code](https://claude.ai/code)
EOF
)" \
  --draft \
  --base master
```

Se `issue#` não foi fornecida, omita a seção "Issue relacionada".

### 6 — Monitorar CI

```bash
gh pr checks <PR-number> --watch
```

Timeout: 20 minutos. Se expirar, notifique e pare.

### 7 — CI falhou — loop de fix (máximo 3 iterações)

Para cada falha de CI:

1. Leia os logs:
   ```bash
   gh run view <run-id> --log-failed
   ```
2. Identifique a causa raiz
3. Aplique o fix no worktree
4. Commit: `fix: corrige <problema> no CI`
5. Push: `git push origin <branch>`
6. Volte ao passo 6

Após 3 iterações sem CI verde:
```
FALHA: CI não passou após 3 tentativas de fix.
Último erro: <trecho do log>
Worktree preservado para inspeção manual.
```
**Pare.** Não tente merge.

### 8 — Verificar review

```bash
gh pr view <PR-number> --json reviewDecision
```

Se `reviewDecision` == `REVIEW_REQUIRED` ou `CHANGES_REQUESTED`:
```
PR requer review humano. Status: <reviewDecision>
URL: <PR-url>
Aguardando aprovação antes de prosseguir com merge.
```
**Pare.** Não entre em loop tentando merge.

### 9 — Merge

```bash
gh pr ready <PR-number>
gh pr merge <PR-number> --squash --delete-branch --yes
```

Se o merge falhar por conflito:
1. `git merge master` no worktree
2. Resolva conflitos
3. Commit e push
4. Volte ao passo 6

### 10 — Sincronizar root

```bash
ExitWorktree
git checkout master
git pull origin master
```

Confirme:
```
Root sincronizado com master. Branch <branch> mergeada e deletada remotamente.
```

### 11 — Cleanup

Se invocado pelo `issue-coordinator` (modo headless): execute cleanup automaticamente:
```bash
git worktree remove .claude/worktrees/<slug>
git branch -d <branch>
```

Se invocado manualmente pelo usuário: pergunte antes de remover.

---

## Restrições

- Nunca faz push de código com testes falhando
- Nunca entra em loop de merge se review é necessário
- Máximo 3 iterações de fix de CI
- Preserva worktree intacto em caso de falha (para inspeção manual)
