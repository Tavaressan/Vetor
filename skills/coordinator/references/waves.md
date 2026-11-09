# Coordinator — ondas de despacho (DAG)

> Lida sob demanda pelo `SKILL.md` do `coordinator` (com 2 ou mais grupos na leva). Paths relativos
> (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório da skill
> `coordinator`, não deste arquivo.

#### Ondas de despacho (DAG Waves)

Grupos que rodam **em paralelo** podem depender causalmente uns dos outros (ex.: grupo B usa uma
entidade/migration/classe que só existe depois do merge do grupo A). Despachar B a partir do branch
default ANTES do merge de A causa branch skew: o worktree de B nunca verá as mudanças de A, exigindo
conciliação manual depois. Para evitar isso, organize os grupos em **ondas topológicas** (`O_1, O_2,
..., O_k`) antes de montar o plano da Fase 2:

1. **Leitura de dependências nativas do GitHub (REST API)**:
   Dependências entre issues ("blocked by" / "blocking") são nativas no GitHub desde 21/08/2025
   (com API REST e filtros `is:blocked`/`is:blocking`). Para cada issue candidata, consulte as
   dependências bloqueadoras via GitHub CLI / REST API:
   ```bash
   gh api repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by
   ```
   (ou consulte o resumo `issue_dependencies_summary` do objeto da issue retornado por
   `gh api repos/{owner}/{repo}/issues/<N> --jq .issue_dependencies_summary`).

   Aplique os seguintes tratamentos para cada bloqueadora encontrada:
   - **Bloqueadora aberta e fora da leva**: a issue candidata não pode ser despachada nesta sessão;
     sai da leva como `SKIPPED (bloqueada por #N)` (recebe Onda `—`, modelo `—` e justificativa clara
     no plano e no Coordinator Report — ver "Triagem de despachabilidade").
   - **Bloqueadora dentro da leva**: estabelece uma aresta do DAG como **fato** (não inferência): o
     grupo da issue bloqueadora deve ser executado e mergeado antes do grupo da issue dependente (`A → B`).
     A issue dependente é alocada para uma onda posterior (`O_2+`).

2. **Fallback para heurística textual** (em caso de falha/indisponibilidade da API ou dependência não cadastrada):
   Se a chamada à REST API falhar ou estiver indisponível (ex.: endpoint inacessível, erro de rede,
   ou falta de permissão), ou para capturar dependências textuais não cadastradas formalmente no GitHub,
   recorra às **heurísticas textuais best-effort**:
   - Título/corpo de uma issue do grupo B menciona explicitamente outro grupo/issue do grupo A (ex.:
     "depende de #12", "blocked by #12", "após #12", "usa a entidade criada em #12").
   - Labels indicando ordem (ex.: `blocked-by`, `depends-on`) ou convenção do time.
   - Mesmo módulo/diretório, mas com evidência de ordem de criação de arquivo (ex.: B referencia uma
     classe, tabela ou migration que a descrição de A propõe criar pela primeira vez).

3. Construa o **DAG (grafo acíclico dirigido)** de grupos: aresta `A → B` quando B depende de A (arestas
   nativas como fatos e heurísticas textuais como inferências complementares). Se houver ciclo aparente
   (heurística ambígua), trate como **não-dependente** e avise no plano — não bloqueie o dispatch por
   uma inferência de baixa confiança.
4. Derive as ondas por ordenação topológica: `O_1` contém todos os grupos sem dependência pendente;
   `O_2` os que dependem só de grupos em `O_1`; e assim por diante.
5. **Fallback de ondas:** se nenhuma dependência (nativa ou textual) for detectável entre os grupos (caso mais comum), cada grupo
   forma sua própria onda e todas as ondas colapsam em uma só (`O_1`) — comportamento idêntico ao
   dispatch paralelo atual, sem mudança de comportamento observável.
6. O usuário pode **corrigir manualmente** o agrupamento em ondas no plano da Fase 2 antes de aprovar
   — dependências nativas e heurísticas são pontos de partida, cabendo ao usuário a validação final.
7. **Pre-warming (RF-06), opt-in:** só com `"prewarmWorktrees": true` em `.claude/vetor/config.json` (lido
   a partir do root, `vetor-checks.sh repo-root`). Sem a chave, ou com `false`, pule este item: nenhum
   `start` e dispatch clássico. Ligado, dispare em background o pre-warming dos worktrees de `O_1` (no
   máximo `N_rec` grupos) enquanto a Fase 2 conduz a entrevista. Comandos, limites, a troca de guardas e a
   regra de sincronia em `../shared/references/worktree-prewarm.md`.
