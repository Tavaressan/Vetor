# Referência

## Hard caps

| Limite | Valor |
|--------|-------|
| Iterações do fix-loop | 5 |
| Retentativas de CI no ship | 3 |
| Timeout global do coordinator | 90 min |
| Workers simultâneos por rodada do coordinator | Perguntado por sessão (padrão: 5, máx: 8) |

## Custo de tokens

Alavancas para manter o custo baixo no dispatch paralelo:

- **Teto de workers simultâneos no `issue-coordinator`** (ver "Hard caps" acima) — cada subagente paralelo é uma instância Claude completa sem contexto compartilhado, então é a alavanca mais direta contra o custo agregado. Grupos além do teto ficam `QUEUED` e só são despachados quando um worker ativo libera vaga. É contabilidade do próprio coordinator, não um bloqueio de plataforma — o Claude Code não tem mecanismo real de limite de tokens por subagente (verificado na doc oficial em 2026-07-02).
- **`tools` restritos no `issue-worker`** — menos ferramentas carregadas por invocação. A restrição de "nunca push/PR/merge" é de instrução/prompt; só o push para branches protegidas (`main`/`master`/`production`) é bloqueado de fato, via hook `PreToolUse`.
- **`model: haiku` por padrão no `issue-worker`**, com escalação para `sonnet` decidida pelo coordinator conforme tipo/labels da issue (`chore`/`fix` pequenos → `haiku`; `feat`/`refactor` → `sonnet`). Se uma issue em `haiku` esgotar as iterações do fix-loop, o coordinator redespacha uma vez com `sonnet` antes de desistir.
- **Subagentes em vez de Agent Teams** sempre que não houver necessidade real de debate entre pares — um subagente comum retorna só um resumo ao chamador; cada teammate é uma instância Claude completa e mais cara.
- **Delegação ao Gemini** para resumir logs de CI grandes antes de qualquer subagente/skill processá-los.

## Estrutura do repositório

```
.claude-plugin/
├── plugin.json              # manifesto do plugin (Claude Code)
└── marketplace.json         # listagem do marketplace
.codex-plugin/
└── plugin.json              # manifesto do plugin (Codex) — sem campo "skills" (ver Compatibilidade)
opencode/                    # camada de compatibilidade (OpenCode) — copiar para .opencode/ no projeto-alvo
├── agent/
│   ├── issue-worker.md      # subagente (OpenCode) — instrui dispatch via `opencode run --dir`
│   └── code-review.md       # subagente (OpenCode) — permission.edit: deny
├── skills/issue-coordinator/
│   └── SKILL.md              # coordinator portado (issue #82) — auto-contido, sem $CLAUDE_PLUGIN_ROOT
├── plugin/vetor.ts          # plugin real: tool.execute.before/after + event (rate-limit, #83)
├── scripts/                 # cópia de scripts/{safety-check,check-edit,vetor-status,vetor-checks,lib/*}
│   ├── model-health.ts        # CLI: grava .claude/vetor/status/model-health.json (#83)
│   ├── resolve-model.ts       # CLI: fallback de modelo/provedor (#84)
│   └── lib/model-health.ts    # computeUntil/isHealthy/pickHealthyModel — sem $CLAUDE_PLUGIN_ROOT
└── mcp.jsonc                # tradução de .mcp.json para o campo "mcp" de opencode.json
agents/
├── issue-worker.md          # subagente nativo (Claude Code) — worker isolado despachado pelo coordinator
├── issue-worker/
│   ├── agent.json           # subagente nativo (Antigravity)
│   └── codex.toml           # template de subagente (Codex) — copiar para .codex/agents/
├── code-review.md           # subagente nativo (Claude Code) — revisão consultiva despachada pelo worktree-ship
└── code-review/
    ├── agent.json           # subagente nativo (Antigravity)
    └── codex.toml           # template de subagente (Codex) — copiar para .codex/agents/
skills/
├── shared/references/
│   ├── module-test-map.template.md
│   ├── delegate-to-gemini.md
│   └── project-conventions.md
├── backlog-ideator/SKILL.md
├── fix-loop-agent/SKILL.md
├── guardian/SKILL.md
├── issue-coordinator/SKILL.md
├── worktree-create/SKILL.md
└── worktree-ship/SKILL.md
scripts/                         # scripts Deno/bash dos hooks e das skills (Claude Code)
├── lib/                         # módulos compartilhados (guard, project, rules, status, worktree)
└── tests/                       # toda a suíte de testes, um arquivo por script/módulo testado
legacy/                          # código aposentado — mantido como referência, não carregado
├── worktree-session/SKILL.md    # skill monolítica, substituída por worktree-create + worktree-ship
└── stop-recovery/               # hook Stop aposentado (#141)
    ├── stop-recovery.ts
    ├── transcript.ts
    └── *_test.ts
```

---

[← Wiki do Vetor](Home.md)
