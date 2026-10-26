# Issue-coordinator — Coordinator Report e fechamento de onda

> Extraído de `skills/coordinator/SKILL.md` (issue #373) e lido só quando o SKILL.md manda.
> Paths relativos (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório
> da skill `coordinator`, não deste arquivo.

```
## Coordinator Report

| Issue | Resultado | PR | Detalhes |
|-------|----------|-----|----------|
| #42 | ✅ Merged | #87 | squash merged |
| #43 | ❌ CI failed | #88 | 3 fix attempts, worktree preserved |
| #51 | ❌ Pre-ship failed | — | testes locais ou push falharam no `--prepare`, worktree preservado |
| #52 | 🚧 Gate failed | #91 | `--auto-ship`: reviews FAIL (code review com 1 achado(s) blocker); PR aberto para um humano |
| #44 | ⏸️ Review required | #89 | awaiting human review |
| #53 | ⏳ SUSPENDED | — | aguardando decisão na Decision Inbox (`dec-issue-53`); vaga liberada, worktree preservado |
| #50 | 🕒 Enfileirado | #90 | merge queue/auto-merge: PR aberto, GitHub conclui o merge; worktree preservado |
| #45 | ⏭️ SKIPPED (aguardando Spec) | — | gate de Spec/design, Fase 2 — usuário optou por gerar a Spec antes |
| #46 | ⏭️ SKIPPED (aguardando insumo do usuário) | — | triagem Fase 1/2 — aguardando decisão/conteúdo do usuário |
| #47 | ⏭️ SKIPPED (fora deste repositório) | — | triagem Fase 1/2 — escopo pertence a repositório externo |
| #48 | ⏭️ SKIPPED (épico/acompanhamento) | — | triagem Fase 1/2 — issue agregadora sem código direto |
| #49 | ⏭️ SKIPPED (bloqueada por #N) | — | dependência nativa GitHub — bloqueadora aberta fora da leva |

Resumo: <N> merged, <Q> enfileirados, <M> falharam, <K> aguardando review, <J> skipped.
```

**Checkpoint de fechamento de onda (issue #246).** Após montar o Coordinator Report acima, confirme
que a lista de grupos originalmente planejados na Fase 2 bate 1:1 com os resultados reportados —
**nenhum grupo do plano aprovado deve ficar sem uma linha de resultado**. Resultados válidos
dependem do modo:
- **Interativo**: `Merged`, `Enfileirado`, `Pre-ship failed`, `CI failed`, `FAILED_MAX_ITERATIONS`, `Review required`, `BLOCKED_WAITING`, `SUSPENDED`,
  `SKIPPED (aguardando Spec)`, `SKIPPED (aguardando insumo do usuário)`, `SKIPPED (fora deste repositório)`,
  `SKIPPED (épico/acompanhamento)`, `SKIPPED (bloqueada por #N)`. Se houver discrepância (grupo do plano não aparece acima), reporte-o como "não
  despachado" e pergunte ao usuário via `AskUserQuestion` se deve despachar agora.
- **`--headless`**: `Merged`, `Enfileirado`, `Pre-ship failed`, `Gate failed`, `CI failed`, `FAILED_MAX_ITERATIONS`, `Review required`, `BLOCKED_WAITING`, `SUSPENDED`,
  `SKIPPED (aguardando Spec)`, `SKIPPED (aguardando insumo do usuário)`, `SKIPPED (fora deste repositório)`,
  `SKIPPED (épico/acompanhamento)`, `SKIPPED (bloqueada por #N)`, ou `GREEN (pronto para ship)` — este último status aparece para grupos que
  atingiram verde em modo headless sem `--auto-ship`/`autoShipHeadless` (sem merge nessa fase). Se houver discrepância, apenas reporte o
  grupo como "não despachado" no campo de observações; não pergunte nem redespache.

**Em `--headless`, o relatório é a única saída da execução** — acrescente:
- O plano de dispatch da Fase 2 (apenas registrado, não aprovado).
- Para cada issue `não-trivial` sem Spec associada (gate de Spec/design, Fase 2): sinalizada, nunca
  bloqueada — mesma marca `⚠️ sem Spec associada` da coluna "Ação" do plano.
- O teto `N` usado e como foi calculado.
- Para cada `GREEN` (sem `--auto-ship`/`autoShipHeadless`): branch e path do worktree, marcados como
  **prontos para ship**.
- Com `--auto-ship`/`autoShipHeadless`: para cada PR cuja entrega parou, o resultado `Gate failed`
  com o número do PR, cada gate reprovado (`ci`, `reviews`, `migrations`, `mergeable`) e o detalhe
  que o comando `auto-ship-gates` imprimiu (ou `Review required` / permissão negada, se o `--finalize`
  parou). O PR segue aberto; a sessão termina normalmente.
- Para cada `BLOCKED_WAITING` ou `SUSPENDED`: o bloqueio e a recomendação do worker (e o id da
  pendência na Decision Inbox).
- Se o circuit breaker disparou: a assinatura de erro comum e os grupos não despachados.

---

