# Coordinator — teto de workers simultâneos

> Lida sob demanda pelo `SKILL.md` do `coordinator` (na Fase 2, ao calcular o teto `N`). Paths relativos
> (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório da skill
> `coordinator`, não deste arquivo.

Cada subagente paralelo é uma instância Claude completa, sem contexto compartilhado — é o maior
driver de custo agregado do coordinator.

1. **Recomendação** `N_rec` = `min(largura da maior onda, maxConcurrentWorkers de
   .claude/vetor/config.json se existir — senão 5)`. A largura da maior onda é o número máximo de
   grupos que podem rodar em paralelo dentro de uma mesma onda (grupos de ondas distintas nunca rodam
   juntos — Fase 4). Acima de ~8 workers, custo agregado e ruído de monitoramento tendem a crescer
   mais rápido que o ganho de paralelismo: se `N_rec` > 8, sinalize isso na pergunta. É
   recomendação, não limite — a decisão é do usuário.
2. **Pulo automático quando `N_rec = 1` (ou largura da maior onda = 1):** se `N_rec = 1`, ou se a
   largura da maior onda for 1 (apenas um único grupo despachável por onda), adote `N = 1`
   automaticamente sem perguntar ao usuário e registre no plano e no relatório (comportamento idêntico
   ao modo `--headless`). Não há escolha real de concorrência quando a largura da onda é 1, evitando
   uma interação vazia.
3. **Em `--headless`:** adote `N = N_rec` sem perguntar e registre no relatório qual valor foi usado
   e como foi calculado.
4. **Fora de `--headless` (com `N_rec > 1`):** o teto é o **item 1 da entrevista consolidada**
   (abaixo), sem pergunta própria. Opções do item:
   - `"<N_rec> (Recommended)"` — justifique em 1 linha (largura da onda, custo por worker, alerta se > 8)
   - `"1 — serializado"` — mais lento, mais previsível, menor custo
   - `"<maxConcurrentWorkers de config.json>"` — só se existir e for diferente de `N_rec`
   - O usuário pode responder valor customizado ("Other"), **inclusive acima de 8** — respeite-o.
5. **Armazene como `N`** para a Fase 4; vale para toda a sessão de dispatch, incluindo redespachos.
   Em modo de retomada, o teto entra na pergunta única da Fase 0 apenas se `N_rec > 1`.
   O valor **não persiste** em `.claude/vetor/config.json`.
