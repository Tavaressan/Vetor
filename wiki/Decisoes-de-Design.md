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

**Por que os SKILL.md não carregam o "porquê".** Um SKILL.md é carregado inteiro no contexto do
agente a cada execução: rationale, histórico de issues e exemplos didáticos são custo de token
recorrente que compete com a instrução operacional. A convenção é manter no SKILL.md apenas o que o
agente precisa para agir, movendo justificativa para esta página e procedimentos longos reutilizáveis
para `skills/shared/references/`.

**Teto de workers simultâneos é recomendação, não limite.** O `issue-coordinator` calcula
`N_rec = min(nº de grupos, maxConcurrentWorkers do config, senão 5)` e o oferece como default na
`AskUserQuestion` da Fase 2. Acima de ~8 workers o custo agregado e o ruído de monitoramento tendem a
crescer mais rápido que o ganho de paralelismo, e o coordinator sinaliza isso — mas não impõe: o
usuário pode escolher qualquer valor, inclusive acima de 8. Não há teto duro.

**Por que `--headless` nunca faz merge.** Entregar código à branch default sem revisão humana é
precisamente o que um modo não supervisionado não deve decidir sozinho — ainda mais em repositórios
sem required status check, onde não há barreira nenhuma depois do merge. Em headless, todo gate de
aprovação (`AskUserQuestion`, `ExitPlanMode`) viraria deadlock silencioso por falta de interlocutor,
o mesmo modo de falha do worker preso em plan mode (issue #121); a Fase 6 é pulada e os grupos
`GREEN` são apenas reportados como prontos para ship.

**Por que o circuit breaker headless sempre pausa.** Falha recorrente com a mesma assinatura quase
sempre é infraestrutura (rede, registry, disco), não código: insistir sem humano só multiplica o
custo pelo número de grupos restantes.

**Dois circuit breakers distintos.** O do `worktree-ship` (§8.a) detecta falha da *plataforma* de CI
(billing, outage, job not started) via anotações de job e pausa sem consumir iterações de fix — o
problema não é resolvível por código. O do `issue-coordinator` (§5.c) agrega múltiplos workers com
falhas de código de assinatura idêntica e decide se pausa.

**Revisões de código e segurança são consultivas (issue de custo).** O passo 8.5 do `worktree-ship`
substituiu o GitHub Action `code-review@claude-code-plugins`, desativado por custar por execução
independentemente do risco ou tamanho da mudança. Os achados nunca bloqueiam o merge: quem decide
agir é o humano, lendo o comentário na PR.

**Worker preso em plan mode (issue #121).** Um `issue-worker` despachado via `Agent()` pode entrar em
plan mode por conta própria (heurística de "tarefa não-trivial") e travar: sem `ExitPlanMode`
disponível na sessão isolada e com a escrita do plan file fora do worktree bloqueada pelo
`scripts/safety-check.ts`. O status fica parado em `RUNNING`. Mitigação primária: instrução explícita
em `agents/issue-worker.md` e `skills/fix-loop-agent/SKILL.md` para nunca chamar `EnterPlanMode`.
Recuperação: descartar a sessão e redespachar como agente genérico no worktree existente — nunca com
`vetor:issue-worker`, cujo frontmatter força worktree novo e ignora a omissão do parâmetro (issue #104).

**Cache de arquivos tocados (issue #81).** O `fix-loop-agent` grava um cache efêmero por branch com o
mapeamento módulo → arquivos, para que o `code-review` despachado logo depois pelo `worktree-ship`
não precise re-derivá-lo. Formato e ciclo de vida em
`skills/shared/references/touched-files-cache.md`; descartado no cleanup (passo 12).

---

[← Wiki do Vetor](Home.md)
