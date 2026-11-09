# Coordinator — issues spike (modo investigação)

> Lida sob demanda pelo `SKILL.md` do `coordinator` (quando alguma candidata tem a label `spike`). Paths relativos
> (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório da skill
> `coordinator`, não deste arquivo.

#### Detecção de issues spike (modo investigação)

Issues do tipo `spike` ("Investigação/exploração — resultado informa decisão futura, não é trabalho de implementação imediata") possuem fluxo próprio de despacho, pois exigir TDD e testes de código de produto é inadequado para uma entrega cujo objetivo é uma decisão documentada:

1. **Detecção**: reconheça uma issue como `spike` se:
   - Possuir a label `spike` (ou o equivalente existente no repositório, ex.: `investigation`, `research`, `exploration`, consultados via `gh label list --limit 100 --json name`); OU
   - O título iniciar por convenções como `spike:`, `spike(...)`, `investigação:`, `research:`; OU
   - O corpo declarar explicitamente objetivo de spike ou investigação exploratória.
2. **Isenção do Gate de Spec (Fase 2)**: issues `spike` são **isentas do gate de Spec** (dispensam Spec) — como seu propósito é explorar perguntas abertas antes de haver uma capacidade concreta a especificar (conforme `spec/SKILL.md` §0.1), não são bloqueadas pela ausência de Spec. Na tabela do plano da Fase 2, marque na coluna "Ação": `Despachar (Spike — modo investigação)`.
3. **Provisionamento do worktree (Fase 3)**: utilize o tipo `docs` para a branch e worktree (`docs/<issue#>-<slug>`), formato nativo suportado por `worktree-create` (aceito desde #429).
4. **Despacho em modo investigação (Fase 4)**: despache o worker com prompt específico de investigação:
   - Sinalize que a issue deve ser executada em **modo investigação** (não em modo de desenvolvimento regular de código).
   - **Dispensa de TDD e testes de produto**: o worker não roda TDD nem loop de testes de produto (não há código de produto a testar).
   - **Entregável obrigatório**: produzir o relatório em `docs/investigations/<slug>.md`.
   - **Formato mínimo documentado do relatório**:
     1. Pergunta (a pergunta central ou problema a ser respondido)
     2. Evidências (comandos executados, medições, logs, links ou fontes reproduzíveis)
     3. Opções avaliadas (alternativas consideradas e seus trade-offs)
     4. Recomendação (opção sugerida com justificativa para decisão futura)
   - **Critério de `GREEN`**: status `GREEN` é atingido quando o arquivo `docs/investigations/<slug>.md` existir cobrindo as seções mínimas e `git diff --check` passar sem erros.
5. **Entrega e follow-up (Fase 6)**: o PR gerado pelo `ship` segue o caminho de PR só de docs (#427). A decisão derivada do spike **continua humana** — o coordinator e o worker nunca criam issues de follow-up automaticamente a partir das recomendações.
