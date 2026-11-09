# Coordinator — modo de retomada

> Lida sob demanda pelo `SKILL.md` do `coordinator` (na Fase 0, quando há ao menos um status file ativo). Paths relativos
> (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório da skill
> `coordinator`, não deste arquivo.

Se houver ao menos um status file ativo na Fase 0:

**pule as Fases 1–3** e pergunte tudo em
     **uma única chamada de `AskUserQuestion`**: o teto de workers (item 1 da entrevista consolidada
     da Fase 2; omitido quando `N_rec = 1`, pois o estado em memória de `N` não sobrevive a um
     reinício da sessão) e, se houver grupos em `GREEN` sem PR aberta ou merge, uma segunda pergunta
     `multiSelect` — "Fazer ship dos grupos `GREEN`?" — listando cada grupo `<slug>` (Issue #<N>)
     com todos marcados `(Recommended)`. Depois monte a tabela de status (Fase 5.a). Se já estiver
     mergeado, apenas informe. Prossiga a partir da Fase 5/6.
     Em `--headless` (e em `--goal`, que o acompanha): não pergunte o teto (use `N_rec`) e não
     ofereça ship — apenas reporte os grupos `GREEN` como prontos, salvo com
     `--auto-ship`/`autoShipHeadless: true`, caso em que os `GREEN` seguem a Fase 6.d. Em `--goal` a
     retomada continua o `goal-audit.json` existente em vez de criar outro.
     Antes de prosseguir, rode `scripts/prewarm-worktrees.ts discard` para limpar sobras de
     pre-warming (idempotente, e sem manifest não faz nada, com ou sem o opt-in; ver
     `../shared/references/worktree-prewarm.md`).
