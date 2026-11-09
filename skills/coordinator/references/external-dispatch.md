# Coordinator — dispatch para runtime externo ou orquestrador

> Lida sob demanda pelo `SKILL.md` do `coordinator` (só quando um grupo é delegado a um runtime externo ou ao Alethe). Paths relativos
> (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório da skill
> `coordinator`, não deste arquivo.

Caso o coordinator delegue o desenvolvimento de um grupo a um runtime externo de IA (Gemini/OpenCode/Codex) ou a um orquestrador MCP (Alethe — ver `delegate-alethe.md` e `scripts/lib/orchestrator/`), aplique o **contrato mínimo de delegação e orquestração**:
1. **Worktree próprio**: provisione um worktree isolado exclusivo para o runtime ou worker externo via `worktree-create` (nunca opere no root nem em worktree de outro worker).
2. **Diff tratado como rascunho**: o código gerado pelo runtime externo é rascunho não confiável; nunca faça commit cegamente sem inspeção prévia e varredura de rascunhos (`delegate-alethe.md` §6.3, regra 8).
3. **Validação soberana no host via `module-test-map`**: execute a suíte de testes mapeada para os módulos tocados no host antes de qualquer commit; descarte o rascunho em caso de falha.
4. **Status file mantido pelo coordinator**: o coordinator é responsável por gerenciar e atualizar o status file (`.claude/vetor/status/<branch>.md`) a cada iteração (`RUNNING`, `Iteration: N/5`, `GREEN`, etc.).
5. **Polling seguro e liberação obrigatória**: com o orquestrador MCP (Alethe), chame `alethe_check` com `timeoutMs <= 50000` e `alethe_release` antes de qualquer remoção do worktree (`safe-remove-worktree`); fontes e datas em `delegate-alethe.md` §6.3.

Consulte `../shared/references/issue-coordinator-dispatch.md` para o fluxo detalhado desse contrato.
