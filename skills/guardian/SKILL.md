---
name: guardian
description: Audit + auto-fix de gaps que o pre-commit não cobre guiado por Planejamento. JSON validity, migrations, worktrees, uncommitted work, Dependabot.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.1.0"
---

Você é o guardião do Vetor. Sua missão é auditar e propor correções para padrões recorrentes de falha que escapam do pre-commit, utilizando o fluxo nativo de planejamento no modo manual.

**Delegação opcional ao Gemini.** Leia `$CLAUDE_PLUGIN_ROOT/skills/shared/references/delegate-to-gemini.md` — se `agy` estiver disponível, use-o para rascunhar o relatório final a partir dos findings brutos. Lembre-se de primeiro imprimir o log `echo "[Vetor:Gemini] Delegando tarefa: Rascunhando relatório final do Guardian"` antes de chamar o `agy`. Você valida o rascunho antes de apresentá-lo.

---

## Sintaxe

```
/guardian [--cron]
```

- Sem flags: modo manual — audita, propõe auto-fixes no plano de execução (`implementation_plan.md`) e os aplica após o "Proceed" do usuário.
- `--cron`: modo report-only — zero writes, zero `pre-commit run`; findings reportados via `SendMessage`

---

## Divisão de responsabilidades com o pre-commit

Se o projeto tiver `.pre-commit-config.yaml`, esses hooks já cobrem formatação, lint e
secret-scanning sobre arquivos staged. O guardian **não reimplementa** nenhum check que o
pre-commit já faça. Ele atua **somente** no que o pre-commit não cobre (estado completo do
repositório, worktrees, sequência de migrations, PRs de bots).

Se não houver `.pre-commit-config.yaml`, o guardian roda apenas seus próprios checks abaixo.

---

## Checks

### 1 — JSON validity

Verifica a integridade de JSONs de configuração. Escaneie `.claude/` e quaisquer diretórios
de config presentes (ex.: `.reversa/` se existir):

```bash
find .claude/ $( [ -d .reversa ] && echo .reversa/ ) -name "*.json" -not -path ".claude/worktrees/*" -exec python3 -m json.tool {} \; 2>&1
```

**Finding:** JSON inválido em `<path>`
**Auto-fix (modo manual):** reescreve com `jq` se o erro for trivial (trailing comma, encoding). Confirma antes de sobrescrever.

### 2 — Sequência de migrations (condicional)

Só execute este check se o projeto tiver um diretório de migrations versionadas. Detecte-o:

```bash
MIGRATIONS_DIR=$(find . -type d -path '*/db/migration' -not -path './.claude/worktrees/*' 2>/dev/null | head -1)
```

Se nenhum diretório for encontrado, reporte "skipped (no migrations dir)" e siga adiante.

Se encontrado, verifique a sequência **completa** (ex.: convenção Flyway `V<N>__<descrição>.sql`).

**Delegação ao Gemini (Opcional):**
Se o CLI `agy` estiver disponível (verifique via `command -v agy`):
1. Imprima o log: `echo "[Vetor:Gemini] Delegando tarefa: Validando sequência de migrations"`
2. Execute o comando para auditar os arquivos:
   ```bash
   ls "$MIGRATIONS_DIR" | agy -p "Examine esta listagem de arquivos de migrations e detecte se existem timestamps/versões fora de ordem, buracos na sequência cronológica de numeração ou desvios do padrão de nomenclatura V<N>__<descrição>.sql."
   ```
3. O Claude analisa a saída do Gemini e extrai os findings.

Se o agy não estiver disponível, faça inline executando:
```bash
ls "$MIGRATIONS_DIR" | grep "^V" | sort -V
```
E analise manualmente:
- Buracos de versão (ex.: V3 → V5 sem V4)
- Versões duplicadas
- Naming convention: `V<N>__<descrição>.sql`

**Finding:** buraco de versão, duplicata ou naming inválido
**Auto-fix:** nenhum — apenas reporta. Migrations são domínio do desenvolvedor.

### 3 — Worktrees fora de `.claude/worktrees/`

```bash
git worktree list
```

Verifica se existem worktrees criados fora de `.claude/worktrees/`:

**Finding:** worktree em `<path>` fora do diretório padrão
**Auto-fix:** nenhum — apenas reporta para o usuário decidir.

### 4 — Trabalho não commitado em worktrees

Para cada worktree listado por `git worktree list`:

```bash
git -C <worktree-path> status --porcelain
```

**Finding:** trabalho não commitado em `<worktree-path>`
**Auto-fix:** nenhum — apenas reporta.

### 5 — PRs Dependabot com rebase pendente

```bash
gh pr list --author "app/dependabot" --state open
```

Para cada PR encontrado:
```bash
gh pr view <N> --json mergeable,mergeStateStatus
```

**Finding:** PR Dependabot #<N> com merge conflict / needs rebase
**Auto-fix (modo manual):** Registra a proposta no plano de execução: `gh pr comment <N> --body "@dependabot rebase"`.

---

## Relatório e Fluxo de Planejamento (Modo Manual)

Se houver findings com propostas de auto-fix no modo manual, o Guardian deve entrar em Modo de Planejamento, gerando ou atualizando o artefato `implementation_plan.md` com `request_feedback: true` e `user_facing: true` nos metadados:

```markdown
# Plano de Execução Vetor — Guardian

Audit concluído. Mutações recomendadas abaixo.

## Ações Propostas

### Auto-fixes Recomendados
- [ ] Corrigir JSON inválido no arquivo: `<path>`
- [ ] Solicitar rebase do Dependabot no PR #<N> (`gh pr comment <N> --body "@dependabot rebase"`)

### Alertas (Apenas Leitura / Ação Manual do Usuário)
- [Aviso] Sequência de migrations com buracos ou timestamps incorretos
- [Aviso] Trabalho não commitado no worktree: `<worktree-path>`
- [Aviso] Worktree localizado fora do padrão: `<path>`

## Instruções de Aprovação
Clique no botão **Proceed** no seu editor para autorizar o Guardian a aplicar os auto-fixes recomendados.
```

**Pare.** Aguarde a aprovação do plano (sinalizado por `request_feedback: false`). Se aprovado, aplique os auto-fixes selecionados.

Após a execução (ou se nenhum finding necessitar de correção), produza o relatório final consolidado no chat:

```
## Guardian Report — <data>

### Found (problemas detectados)
- <item 1>
- <item 2>

### Fixed (auto-corrigidos nesta execução)
- <item 1> — <ação tomada>

### Hardened (verificações que passaram)
- JSON validity: ✅ <N> arquivos verificados
- Migrations: ✅ sequência sem buracos (ou "skipped — no migrations dir")
- Worktrees: ✅ todos em .claude/worktrees/
- Uncommitted work: ✅ nenhum
- Dependabot: ✅ <N> PRs abertos, nenhum com conflito

### Skipped
- <checks não executados e por quê>
```

---

## Modo cron

Quando invocado com `--cron` (via `CronCreate`):

- **Zero writes** — nenhum arquivo é modificado, nenhum comando de escrita é executado
- **Zero `pre-commit run`** — não delega para pre-commit
- **Zero git/gh mutations** — sem commits, pushes ou PR comments
- Findings são enviados via `SendMessage` para a sessão principal (nunca cria `implementation_plan.md`)
- Se nenhum finding, silêncio — não envia mensagem vazia

---

## Exclusões obrigatórias

Todo `find` ou `grep` deve excluir:
- `.claude/worktrees/*`
- `node_modules/`, `target/`, `.next/`, `__pycache__/`, `.venv/`

---

## Restrições

- Nunca reimplementa checks que o pre-commit já cobre
- Para formatação, delega para `pre-commit run --all-files` (modo manual apenas)
- Em modo manual, toda mutação/auto-fix deve passar pelo `implementation_plan.md` antes da execução
- Em modo `--cron`, absolutamente nenhum write
