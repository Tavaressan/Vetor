# Decisões de design e limitações conhecidas

**Por que orquestração própria (não claude-squad ou vibe-kanban).** Ambos são ferramentas de **supervisão interativa** (claude-squad via TUI/tmux, vibe-kanban via board web) — pressupõem um humano observando cada sessão ou card. O `issue-coordinator` é **dispatch autônomo em background**, que só aciona o humano quando bloqueado. Nenhum dos dois cobre os cinco diferenciais do coordinator: dispatch em lote por label, resiliência a reinício via `AGENT_STATUS.md` (arquivo em disco, não estado em memória), escalação seletiva via `AskUserQuestion`, hard caps explícitos e merge serializado. Além disso, o `vibe-kanban` está congelado desde a saída da Bloop.

**Sobre Agent Teams.** O recurso experimental de "Agent Teams" (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) **não é usado no dispatch autônomo do coordinator** — teammates in-process não sobrevivem a `/resume`, o que quebraria a resiliência a reinício garantida via arquivo. É usado só em dois pontos, com o humano como lead da sessão:

- `backlog-ideator`, para gerar propostas de issue a partir de múltiplas perspectivas (opcional);
- `fix-loop-agent`, para investigar causa raiz incerta com hipóteses concorrentes — **só quando invocado manualmente**, nunca no caminho orquestrado (subagentes não podem abrir seu próprio time).

Para habilitar, adicione ao `.claude/settings.json` do projeto (ou exporte no shell):

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

**Limitação conhecida: mensagem de bloqueio de escrita fora do worktree em workers com `isolation: "worktree"` (issue #94).** Quando um `issue-worker` despachado com `isolation: "worktree"` tenta escrever no path absoluto do status file fora do worktree (`.claude/vetor/status/*.md`), a plataforma Claude Code pode retornar a mensagem *"Edit the worktree copy of this file instead of the shared-checkout path"* — mesmo que o safety hook do Vetor permita esse caminho. A mensagem **não vem do Vetor** (confirmado: ausente em `guard.ts`, `safety-check.ts` e qualquer outro script do plugin). Trata-se de uma restrição de sandbox da plataforma que aparece de forma não determinística (observado em 1 de 5 workers concorrentes na mesma sessão). Mitigação: o coordinator instrui os workers a escreverem o status file tanto no path absoluto (funciona na maioria dos casos) quanto a manterem uma cópia local dentro do worktree como fallback; o coordinator lê de qualquer um dos dois locais. Ver `issue-coordinator/SKILL.md` Fase 4 para os detalhes da orientação de fallback.

**Limitação conhecida: cwd contaminado entre workers paralelos (issue #63).** Com múltiplos `vetor:issue-worker` despachados em paralelo pelo `issue-coordinator`, já foi observado o `cwd` recebido por `PreToolUse` resolver para o worktree de **outro** worker ativo na mesma sessão — não uma cwd inválida (isso `isLinked` já cobre, issue #57), mas um worktree real, só que do agente errado. Investigação confirmou que `safety-check.ts` não tem estado de módulo compartilhado entre invocações (cada evento de hook spawna um processo `deno run` novo, conforme `hooks/hooks.json`), o que descarta uma causa dentro do plugin — o payload `cwd` em si chega inconsistente do harness sob paralelismo. Como o plugin não controla esse payload, a mitigação implementada é uma segunda camada em `checkAgentBinding` (`scripts/safety-check.ts`): correlaciona `agent_id` (estável por instância de subagente, ao contrário de `agent_type`) com o worktree resolvido na primeira chamada de `Edit`/`Write`; uma mudança de worktree para o mesmo `agent_id` é bloqueada com mensagem específica. Não elimina a causa raiz (fora do controle do plugin), mas impede que a escrita vaze silenciosamente para o worktree errado.

**Limitação conhecida: worktrees aninhados pelo harness (issue #95).** Em um dispatch paralelo, o harness alocou o worktree do grupo #86 dentro do diretório do worktree ainda ativo do grupo #85. Ao limpar o pai, `git worktree remove` apagou recursivamente o filho, incluindo qualquer trabalho não commitado; os commits sobreviveram, mas o worktree precisou ser recriado e a entrada ficou `prunable` até `git worktree prune`. A causa provável é a alocação do harness sob `.claude/worktrees/agent-<id>` sem impedir que o diretório pai já seja outro worktree ativo; isso está fora do controle do plugin. Como mitigação, o cleanup usa `vetor-checks.sh safe-remove-worktree`, que lê `git worktree list --porcelain` e bloqueia a remoção se qualquer worktree ativo tiver path `<pai>/...`, apontando os filhos. O pai, sua branch e status são preservados até os filhos serem realocados ou removidos com segurança.

---

[← Wiki do Vetor](Home.md)
