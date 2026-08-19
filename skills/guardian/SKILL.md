---
name: guardian
description: Audit + auto-fix de gaps que o pre-commit não cobre guiado por Planejamento. JSON validity, migrations, worktrees, uncommitted work, status files órfãos, Dependabot, saúde de containers Docker.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.3.0"
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

Se o agy não estiver disponível, faça inline:
```bash
# duplicatas de versão — mecanismo compartilhado com o worktree-ship §2.b
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" migrations
ls "$MIGRATIONS_DIR" | grep "^V" | sort -V
```
E analise a listagem manualmente para buracos de versão (ex.: V3 → V5 sem V4) e naming
(`V<N>__<descrição>.sql`) — duplicatas já são cobertas pelo script acima.

**Finding:** buraco de versão, duplicata ou naming inválido
**Auto-fix:** nenhum — apenas reporta. Migrations são domínio do desenvolvedor.

### 3 — Worktrees fora de `.claude/worktrees/`

```bash
git worktree list
```

Verifica se existem worktrees criados fora de `.claude/worktrees/`:

**Finding:** worktree em `<path>` fora do diretório padrão
**Auto-fix:** nenhum — apenas reporta para o usuário decidir.

### 4 — Auditoria de worktrees (idade, tamanho, PR, uncommitted)

Responde "o que sobrou e por quê?" (issue #133) para cada worktree linkado — o cleanup do
`worktree-ship` (passo 12) só roda no caminho feliz; toda execução que falha no CI, fica em
revisão, é abandonada, ou cujo agente morre antes do merge, deixa o worktree órfão sem que nada
o recolha depois.

```bash
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" worktree-audit
```

Cada linha vem no formato `<path>|<branch>|<age_days>|<size_kb>|<uncommitted:yes/no>`. `age_days`
é medido a partir do timestamp do último commit do worktree (proxy de staleness). Cruze a
`<branch>` de cada linha com o status do PR associado:

```bash
gh pr list --state all --json headRefName,number,state
```

Monte uma tabela de auditoria com uma linha por worktree:

| Worktree | Branch | Idade | Tamanho | PR | Uncommitted |
|---|---|---|---|---|---|
| `<path>` | `<branch>` | `<N>d` | `<tamanho legível>` | `#<N> (OPEN\|MERGED\|CLOSED)` ou "sem PR" | ✅/⚠️ |

**Finding:** worktree com idade alta (> 7 dias, sem PR aberto associado) e sem trabalho pendente —
candidata a remoção segura.
**Finding:** worktree com trabalho não commitado (`uncommitted=yes`) — nunca remover automaticamente.
**Auto-fix (modo manual):** para candidatas seguras (uncommitted=no **e** PR ausente ou já
`MERGED`/`CLOSED`), propõe no plano `bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh"
safe-remove-worktree <path>` — nunca `--force`, e nunca sobre worktree com `uncommitted=yes` ou
branch com commits ausentes no remoto (`git log origin/<branch>..<branch>` não vazio → não propõe).
Aplica somente após aprovação explícita do usuário no plano.

### 5 — Reconciliação de status files órfãos

Arquivos em `.claude/vetor/status/` sobrevivem à remoção do worktree que os gerou —
`scripts/vetor-status.sh` já detecta e reporta esse caso como `cancelled (worktree removed)`, mas
nada recolhe o arquivo de fato.

```bash
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" find-orphan-status
```

Para cada path retornado, o worktree correspondente comprovadamente não existe mais em
`git worktree list` — o script já faz essa checagem antes de listar.

**Finding:** status file órfão em `<path>` (worktree removido)
**Auto-fix (modo manual):** propõe `bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh"
archive-orphan-status <path>` — move o arquivo para `.claude/vetor/status/archive/` (não apaga;
recolhimento reversível). Aplica somente após aprovação explícita do usuário no plano.

### 6 — PRs Dependabot com rebase pendente

Use a CLI `gh`:
```bash
gh pr list --author "app/dependabot" --state open
```
Para cada PR encontrado:
```bash
gh pr view <N> --json mergeable,mergeStateStatus
```

**Finding:** PR Dependabot #<N> com merge conflict / needs rebase
**Auto-fix (modo manual):** Registra a proposta no plano de execução (via `gh pr comment <N> --body "@dependabot rebase"`).

### 7 — Auditoria de Banco de Dados (via MCP)

Verifique disponibilidade de um MCP de banco de dados conforme `$CLAUDE_PLUGIN_ROOT/skills/shared/references/mcp-availability.md` (procure qualquer `mcp__<db>__*` na sua lista de ferramentas — o nome do servidor varia conforme a configuração). Se não houver, ignore este check.
Se estiver disponível, use as ferramentas de query para auditar a saúde estrutural do banco. Sugestões de diagnóstico (adapte ao dialeto do banco, ex: PostgreSQL):
- Identificar índices não utilizados.
- Identificar tabelas sem chaves primárias ou índices.
- Identificar constraints violadas ou chaves estrangeiras não indexadas.

**Finding:** <detalhes da anomalia encontrada no banco>
**Auto-fix:** nenhum — apenas reporta para o desenvolvedor analisar.

#### 7.a — Stack específico: MySQL/Postgres/PlanetScale (condicional)

Detecte o stack pelo nome do servidor MCP disponível (ex.: `mcp__planetscale__*`,
`mcp__postgres__*`, `mcp__mysql__*`) ou por config de conexão no projeto-alvo (ex.:
`DATABASE_URL`, `.env` com dialeto identificável). Se nenhum stack específico for detectado, o
check genérico acima já é suficiente — pule esta subseção.

Se detectado, aprofunde a auditoria além do check genérico:
- **Index-aware**: cruze colunas usadas em `WHERE`/`JOIN`/`ORDER BY` (via queries mais frequentes,
  se o MCP expuser isso) contra os índices existentes — aponte colunas de alto uso sem índice
  correspondente.
- **Queries N+1 típicas**: se o MCP expuser log/histórico de queries, procure padrões de query
  repetida em loop (mesma query parametrizada disparada muitas vezes em sequência curta).
- PlanetScale especificamente: aponte migrations de schema pendentes de deploy (branch de schema
  não mergeada), já que o fluxo de branching é uma particularidade dessa stack.

**Finding:** <detalhes da anomalia específica do stack, ex.: coluna sem índice em query frequente>
**Auto-fix:** nenhum — apenas reporta para o desenvolvedor analisar.

### 8 — Auditoria de Saúde de Containers Docker (via MCP)

Verifique disponibilidade de um MCP Docker conforme `$CLAUDE_PLUGIN_ROOT/skills/shared/references/mcp-availability.md` (procure qualquer `mcp__docker__*` na sua lista de ferramentas — diretas ou diferidas). Se não houver, ignore este check silenciosamente.

Se disponível, liste os containers do projeto com a ferramenta MCP equivalente a `docker ps`/`docker inspect` e identifique quais **não** estão em estado `running`/`healthy` (ex.: `exited`, `restarting`, `unhealthy`).

**Finding:** container `<nome>` em estado `<status>` (esperado: running/healthy)
**Auto-fix:** nenhum — apenas reporta. Diagnóstico e correção (logs, restart, rebuild) são domínio do desenvolvedor. Este check não valida especificidades de nenhuma stack (ex.: Flyway/JAR) — apenas o estado do container reportado pelo Docker.

---

## Relatório e Fluxo de Planejamento (Modo Manual)

Se houver findings com propostas de auto-fix no modo manual, o Guardian deve entrar em Modo de Planejamento, gerando ou atualizando o artefato `implementation_plan.md` com `request_feedback: true` e `user_facing: true` nos metadados:

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
