# Contrato de capacidades dos harnesses

O Vetor roda em Claude Code, OpenCode, Antigravity, Codex, Cursor e em qualquer outro harness que
ofereça o núcleo abaixo (issue #568). Esta página diz o que o núcleo pode assumir e o que cada
harness oferece além disso. Os fallbacks de cada capacidade opcional ficam num único lugar, que as
skills leem: [`skills/shared/references/harness-capabilities.md`](../skills/shared/references/harness-capabilities.md).

## Capacidades obrigatórias do núcleo

1. **Ler arquivos.**
2. **Editar arquivos.**
3. **Rodar shell** (`bash`; Git Bash no Windows), com `git`, `gh` e `deno` disponíveis.

Todo fluxo suportado funciona só com isso. Recurso exclusivo de um harness entra como otimização
aditiva, com fallback portátil, e nunca como requisito. Uma skill nunca supõe que outro harness tem
subagentes, hooks, isolamento de worktree, `context: fork` ou `bin/`.

## Capacidades opcionais por harness

Legenda: ✅ nativo · ⚠️ parcial ou por outro mecanismo · ❌ ausente · ❓ não verificado (vale o
fallback).

| Capacidade | Claude Code | OpenCode | Antigravity | Codex | Cursor |
| --- | --- | --- | --- | --- | --- |
| Subagentes | ✅ `Agent()` | ⚠️ `task` herda o cwd; o Vetor usa um processo `opencode run --dir` por worker | ✅ subagentes em Markdown | ✅ subagentes em TOML, sem allowlist de tools | ✅ custom subagents |
| Hooks | ✅ `PreToolUse`, `PostToolUse`, `SubagentStop`, `SessionStart`, `WorktreeCreate` | ⚠️ plugin `tool.execute.before`/`after`; sem fim de subagente nem criação de worktree | ⚠️ só `PreToolUse` de `run_command`; sem `SubagentStop` | ⚠️ mesmo formato do Claude Code, payload não verificado em sessão real; sem `WorktreeCreate` | ⚠️ traduzidos na instalação; sem `WorktreeCreate` |
| Isolamento de worktree | ✅ `isolation: worktree` | ⚠️ por processo com `--dir` | ❌ | ❌ só por instrução | ⚠️ pedido por instrução, não por frontmatter |
| Ferramenta de perguntas | ✅ `AskUserQuestion` | ❓ | ⚠️ `implementation_plan.md` com `request_feedback`, para aprovação de plano | ❓ | ❓ |
| Execução em background | ✅ `run_in_background`, `Monitor` | ⚠️ processos do SO pelo shell | ❓ | ❓ | ⚠️ `is_background` no subagente |
| Agendamento | ✅ `CronCreate` e rotinas | ❓ | ❓ | ❓ | ❓ |

**Fontes:** [Compatibilidade-OpenCode](Compatibilidade-OpenCode.md) (código-fonte e SDK
`@opencode-ai/plugin` 1.19.x), [Compatibilidade-Antigravity](Compatibilidade-Antigravity.md)
(`antigravity.google/docs/subagents` e `/docs/plugins`, consultadas em 2026-10-15 e 2026-10-19),
[Compatibilidade-Codex](Compatibilidade-Codex.md) (documentação de subagentes consultada em
2026-10-15), [Compatibilidade-Cursor](Compatibilidade-Cursor.md) (`cursor.com/docs/subagents` e
`/docs/hooks`, consultadas em 2026-10-15) e [Hooks](Hooks.md). Um ❓ só muda depois de confirmado
numa dessas páginas, com fonte e data.

## Campo `compatibility` das skills

O `compatibility` do frontmatter segue esta matriz: diz que a skill exige só o núcleo e lista as
capacidades opcionais que ela usa quando existem. O fallback de cada uma está na referência citada
acima.

## Campos opcionais de frontmatter por engine

Campos do Claude Code que reduzem custo ou risco entram só como otimização: o comportamento sem eles
continua correto em todos os harnesses (issue #576). Fontes consultadas em 2026-11-09:
https://code.claude.com/docs/en/skills.md, https://code.claude.com/docs/en/sub-agents.md e
https://code.claude.com/docs/en/plugins/components.md.

| Campo | Avaliado para | Decisão | Motivo |
| --- | --- | --- | --- |
| `disable-model-invocation: true` (skill) | `ship`, `coordinator`, `install`, `guardian` | não adotado | Além de tirar a descrição do contexto, impede o modelo de invocar a skill, o pré-carregamento em subagentes e a execução por tarefa agendada. O `/vetor:now` encaminha para `coordinator` e `install` pelo modelo; o Pre-Ship de fallback roda `/vetor:ship --prepare` dentro de um subagente; `coordinator --headless` e `guardian --cron` existem para rotinas agendadas. |
| `context: fork` (skill) | `guardian`, `architecture-review`, validação de Spec | não adotado | O fork roda a skill num subagente sem o histórico e sem conversa com o usuário. O `guardian` pede aprovação antes de corrigir, o `architecture-review` pergunta qual candidato aprofundar, e a validação virou o modo `/vetor:spec --validate` (#580), que roda um CLI determinístico e barato. |
| `maxTurns` (agent) | `issue-worker` | **adotado: 120** | Dá teto real ao orçamento de 5 iterações do `fix` (#156). Ao atingir o limite, o Claude Code devolve saída parcial; o status fica não terminal e o coordinator reconcilia pela Fase 5.g. Calibração no comentário do frontmatter de `agents/issue-worker.md`. |

Nos outros harnesses: o `agy plugin validate` aceita `maxTurns` no agent (verificado em
2026-11-09); o instalador o remove da cópia do Cursor, cuja documentação não lista o campo; o Codex
usa `agents/issue-worker/codex.toml`, sem equivalente, e o OpenCode tem o próprio
`opencode/agent/issue-worker.md`. Em todos eles o orçamento continua sendo o sugerido pelo `fix`.

