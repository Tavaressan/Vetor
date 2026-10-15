Status: rascunho — aguardando decisão do mantenedor

# Decomposição de skills sequenciais em micro-skills

## Resumo executivo

**Recomendação — INFERRED:** não decompor agora o `issue-coordinator` em três skills independentes. A #373 já aplicou a alternativa mais simples: conservar um único fluxo e extrair os detalhes operacionais para referências lidas sob demanda. O coordinator ainda contém 450 linhas (27.987 bytes), mas seu texto orienta quando abrir as referências de dispatch, monitoramento e relatório (`skills/issue-coordinator/SKILL.md:321-413`). Um pipeline de micro-skills só deve avançar a PoC se medição em runtime provar redução de contexto por fase sem perda de retomada, gate humano ou segurança do merge serializado.

Para `fix-loop-agent`, a hipótese merece uma PoC menor e independente: reproduzir → corrigir → verificar são fronteiras conceitualmente claras, mas invariantes transversais (status inicial, worktree, orçamento, memória e classificação de bloqueios) tornam prematura a divisão em três comandos de produção. Recomendo simular a separação sob feature flag e comparar com o fluxo atual antes de registrar qualquer skill nova.

Esta recomendação é **INFERRED**, não resultado de execução. Os números medem arquivos que as instruções mandam carregar ou consultar, não tokens efetivamente vistos pelo modelo nem aderência do agente às ferramentas.

## Escopo e vocabulário

- **Skill**: instrução de fluxo carregada para o agente, armazenada em `SKILL.md`.
- **Micro-skill**: skill menor responsável por uma fase, acionada sequencialmente por uma skill coordenadora.
- **Handoff**: pacote mínimo de estado entregue de uma fase à seguinte.
- **Status file**: arquivo persistente de estado do worker, atualmente sob `.claude/vetor/status/` (com cópia fallback no worktree em alguns fluxos).
- **Gate**: ponto de decisão que permite, adia ou impede uma etapa. O gate de Spec/design decide se é preciso gerar uma Spec antes do dispatch; não avalia a qualidade da Spec (`wiki/Decisoes-de-Design.md:38-56`).
- **Contexto nominal**: bytes dos arquivos que a instrução manda carregar/ler. A contagem não prova que todo o conteúdo entrou efetivamente na janela de contexto do modelo.

O arquivo `C:\Projetos\Vetor\.alethe\context\issues-full.txt` contém o cabeçalho #372 e o título, sem corpo adicional. Este documento cobre a tarefa indicada pelo mantenedor nesta sessão.

## Método e diagnóstico medido

Medição dos arquivos atuais deste worktree em 2026-10-15. Bytes são o comprimento do arquivo em bytes; linhas são linhas de texto; tokens são estimados como `ceil(bytes / 4)`. Não foi encontrado/acionado tokenizer local; tokens são, portanto, **proxy explícito**, não contagem real. UTF-8 e conteúdo não textual podem afastar a estimativa do tokenizer do runtime. Tamanhos por arquivo são arredondados para cima e depois somados.

### Coordinator

O “contexto atual da fase” inclui o `SKILL.md` inteiro — a skill é carregada inteira — mais os arquivos referenciados para executar a atividade. Referências opcionais/condicionais não entram no subtotal-base. A extração #373 está registrada nos cabeçalhos dos arquivos `issue-coordinator-*.md` e na arquitetura (`wiki/Arquitetura.md:38-44`).

| Fase atual / arquivos considerados | Bytes | Linhas | Tokens proxy |
|---|---:|---:|---:|
| Triagem/plano/spec gate: coordinator + `planning-conventions.md` | 33.906 | 548 | 8.477 |
| Dispatch/criação: coordinator + dispatch + worker + `worktree-create/SKILL.md` | 49.749 | 847 | 12.438 |
| Sync/monitoramento/fechamento: coordinator + monitoring + report + `worktree-ship/SKILL.md` | 50.884 | 935 | 12.723 |
| Ciclo completo: arquivos distintos, coordinator sem duplicação | 78.565 | 1.430 | 19.645 |

Tamanhos individuais: coordinator 27.987 B/450 linhas; dispatch 10.190 B/141; monitoring 1.761 B/30; report 2.489 B/42; worker 6.973 B/114; create 4.599 B/142; ship 18.647 B/413; planning 5.919 B/98. A tabela é orçamento nominal conservador: nem toda primitiva está necessariamente simultaneamente no prompt. O coordinator declara a composição e as referências lidas em `skills/issue-coordinator/SKILL.md:39-48,321-413`.

A #373 reduziu o custo dos detalhes que não precisam ser abertos em cada fase, mas o coordinator ainda é carregado inteiro. Os números por fase representam o conjunto de instruções aplicável ao ciclo e não uma captura da janela efetiva do modelo. O contexto fornecido pelo mantenedor informa que o coordinator foi reduzido de 635 para 450 linhas; não inferi redução de tokens efetivos apenas desse dado.

### Fix loop

A skill declara o ciclo reproduce → fix e exige execução síncrona até estado terminal (`skills/fix-loop-agent/SKILL.md:10-21`). Referências condicionais não entram no subtotal-base. Ele inclui as referências recorrentes no caminho normal.

| Fase atual / arquivos-base | Bytes | Linhas | Tokens proxy |
|---|---:|---:|---:|
| Reproduce/diagnóstico: fix-loop + status template + project conventions + memory gotchas | 23.139 | 419 | 5.786 |
| Solve: fix-loop + status template + project conventions + touched-files cache + memory gotchas | 24.346 | 449 | 6.087 |
| Verify/encerramento: fix-loop + status template + project conventions + memory gotchas | 23.139 | 419 | 5.786 |

Tamanhos individuais: `fix-loop-agent/SKILL.md` 14.446 B/263 linhas; status template 3.677 B/68; project conventions 3.253 B/63; touched-files cache 1.207 B/30; memory gotchas 1.763 B/25. Referências adicionais condicionais: `tdd-conventions.md` 5.281 B/81; `mcp-availability.md` 9.736 B/128; `frontend-design-enforcement.md` 1.767 B/33; `evidence-state.md` 9.943 B/365; `delegate-to-runtime.md` 13.935 B/239. A skill lista referências e condições em `skills/fix-loop-agent/SKILL.md:48-79`.

### Projeção do desenho de micro-skills

São **estimativas de orçamento**, não tamanhos medidos de arquivos inexistentes. Supõem que cada micro-skill contenha apenas instrução local à fase e que o estado anterior venha em handoff estruturado. Cada subtotal inclui interface mínima de estado; as faixas representam trabalho de redação a validar.

| Pipeline proposto / micro-skill e contrato | Bytes estimados | Linhas estimadas | Tokens proxy |
|---|---:|---:|---:|
| Coordinator: `triage` | 8.000–12.000 | 130–200 | 2.000–3.000 |
| Coordinator: `dispatch` | 12.000–18.000 | 200–300 | 3.000–4.500 |
| Coordinator: `sync` | 10.000–16.000 | 165–265 | 2.500–4.000 |
| Fix: `reproduce` | 5.000–8.000 | 85–135 | 1.250–2.000 |
| Fix: `solve` | 7.000–11.000 | 115–185 | 1.750–2.750 |
| Fix: `verify` | 4.000–7.000 | 65–115 | 1.000–1.750 |

Cada número é o contexto isolado de uma invocação; arquivos externos lidos no runtime podem elevá-lo. A PoC deve substituir as projeções por contagens dos artefatos realmente preparados e, separadamente, telemetria de runtime.

## Fronteiras e interfaces propostas

### Pipeline A — coordinator → triage → dispatch → sync

**1. `triage`** recebe label/lista de issues, modo (`interactive`/`headless`) e limites de sessão. Descobre issues, agrupa em ondas, identifica dependências, classifica trivialidade e executa o gate de Spec/design. Preserva a decisão humana no modo interativo e a anotação não bloqueante em headless (`wiki/Arquitetura.md:46-57`; `wiki/Decisoes-de-Design.md:38-56`).

Handoff para `dispatch`: `run_id`, root do repo, modo e versão do schema; issues/grupos, dependências e ondas; decisão/aviso de Spec por issue com evidência; teto `N`, timeout restante e aprovação (ou marca headless); estado `planned` por grupo. Persistência proposta: `.claude/vetor/status/runs/<run_id>.json`, gravado atomicamente. Chat apresenta o plano, mas não é a única fonte de verdade. Manifesto contém resumos e ponteiros, não corpos integrais de issues ou rationale longo.

**2. `dispatch`** consome grupos `planned`, deriva slug/branch/status path, cria worktrees serializadamente e invoca issue-workers. O worktree real vem do harness/`git worktree list`, nunca é deduzido do slug (`issue-coordinator-dispatch.md:5-21`). Não contornar a serialização existente de criação.

Handoff por grupo: `group_id`, issue(s), onda, slug/branch nominal, status path absoluto, worktree real quando conhecido, prompt mínimo, configuração de testes resolvida e resultado (`queued/running/failed`). Worker continua dono do status operacional e do código; coordinator não duplica commits ou progresso detalhado.

**3. `sync`** lê status files, worktrees e PRs; decide transições de onda; trata bloqueios e reporta. Usa `worktree-ship` para testes, PR/CI e merge serializado. `--headless` permanece sem merge (`skills/issue-coordinator/SKILL.md:78-84`; `wiki/Decisoes-de-Design.md:60-69`). Só transiciona onda quando os pré-requisitos atuais de dispatch forem atendidos.

Estado persistido por grupo: (`queued`, `running`, `blocked`, `green`, `shipped`, `failed`), último status observado, branch/worktree, PR, onda, tentativa, timestamp e observação curta. A fonte operacional continua status files + GitHub; manifesto é índice reconstruível, não substituto. O relatório fecha 1:1 contra os grupos planejados (`issue-coordinator-report.md:18-42`).

### Pipeline B — fix-loop-agent → reproduce → solve → verify

**`reproduce`** grava status `RUNNING` antes de qualquer ação, confirma worktree, encontra módulo/teste e registra evidência reproduzível. Não corrige. Saída: comando, resultado/código de saída, evidência curta, módulos, baseline git e estado `reproduced` ou `not_reproduced`.

**`solve`** recebe reprodução confirmada, aplica a menor correção e o teste de regressão apropriado; mantém iteração, orçamento, cache de arquivos tocados e responsabilidade decisória do agente. Saída: resumo do diff, testes tentados, iteração atual e estado `candidate` ou bloqueio estruturado.

**`verify`** executa testes por módulo e checks finais, confere diff e atualiza status para `GREEN`, `FAILED_MAX_ITERATIONS` ou `BLOCKED_WAITING`. Em falha retorna a `solve` com iteração incrementada. Não pode encerrar após teste falho nem perder a garantia de execução síncrona (`skills/fix-loop-agent/SKILL.md:10-21,83-116,173-225`).

Estado transferido: `run_id`, repo/worktree, branch, issue/tarefa, status path, `DEFAULT_BRANCH`, mapa de módulos/testes, resumo de evidência, iteração/limite, arquivos tocados, últimos resultados e bloqueio com opções/recomendação. Persiste no status file existente e, na PoC, em handoff JSON versionado associado ao run. Logs e diffs extensos ficam em arquivo apontado por caminho/hash, não são copiados para a próxima instrução.

## Handoff econômico sem reinjeção de contexto

- **Flags CLI:** adequadas a parâmetros pequenos e estáveis (`--run-id`, `--phase`, `--headless`). Não passar listas grandes, logs ou Specs como argumentos de shell.
- **Status files:** adequados a estado durável e retomável, já centrais ao coordinator/worker (`wiki/Decisoes-de-Design.md:1-5,20`). Na PoC, usar schema versionado e gravação atômica. O leitor aceita ausência/cópia fallback e reconstrói via GitHub/worktree quando possível. Não introduzir JSON concorrente como fonte de verdade sem testar reconciliação.
- **ai-memory:** pode fornecer referências a decisões/gotchas, mas não deve carregar estado efêmero nem ser requisito para avançar. O fluxo atual consulta memory-gotchas opcionalmente e continua se o MCP falhar (`skills/fix-loop-agent/SKILL.md:65-69,97`). Handoff leva IDs/links e resumo mínimo, sem reinjetar memória integral.
- **Regra de contexto:** a fase seguinte recebe apenas campos necessários e ponteiros à evidência. Não repetir prompt original, corpo integral das issues ou saída anterior já persistida. Consultar estado seletivamente por `run_id`/grupo.
- **Compatibilidade:** fases podem ser retomadas isoladamente. Schema incompatível gera erro claro e permite reconstrução por status/GitHub, sem adivinhação.

“ai-memory” aparece no escopo fornecido pelo mantenedor, mas não há referência com esse nome nos arquivos observados. A interface trata-o como integração hipotética; não afirma disponibilidade, formato ou ferramenta instalada.

## Comparação com a alternativa #373

| Critério | Referências sob demanda (#373) | Micro-skills sequenciais |
|---|---|---|
| Estrutura | Um fluxo; procedimentos longos extraídos | Fases viram invocações e contratos explícitos |
| Contexto comum | Skill principal ainda carregada inteira; detalhes abertos quando necessários | Cada fase poderia carregar apenas instrução local e handoff |
| Estado | Memória de sessão, status files e fontes externas | Precisa serializar aprovações, ondas, iteração e retomada |
| Custo | Menor; já aplicado e documentado | Novas skills, schema, roteamento, reconciliação e regressões |
| Falha típica | Referência não lida; skill-base ainda extensa | Handoff incompleto/desatualizado; fase pulada/repetida; estado conflitante |
| Evidência | Coordinator atual tem 450 linhas e referências sob demanda | Nenhum protótipo nem medição de execução neste spike |

A decisão documentada afirma que SKILL.md é carregado inteiro e recomenda instrução operacional na skill, rationale na wiki e procedimentos reutilizáveis em referências (`wiki/Decisoes-de-Design.md:26-36`). Micro-skills atacam o custo do texto comum repetido por fase; #373 ataca detalhes condicionais. A escolha depende de provar que o custo residual justifica o custo e risco do estado serializado.

## Aderência a ferramentas: limite e medição

Aderência não é mensurável lendo os arquivos. Sem execução em runtime não se sabe se o agente abriu a referência, usou flags corretamente, gravou todos os campos, chamou ship ou seguiu fallback.

Na PoC, registrar eventos estruturados: fase iniciada/concluída, arquivos de contexto solicitados, campos obrigatórios presentes, ferramenta/comando invocado, transições, repetição e decisões de merge. Auditar artefatos contra matriz de critérios e fazer revisão humana dos handoffs/resultados. Menção de ferramenta em transcript não prova execução. Reportar denominador de execuções/transições e desvios.

## Riscos e salvaguardas

- **Histórico `worktree-session` — CONFIRMED:** foi aposentada por ser “monolítica demais, perdia contexto”; arquitetura recomenda `worktree-create` + `worktree-ship` (`wiki/Arquitetura.md:71-73`). Isso apoia composição, mas não prova que dividir cada fase é melhor; a composição atual já separa primitivas. Evitar criar um orquestrador maior para administrar micro-agentes.
- **Perda de invariantes:** status inaugural, headless, síncrono, orçamento, bloqueios epistemológicos e segurança de worktree podem se espalhar. Manter contrato comum curto e validar transições.
- **Regressão do gate Spec:** preservar pergunta humana e anotação headless; testar ambos e retomada.
- **Merge fora de ordem/sem aprovação:** sync respeita merge serializado e proibição de merge headless. `GREEN` não basta para autorizar merge.
- **Estado duplicado/inconsistente:** há limitações conhecidas de escrita fora do worktree (#94), cwd cruzado (#63) e worktrees aninhados (#95) (`wiki/Decisoes-de-Design.md:20-24`). Manter fallback e verificações de vínculo agente/worktree.
- **Reinjeção disfarçada:** handoff com transcript/log/diff integral elimina economia. Persistir ponteiros e resumo limitado; medir bytes lidos na etapa seguinte.
- **Transição repetida/falha:** operação idempotente ou detecção por `run_id + phase + group_id`; interrupção não despacha duplicado.
- **Dependência do runtime:** testar composição sequencial no runtime alvo; não supor interoperabilidade entre hosts.
- **Falso ganho de tamanho:** bytes/4 não é tokenizer. Substituir por tokenizer compatível se disponível e registrar versão, preservando bytes/linhas para reprodução.

## Recomendação e plano de PoC

**Decisão proposta — INFERRED:** manter #373 como padrão agora. Fazer PoC primeiro no `fix-loop-agent`, ciclo local de um worker; usar coordinator como baseline de risco/estado. Se houver economia material e handoff confiável, prototipar triage/dispatch/sync depois. É proposta ao mantenedor, não decisão aprovada.

### Desenho da PoC

1. **Artefatos temporários:** em branch/worktree experimental, criar `skills/fix-loop-agent/poc/reproduce.md`, `solve.md`, `verify.md` (não instaláveis), `skills/fix-loop-agent/poc/handoff.schema.json` e runner de simulação fora do caminho normal. Esses arquivos são proposta, não parte deste entregável.
2. **Baseline:** executar casos fixos no fluxo atual e registrar arquivos carregados, bytes/linhas/tokens com tokenizer compatível ou proxy bytes/4. Capturar estado terminal, comandos, iterações e custo/tempo se o runtime expuser.
3. **Simulação sequencial:** invocar fases manualmente via runner e handoff versionado. Não alterar `issue-worker`, coordinator, hooks, comandos normais, `worktree-create` ou `worktree-ship`; não tocar em branches remotas/ciclo real de entrega.
4. **Casos:** bug reproduzível; não reproduzido; teste continua falhando após fix; limite de iterações; bloqueio de permissão; MCP de memória ausente; retomada após encerrar sessão entre fases. Usar fixture descartável e worktree local isolado, sem PR/merge/push.
5. **Não regressão do ciclo de worktree:** capturar `git worktree list --porcelain`, branch/status e arquivos antes/depois. Exigir branch default intacta, nenhum worktree imprevisto, nenhuma alteração externa à fixture e remoção segura apenas do worktree temporário. Nunca envolver coordinator real ou `worktree-ship` em merge. Integração futura do coordinator começa com dry-run comparando manifesto/status a snapshots, sem worktree real.
6. **Critérios de sucesso:** (a) redução mediana ≥30% dos tokens efetivamente carregados por fase contra baseline; (b) 100% dos campos obrigatórios e estados terminais corretos; (c) zero dispatch duplicado, perda de status, encerramento após falha ou merge não autorizado; (d) retomada sem reinjetar prompt/contexto integral; (e) custo/latência total não piora mais de 15% sem justificativa de qualidade. Exigir ao menos 10 execuções por cenário crítico; se inviável, evidência insuficiente, sem declarar sucesso.
7. **Decisão posterior:** comparar com baseline #373. Falha de segurança descarta PoC; pouca economia favorece referência sob demanda/edição da skill; sucesso leva a issue separada para implementação, compatibilidade e fallback gradual.

## Referências principais

- `wiki/Arquitetura.md:38-44,46-61,71-73` — referências, gate e histórico `worktree-session`.
- `wiki/Decisoes-de-Design.md:20-36,38-69` — limites, rationale de contexto e gate/headless.
- `skills/issue-coordinator/SKILL.md:39-48,78-109,198-248,321-413,440-448` — composição, modos, triagem, refs sob demanda, sync e relatório.
- `skills/shared/references/issue-coordinator-dispatch.md:1-21` — extração #373 e dispatch.
- `skills/shared/references/issue-coordinator-monitoring.md:1-22`; `issue-coordinator-report.md:1-42` — monitoramento/fechamento.
- `skills/fix-loop-agent/SKILL.md:10-21,48-79,83-116,173-225` — invariantes e ciclo atual.
- `agents/issue-worker.md:43-71,99-113` — status e responsabilidades.
- `skills/worktree-create/SKILL.md:118`; `skills/worktree-ship/SKILL.md:54-63,308-402` — criação e entrega.


