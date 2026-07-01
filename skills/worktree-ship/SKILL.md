---
name: worktree-ship
description: Pipeline headless de entrega — test → push → PR draft → CI → merge → sync root → cleanup. Deve ser executado de dentro de um worktree.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.0"
---

Você é o pipeline de entrega do Vetor. Sua missão é levar código testado e verde de um worktree até o merge na branch default, sem intervenção manual exceto quando review é necessário.

---

## Sintaxe

```
/worktree-ship [issue#]
```

- `[issue#]`: opcional — número da issue GitHub para incluir `Closes #N` no PR

---

## Referências

**Delegação opcional ao Gemini.** Leia `$CLAUDE_PLUGIN_ROOT/skills/shared/references/delegate-to-gemini.md` — se o CLI `gemini` estiver disponível, use-o para resumir logs de CI antes de diagnosticar (§7).

**Branch default e comandos de teste.** Leia `$CLAUDE_PLUGIN_ROOT/skills/shared/references/project-conventions.md` — resolva `$DEFAULT_BRANCH` e o `module-test-map` conforme descrito lá. Use `$DEFAULT_BRANCH` em todos os comandos abaixo.

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
git diff "$DEFAULT_BRANCH" --name-only
```

Mapeie os arquivos alterados aos módulos usando a tabela de detecção do module-test-map.

### 3 — Testes locais

Para cada módulo alterado, execute o comando headless correspondente do `module-test-map.md`.

**Regra sandbox:**
- Tente docker uma vez (se aplicável ao módulo, ex.: testes de integração)
- Se bloqueado: troque permanentemente para o comando headless e registre no sumário
- Módulo de integração sem a dependência viva (DB etc.): reporte "skipped (requires <dep>)" sem falhar

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
git log "origin/$DEFAULT_BRANCH..HEAD" --oneline
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
  --base "$DEFAULT_BRANCH"
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
   **Opcional (economia de tokens):** se `gemini` estiver disponível (ver `delegate-to-gemini.md`), passe o log por ele para condensar a causa raiz antes de você analisar:
   ```bash
   gh run view <run-id> --log-failed | gemini -p "Resuma a causa raiz das falhas neste log de CI em até 15 linhas, citando arquivo:linha quando houver."
   ```
   A decisão do fix é **sempre sua**, nunca do Gemini.
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
1. `git merge "$DEFAULT_BRANCH"` no worktree
2. Resolva conflitos
3. Commit e push
4. Volte ao passo 6

### 10 — Sincronizar root

```bash
ExitWorktree
git checkout "$DEFAULT_BRANCH"
git pull origin "$DEFAULT_BRANCH"
```

Confirme:
```
Root sincronizado com <default-branch>. Branch <branch> mergeada e deletada remotamente.
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
