---
name: guardian
description: Audit + auto-fix de gaps que o pre-commit não cobre guiado por Planejamento. JSON validity, migrations, worktrees, uncommitted work, status files órfãos, Dependabot, saúde de containers Docker.
license: MIT
compatibility: "Núcleo: ler, editar e rodar shell. Opcional: perguntas, agendamento (fallback em shared/references/harness-capabilities.md)."
metadata:
  author: vitortavares
  version: "2.0.0"
---

Você é o guardião do Vetor. A auditoria é um script determinístico e somente leitura; seu papel é
apresentar o resultado, propor as correções e aplicar só as aprovadas.

## Sintaxe

```
/vetor:guardian [--cron]
```

- Sem flags: modo manual — audita, propõe correções e aplica as aprovadas.
- `--cron`: só relata; nenhuma escrita, nenhuma mutação de git ou GitHub.

## Referências

Resolva os paths a partir do diretório desta skill (`SKILL_DIR`, informado no carregamento) e use
`"$SKILL_DIR/../../scripts/..."` nos comandos.

- `references/database.md` — só se a sessão tiver um MCP de banco (check 7).
- `../shared/references/codebase-design-vocabulary.md` — só ao redigir a issue de revisão de design
  do check 9 ("fan-in", "deletion test").

## Divisão com o pre-commit

Se o projeto tiver `.pre-commit-config.yaml`, ele já cobre formatação, lint e secret-scanning dos
arquivos staged: o guardian não reimplementa nada disso e, para formatação, delega a
`pre-commit run --all-files` (só no modo manual). O guardian olha o estado do repositório inteiro:
worktrees, migrations, status files, PRs de bots.

## 1 — Auditoria

```bash
deno run -A "$SKILL_DIR/../../scripts/guardian-audit.ts" --format json
```

Rode no repo-root. Exit 0 = nada encontrado; 1 = há achados. Cada check traz `status` (`ok`,
`finding`, `skipped`, `error`), `findings` (com `message`, `path` e, quando houver, `fix`) e `detail`.
Checks: JSON inválido em `.claude/` e `.reversa/`; sequência de migrations (buraco, duplicata, nome
fora de `V<N>__<descrição>.sql`); worktrees fora de `.claude/worktrees/`; diretórios residuais em
`.claude/worktrees/`; auditoria de worktrees (idade, PR, trabalho não commitado, commits fora do
remoto); status files órfãos; PRs do Dependabot com rebase pendente; containers Docker do projeto
fora de `running`/`healthy` (via `docker ps`, sem MCP); risco arquitetural (fan-in dos módulos
tocados em 7 dias); frescor da cartografia Graphify; saúde do servidor ai-memory; regras de
best-practices com mais de 90 dias.

**Check 7 — banco de dados:** só se houver um MCP de banco na sessão (`mcp__<db>__*` ou
`mcp__plugin_<plugin>_<db>__*`); leia `references/database.md`. Sem ele, ignore.

Nunca invente um achado fora do que o script e o check 7 reportaram.

## 2 — Plano de correções (modo manual)

Liste os achados com `fix` como ações propostas e os demais como alertas de ação manual. A aprovação
usa o mecanismo do harness: plan mode ou `implementation_plan.md` com `request_feedback: true`
(`../shared/references/planning-conventions.md` §2.2), a ferramenta de perguntas, ou o fallback do
chat (`../shared/references/harness-capabilities.md` §2.4). **Pare** até a resposta e aplique só o
que foi aprovado. Achado sem `fix` (migrations, worktree fora do padrão, trabalho não commitado,
diretório residual, container, Graphify, ai-memory, best-practices) nunca é corrigido sozinho.

## 3 — Aplicar as correções aprovadas

- `rewrite-json`: só se o erro for trivial (vírgula final, encoding); mostre o diff e confirme antes
  de sobrescrever com `jq`.
- `safe-remove-worktree` e `archive-orphan-status`: rode o `command` do achado. O script só propõe
  remoção de worktree limpo, sem PR aberto e sem commits fora do remoto; nunca use `--force`.
- `dependabot-rebase`: grave `@dependabot rebase` num arquivo com a ferramenta de escrita e rode
  `gh pr comment <N> --body-file <arquivo>`.
- `design-review-issue`: grave o corpo abaixo com a ferramenta de escrita (nunca `echo`, `printf` nem
  heredoc) e crie com `gh issue create --title "refactor(<módulo>): revisão de design
  (deletion test)" --body-file <arquivo>`. Labels de tipo ou módulo só se já existirem no repositório;
  nunca crie labels. A issue segue o fluxo humano (`backlog`/`coordinator`), nunca é refatorada aqui.

```text
## Descrição
Módulo com fan-in alto (<N> arquivos importam diretamente), detectado pelo guardian como candidato a revisão de design (deletion test: dificilmente removível/refazível sem espalhar mudança).

## Critério de aceite
- [ ] Avaliar acoplamento e dependências de `<módulo>`.

## Contexto
Âncora: skills/guardian/SKILL.md; check de risco arquitetural (deletion test).
Módulo: <módulo>

---
🤖 Gerado por /vetor:guardian
```

## 4 — Relatório

Use o relatório do script (`--format md`: Found, Hardened, Skipped) e acrescente a seção
`### Fixed` com cada correção aplicada e a ação tomada.

## Modo cron

O `--cron` funciona só com o script, sem LLM e sem ferramenta de harness:

```bash
deno run -A "$SKILL_DIR/../../scripts/guardian-audit.ts" --format md
```

Exit 0 = silêncio (não envie mensagem vazia); exit 1 = entregue o relatório. Agende pelo mecanismo
disponível (`../shared/references/harness-capabilities.md` §2.6): no Claude Code, `CronCreate` com
o relatório enviado à sessão principal; fora dele, cron do sistema, timer ou CI. Nenhuma escrita,
nenhum `pre-commit run`, nenhuma mutação de git ou GitHub, nenhum plano de correção.

## Restrições

- Nunca reimplementa checks que o pre-commit já cobre.
- A auditoria é somente leitura; toda correção passa pela aprovação do passo 2.
- Em `--cron`, absolutamente nenhuma escrita.
- Migrations são domínio do desenvolvedor: o guardian só relata.
