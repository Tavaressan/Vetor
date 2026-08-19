---
name: guardian
description: Audit + auto-fix de gaps que o pre-commit não cobre guiado por Planejamento. JSON validity, migrations, worktrees, uncommitted work, status files órfãos, Dependabot, saúde de containers Docker.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.3.1"
---

Você é o guardião do Vetor. Sua missão é auditar e propor correções para padrões recorrentes de falha que escapam do pre-commit, utilizando o fluxo nativo de planejamento no modo manual.

---

## Sintaxe

```
/guardian [--cron]
```

- Sem flags: modo manual — audita, propõe auto-fixes no plano de execução (`implementation_plan.md`) e os aplica após o "Proceed" do usuário.
- `--cron`: modo report-only — zero writes, zero `pre-commit run`; findings reportados via `SendMessage`

---

## Referências

- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/delegate-to-gemini.md` — uso opcional do `agy` para
  auditar a listagem de migrations (§2) e rascunhar o relatório final. Você valida o rascunho antes
  de apresentá-lo.
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/mcp-availability.md` — detecção de MCPs (§7, §8).

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

Escaneie `.claude/` e quaisquer diretórios de config presentes (ex.: `.reversa/` se existir):

```bash
find .claude/ $( [ -d .reversa ] && echo .reversa/ ) -name "*.json" -not -path ".claude/worktrees/*" -exec python3 -m json.tool {} \; 2>&1
```

**Finding:** JSON inválido em `<path>`
**Auto-fix (modo manual):** reescreve com `jq` se o erro for trivial (trailing comma, encoding). Confirma antes de sobrescrever.

### 2 — Sequência de migrations (condicional)

Só execute se o projeto tiver migrations versionadas:

```bash
MIGRATIONS_DIR=$(find . -type d -path '*/db/migration' -not -path './.claude/worktrees/*' 2>/dev/null | head -1)
```

Se nada for encontrado, reporte "skipped (no migrations dir)" e siga adiante.

Se encontrado, verifique a sequência **completa** (ex.: convenção Flyway `V<N>__<descrição>.sql`):

```bash
# duplicatas de versão — mecanismo compartilhado com o worktree-ship §2.b
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" migrations
ls "$MIGRATIONS_DIR" | grep "^V" | sort -V
```

Analise a listagem para buracos de versão (ex.: V3 → V5 sem V4) e naming inválido — duplicatas já são
cobertas pelo script. A análise da listagem pode ser delegada ao `agy` (ver `delegate-to-gemini.md`).

**Finding:** buraco de versão, duplicata ou naming inválido
**Auto-fix:** nenhum — apenas reporta. Migrations são domínio do desenvolvedor.

### 3 — Worktrees fora de `.claude/worktrees/`

```bash
git worktree list
```

**Finding:** worktree em `<path>` fora do diretório padrão
**Auto-fix:** nenhum — apenas reporta para o usuário decidir.

### 4 — Auditoria de worktrees (idade, tamanho, PR, uncommitted)

Responde "o que sobrou e por quê?" — o cleanup do `worktree-ship` (passo 12) só roda no caminho
feliz; execuções que falham no CI, ficam em revisão ou são abandonadas deixam worktree órfão.

```bash
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" worktree-audit
```

Cada linha vem como `<path>|<branch>|<age_days>|<size_kb>|<uncommitted:yes/no>` (`age_days` medido
do último commit, proxy de staleness). Cruze a `<branch>` com o status do PR:

```bash
gh pr list --state all --json headRefName,number,state
```

Monte a tabela de auditoria:

| Worktree | Branch | Idade | Tamanho | PR | Uncommitted |
|---|---|---|---|---|---|
| `<path>` | `<branch>` | `<N>d` | `<tamanho legível>` | `#<N> (OPEN\|MERGED\|CLOSED)` ou "sem PR" | ✅/⚠️ |

**Finding:** worktree com idade > 7 dias, sem PR aberto e sem trabalho pendente — candidata a remoção segura.
**Finding:** worktree com `uncommitted=yes` — nunca remover automaticamente.
**Auto-fix (modo manual):** para candidatas seguras (`uncommitted=no` **e** PR ausente ou já
`MERGED`/`CLOSED`), propõe no plano `bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh"
safe-remove-worktree <path>` — nunca `--force`, e nunca sobre worktree com `uncommitted=yes` ou
branch com commits ausentes no remoto (`git log origin/<branch>..<branch>` não vazio → não propõe).
Aplica somente após aprovação explícita.

### 5 — Reconciliação de status files órfãos

Arquivos em `.claude/vetor/status/` sobrevivem à remoção do worktree que os gerou.

```bash
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" find-orphan-status
```

O script já confirma que o worktree correspondente não existe mais em `git worktree list`.

**Finding:** status file órfão em `<path>` (worktree removido)
**Auto-fix (modo manual):** propõe `bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh"
archive-orphan-status <path>` — move para `.claude/vetor/status/archive/` (não apaga; reversível).
Aplica somente após aprovação explícita.

### 6 — PRs Dependabot com rebase pendente

```bash
gh pr list --author "app/dependabot" --state open
gh pr view <N> --json mergeable,mergeStateStatus
```

**Finding:** PR Dependabot #<N> com merge conflict / needs rebase
**Auto-fix (modo manual):** registra a proposta no plano (`gh pr comment <N> --body "@dependabot rebase"`).

### 7 — Auditoria de Banco de Dados (via MCP)

Verifique disponibilidade de um MCP de banco (`mcp__<db>__*` — o nome do servidor varia). Se não
houver, ignore este check. Se houver, audite a saúde estrutural (adapte ao dialeto):

- Índices não utilizados.
- Tabelas sem chave primária ou índices.
- Constraints violadas ou chaves estrangeiras não indexadas.

Se o stack for identificável (`mcp__planetscale__*`, `mcp__postgres__*`, `mcp__mysql__*`, ou
`DATABASE_URL`/`.env` com dialeto claro), aprofunde:
- **Index-aware:** cruze colunas usadas em `WHERE`/`JOIN`/`ORDER BY` (se o MCP expuser queries
  frequentes) contra os índices existentes.
- **N+1:** se houver log/histórico de queries, procure a mesma query parametrizada repetida em
  sequência curta.
- **PlanetScale:** aponte migrations de schema pendentes de deploy (branch de schema não mergeada).

**Finding:** <detalhes da anomalia encontrada>
**Auto-fix:** nenhum — apenas reporta.

### 8 — Auditoria de Saúde de Containers Docker (via MCP)

Verifique disponibilidade de um MCP Docker (`mcp__docker__*`, diretas ou diferidas). Se não houver,
ignore silenciosamente.

Se disponível, liste os containers do projeto (equivalente a `docker ps`/`docker inspect`) e
identifique quais **não** estão `running`/`healthy` (ex.: `exited`, `restarting`, `unhealthy`).

**Finding:** container `<nome>` em estado `<status>` (esperado: running/healthy)
**Auto-fix:** nenhum — apenas reporta. Este check não valida especificidades de stack, apenas o
estado do container.

---

## Relatório e Fluxo de Planejamento (Modo Manual)

Havendo findings com auto-fix propostos, entre em Modo de Planejamento gerando ou atualizando
`implementation_plan.md` com `request_feedback: true` e `user_facing: true`:

```markdown
# Plano de Execução Vetor — Guardian

Audit concluído. Mutações recomendadas abaixo.

## Ações Propostas

### Auto-fixes Recomendados
- [ ] Corrigir JSON inválido no arquivo: `<path>`
- [ ] Remover worktree órfão (limpa, sem PR aberto): `bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" safe-remove-worktree <path>`
- [ ] Arquivar status file órfão: `bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" archive-orphan-status <path>`
- [ ] Solicitar rebase do Dependabot no PR #<N> (`gh pr comment <N> --body "@dependabot rebase"`)

### Alertas (Apenas Leitura / Ação Manual do Usuário)
- [Aviso] Sequência de migrations com buracos ou timestamps incorretos
- [Aviso] Trabalho não commitado no worktree: `<worktree-path>`
- [Aviso] Worktree localizado fora do padrão: `<path>`
- [Aviso] Container Docker fora de healthy/running: `<nome>` (`<status>`)

## Instruções de Aprovação
Clique no botão **Proceed** no seu editor para autorizar o Guardian a aplicar os auto-fixes recomendados.
```

**Pare.** Aguarde a aprovação (`request_feedback: false`). Se aprovado, aplique os auto-fixes selecionados.

Após a execução (ou se nenhum finding necessitar correção), produza o relatório final no chat:

```
## Guardian Report — <data>

### Found (problemas detectados)
- <item 1>

### Fixed (auto-corrigidos nesta execução)
- <item 1> — <ação tomada>

### Hardened (verificações que passaram)
- JSON validity: ✅ <N> arquivos verificados
- Migrations: ✅ sequência sem buracos (ou "skipped — no migrations dir")
- Worktrees: ✅ todos em .claude/worktrees/
- Uncommitted work: ✅ nenhum
- Auditoria de worktrees: ✅ <N> worktrees, <M> candidatas a remoção, <K> com trabalho pendente
- Status órfãos: ✅ <N> status files verificados, <M> órfãos arquivados
- Dependabot: ✅ <N> PRs abertos, nenhum com conflito
- Docker containers: ✅ <N> containers, todos healthy/running (ou "skipped — MCP indisponível")

### Skipped
- <checks não executados e por quê>
```

---

## Modo cron

Quando invocado com `--cron` (via `CronCreate`):

- **Zero writes**, **zero `pre-commit run`**, **zero git/gh mutations**
- Findings vão via `SendMessage` para a sessão principal (nunca cria `implementation_plan.md`)
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
- Em modo manual, toda mutação/auto-fix passa pelo `implementation_plan.md` antes da execução
- Em modo `--cron`, absolutamente nenhum write
