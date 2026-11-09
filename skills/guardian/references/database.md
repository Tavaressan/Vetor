# Guardian — auditoria de banco de dados (opcional)

> Lida pelo `SKILL.md` do `guardian` só quando a sessão tem um MCP de banco. É o único check que
> exige julgamento, por isso fica fora de `scripts/guardian-audit.ts` (issue #578).

## Check 7 — Auditoria de banco de dados (via MCP)

Verifique disponibilidade de um MCP de banco (prefixo standalone `mcp__<db>__*` ou empacotado em
plugin `mcp__plugin_<plugin>_<db>__*`, conforme `scripts/lib/mcp.ts` — o nome do servidor varia). Se
não houver, ignore este check. Se houver, audite a saúde estrutural (adapte ao dialeto):

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

**Finding:** <detalhes da anomalia encontrada> **Auto-fix:** nenhum — apenas reporta.
