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
| #44 | ⏸️ Review required | #89 | awaiting human review |
| #45 | ⏭️ SKIPPED (aguardando Spec) | — | gate de Spec/design, Fase 2 — usuário optou por gerar a Spec antes |

Resumo: <N> merged, <M> falharam, <K> aguardando review, <J> aguardando Spec.
```

**Checkpoint de fechamento de onda (issue #246).** Após montar o Coordinator Report acima, confirme
que a lista de grupos originalmente planejados na Fase 2 bate 1:1 com os resultados reportados —
**nenhum grupo do plano aprovado deve ficar sem uma linha de resultado**. Resultados válidos
dependem do modo:
- **Interativo**: `Merged`, `CI failed`, `FAILED_MAX_ITERATIONS`, `Review required`, `BLOCKED_WAITING`, `SKIPPED (aguardando
  Spec)`. Se houver discrepância (grupo do plano não aparece acima), reporte-o como "não
  despachado" e pergunte ao usuário via `AskUserQuestion` se deve despachar agora.
- **`--headless`**: `Merged`, `CI failed`, `FAILED_MAX_ITERATIONS`, `Review required`, `BLOCKED_WAITING`, `SKIPPED
  (aguardando Spec)`, ou `GREEN (pronto para ship)` — este último status aparece para grupos que
  atingiram verde em modo headless (sem merge nessa fase). Se houver discrepância, apenas reporte o
  grupo como "não despachado" no campo de observações; não pergunte nem redespache.

**Em `--headless`, o relatório é a única saída da execução** — acrescente:
- O plano de dispatch da Fase 2 (apenas registrado, não aprovado).
- Para cada issue `não-trivial` sem Spec associada (gate de Spec/design, Fase 2): sinalizada, nunca
  bloqueada — mesma marca `⚠️ sem Spec associada` da coluna "Ação" do plano.
- O teto `N` usado e como foi calculado.
- Para cada `GREEN`: branch e path do worktree, marcados como **prontos para ship**.
- Para cada `BLOCKED_WAITING`: o bloqueio e a recomendação do worker.
- Se o circuit breaker disparou: a assinatura de erro comum e os grupos não despachados.

---

