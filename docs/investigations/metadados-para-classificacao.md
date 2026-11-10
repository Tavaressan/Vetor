# Investigação: metadados existentes para classificação determinística de tarefas

**Issue:** #620 — spike(execution): metadados existentes para classificação determinística de
tarefas\
**Data:** 2026-11-10\
**Base:** `master` em `500578c` (worktree `spike-620-opencode`, `git rev-parse --short HEAD`
executado em 2026-11-10)\
**Contexto:** ADR-002
(`/home/tavaressan/Projects/orca/workspaces/Vetor/brittlestar/docs/adr/ADR-002-capability-based-execution-routing.md`,
leitura somente, não commitado) Fase 0 objetivo 4 e questões abertas 7 e 9, §4.3; ADR-001
(`docs/adr/ADR-001-runtime-independence.md`); matriz de capacidades da #568
(`skills/shared/references/harness-capabilities.md`, `wiki/Contrato-de-Capacidades.md`); relatórios
`docs/investigations/runtime-boundary.md`, `docs/investigations/orchestrator-adapter-contract.md`,
`docs/investigations/orca-adapter.md`, `docs/investigations/teto-de-workers.md`,
`docs/investigations/dispatch-na-nuvem.md`.

**Rótulos:** **[Fato]** verificado na fonte citada ou em comando registrado · **[Inferência]**
conclusão derivada dos fatos · **[Opinião]** juízo técnico.

---

## 1. Pergunta

O Task Profiler da ADR-002 deve classificar tarefas de forma determinística a partir de metadados já
existentes, evitando chamadas extras a modelo (ADR-002 §4.3). O spike responde:

1. Que fontes existentes carregam sinal útil: labels de issue, specs e critérios de aceite,
   ContextPacket, arquivos-alvo, module-test-map, metadados do coordinator?
2. Para uma amostra de issues reais (incluindo as já fechadas), a classificação determinística
   recupera domínio, operação, complexidade e risco de forma coerente com o que foi de fato
   necessário?
3. Quando a informação estrutural é insuficiente, como medir a confiança e qual limiar justifica o
   fallback semântico opcional?
4. Que metadados do coordinator podem ser reutilizados sem acoplar o profiler ao coordinator?

## 2. Resumo

- **[Fato]** O repositório já possui fontes estruturadas e determinísticas para classificação:
  prefixo convencional do título da issue (`<tipo>(<escopo>): ...`), labels, critérios de aceite em
  checklist no body, extração de arquivos-alvo entre crases, `module-test-map.md`, `ContextPacket`,
  micro-spec JIT, parser/validador de Spec e status files. A cobertura varia: o título/labels cobrem
  quase toda a amostra, enquanto arquivos-alvo explícitos e vínculo formal a Spec aparecem com menor
  frequência (`analisar.ts`, `resultado.json`, §3.2, §4).
- **[Fato]** O protótipo descartável `docs/investigations/metadados-para-classificacao/analisar.ts`,
  aplicado a 50 issues reais (abertas e fechadas) obtidas por
  `gh issue list --state all --limit 50`, classificou 41 issues com PR de fechamento comparável
  (`resultado.json`, `summary.withPr = 41`). Resultado: acerto estrito 24/41 = **58,5%**, acerto
  parcial ou melhor 41/41 = **100%**; por dimensão, domínio 80,5%, operação 100%, complexidade
  48,8%, risco 73,2%, requisitos 73,2% (comando:
  `deno run -A docs/investigations/metadados-para-classificacao/analisar.ts --issues /tmp/vetor-issues-620.json --out docs/investigations/metadados-para-classificacao/resultado.json --fetch-prs --repo Tavaressan/Vetor --limit 50`).
- **[Fato]** Os principais casos ambíguos observados foram: (a) spikes rotuladas como
  `scripts`/`compat` cujo PR real tocou apenas `docs/investigations/` (ex.: #587, #585, #583, #582,
  #577 no `resultado.json`), inflando domínio/complexidade previstos; (b) refactors/enhancements com
  escopo real maior que o inferido pelos metadados (ex.: #574 com 54 arquivos, #569 com 36, #568 com
  24); (c) divergência de risco/requisitos em mudanças que atravessam hooks, agentes e scripts
  apesar de labels genéricas (ex.: #563, #562, #540). Complexidade é a dimensão menos confiável por
  heurística simples.
- **[Inferência]** A classificação determinística é viável para domínio provável, operação e parte
  dos requisitos, mas não basta sozinha para estimar complexidade e risco fino sem sinais adicionais
  (Spec/micro-spec, histórico de arquivos/módulos, tamanho e dispersão do diff esperado). Um limiar
  de confiança composto deve acionar fallback semântico opcional apenas quando sinais estruturais
  críticos estiverem ausentes ou em conflito.
- **[Opinião]** O `TaskProfile` deve ser refinado para separar fatos observados (`evidence`) de
  inferências (`inferred`), registrar confiança por campo e por decisão global, e explicitar
  `needsSemanticFallback` com motivo. O profiler deve consumir saídas já materializadas
  (ContextPacket, Spec parseada, module-test-map, labels/título/body) e nunca ler estado interno
  mutável do coordinator.

## 3. Inventário de fontes de metadados

### 3.1 Tabela de fontes, sinal, cobertura e lacunas

| Fonte                                       | Onde existe                                                                                                                   | Sinal útil para classificação                                                                                                                                               | Cobertura observada (amostra/protótipo)                                                                                                                                                                                                                                                                    | Lacunas                                                                                                                                                                                            | Evidência                                                                                                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Labels da issue**                         | GitHub issue (`gh issue view/list --json labels`)                                                                             | Tipo/categoria (`bug`, `enhancement`, `spike`, `documentation`), módulo/área (`scripts`, `skills`, `cli`, `hooks`, `compat`), marcadores de origem (`ai-generated`)         | Alta: 50/50 issues da amostra tinham labels; o protótipo usou labels em toda classificação (`resultado.json`, cada `row.labels`)                                                                                                                                                                           | Labels indicam intenção/área declarada, não artefato real entregue; spikes de investigação frequentemente carregam label de módulo (`scripts`) mas produzem docs (`#587,#585,#583,#582,#577`)      | `gh issue view 620 --json ...` (2026-11-10); `resultado.json` rows 587,585,583,582,577                                                                                                   |
| **Título (prefixo convencional)**           | `title` da issue                                                                                                              | Operação (`fix`, `feat`, `docs`, `spike`, `refactor`, `perf`, `test`, `chore`), escopo entre parênteses, pista de domínio                                                   | Alta: parser `^([a-z]+)(?:\(([^)]+)\))?!?:` no protótipo (`analisar.ts: parseTitleOp`)                                                                                                                                                                                                                     | Nem todo título traz escopo útil; escopo pode ser amplo (`compat`, `coordinator`)                                                                                                                  | `scripts/lib/orchestrator/context-packet.ts` não parseia tipo, mas `scripts/lib/orchestrator/dispatch-prompt.ts:57-71` deriva slug/tipo por convenção; `resultado.json`                  |
| **Body: critérios de aceite (checklist)**   | Body da issue, itens `- [ ]`                                                                                                  | Quantidade e presença de critérios; proxy de escopo/complexidade e verificabilidade                                                                                         | **[Fato]** `extractAcceptanceCriteria` extrai checklists (`scripts/lib/orchestrator/context-packet.ts:88-93`); `context.issue.acceptanceCriteria` entra no ContextPacket (`context-packet.ts:201`). **[Inferência]** cobertura útil quando issue segue template, mas variável                              | Checklist não descreve requisitos não-funcionais (browser, paralelismo, sensibilidade) nem esforço real                                                                                            | `scripts/lib/orchestrator/context-packet.ts:88-93,196-221`; `scripts/tests/context-packet_test.ts`                                                                                       |
| **Body/título: arquivos-alvo entre crases** | Tokens `` `path/ext` ``                                                                                                       | Módulos e arquivos provavelmente tocados; base para `resolveModule` e domínio                                                                                               | **[Fato]** extração por `extractTargetFiles` (`context-packet.ts:95-122`) e resolução por prefixo mais longo com catch-all (`context-packet.ts:124-182`)                                                                                                                                                   | Muitos issues não citam paths; paths citados podem ser exemplos, não alvos reais; `targetFiles` pode ser sobrescrito (`scripts/context-packet.ts` CLI `--target-files`)                            | `scripts/lib/orchestrator/context-packet.ts:95-182`; `scripts/context-packet.ts:1-120`                                                                                                   |
| **`module-test-map.md`**                    | `.claude/vetor/module-test-map.md` (resolvido a partir do root)                                                               | Mapeamento prefixo→módulo e comando de teste por módulo; delimita domínio operacional e custo de validação                                                                  | **[Fato]** presente no repo: módulos `root` (`deno task test`) e `cli` (`cd cli && npm test`) com prefixos `cli/` e `./` (`.claude/vetor/module-test-map.md`)                                                                                                                                              | Reflete estrutura de teste, não semântica de domínio fino; tabelas desatualizadas geram erro ou fallback (`context-packet.ts:160,192`)                                                             | `.claude/vetor/module-test-map.md` (lido 2026-11-10); `scripts/lib/orchestrator/context-packet.ts:124-182`                                                                               |
| **ContextPacket**                           | `scripts/lib/orchestrator/context-packet.ts`, CLI `scripts/context-packet.ts`                                                 | Pacote determinístico com issue (número, título, slug, AC), worktree, módulo, `testCommand`, `targetFiles`, `microSpec`, `conventions`, `repoMap` opcional                  | **[Fato]** schema `https://vetor.dev/schemas/context-packet.v1.json` (`context-packet.ts:13,59-64`); usado no prompt do worker (`dispatch-prompt.ts:35,153,186-193`)                                                                                                                                       | Gerado no dispatch: útil como **entrada/saída do profiler** ou artefato derivado, mas não existe antes do planejamento; `repoMap` pode ser omitido por aviso (`scripts/context-packet.ts:120-200`) | `scripts/lib/orchestrator/context-packet.ts`; `scripts/context-packet.ts`; `scripts/lib/orchestrator/dispatch-prompt.ts`                                                                 |
| **Micro-spec JIT**                          | `docs/specs/micro/<issue>-<slug>.md`, `scripts/lib/orchestrator/micro-spec.ts`                                                | Objetivo, exatamente 3 critérios de aceite e 2 non-goals; forte sinal de escopo e risco delimitado                                                                          | **[Fato]** validação estrutural rígida (`micro-spec.ts:31-58`: Objetivo, 3 AC, 2 non-goals, máx. 60 linhas)                                                                                                                                                                                                | Só existe para issues não-triviais sem Spec e quando gerada; é conteúdo sintetizado (precisa validação), não metadado humano primário                                                              | `scripts/lib/orchestrator/micro-spec.ts`; `scripts/context-packet.ts` carrega/valida `--micro-spec`                                                                                      |
| **Specs formais**                           | `docs/specs/<slug>.md`, `scripts/lib/spec-parser.ts`                                                                          | Requisitos, prioridades (P1/P2/P3), critérios de aceite por requisito, dependências, seções de aceite; suporta classificação de complexidade/risco por volume e criticidade | **[Fato]** parser extrai overview, requisitos com `priority`/`acceptanceCriteria`/`dependencies`, critérios e restrições (`scripts/lib/spec-parser.ts:1-220`)                                                                                                                                              | Nem toda issue tem Spec; vínculo issue↔Spec é por convenção/referência no texto, não chave forte no schema observado                                                                               | `scripts/lib/spec-parser.ts`; referência a Spec no coordinator (`skills/coordinator/SKILL.md`)                                                                                           |
| **Metadados do coordinator**                | status files (`skills/shared/references/agent-status.template.md`), state/artefatos `.claude/vetor/*`, prewarm, dispatch refs | Branch, issue em execução, iteração, status terminal, SHA testado, PR, worktree, reason/timeout de suspensão                                                                | **[Fato]** status file canônico em `<repo-root>/.claude/vetor/status/<branch>.md` com `Status`, `Iteration`, `Tested`, `Blocked on`, `PR` etc. (`agent-status.template.md`); coordinator cria/usa dispatch e DAG (`skills/coordinator/SKILL.md`, `skills/shared/references/issue-coordinator-dispatch.md`) | Metadados de **execução em andamento**, não de classificação pré-dispatch; acoplar a eles cria dependência circular (profiler roda antes/para decidir dispatch)                                    | `skills/shared/references/agent-status.template.md`; `skills/coordinator/SKILL.md`; `.claude/vetor/module-test-map.md` (único estado versionado local observado por `ls .claude/vetor/`) |
| **PR e diff que fechou a issue**            | `closedByPullRequestsReferences`, `gh pr view --json files`                                                                   | “Verdade” observada do que foi necessário (arquivos/módulos tocados, volume) — útil para calibração, não para predição                                                      | **[Fato]** 41/50 issues comparadas tinham PR com arquivos acessíveis (`resultado.json`, `summary.withPr=41`)                                                                                                                                                                                               | Só existe após execução; acesso exige `gh` e rede; não deve ser fonte do profiler em runtime, só de avaliação offline                                                                              | `analisar.ts` (`fetchPR`, `--fetch-prs`), `resultado.json`                                                                                                                               |

### 3.2 Cobertura quantitativa no protótipo

**[Fato]** Comandos registrados:

- Coleta:
  `gh issue list --state all --limit 60 --json number,title,labels,state,body,closedAt,createdAt,closedByPullRequestsReferences,url > /tmp/vetor-issues-620.json`
  (2026-11-10, 60 issues).
- Análise:
  `deno run -A docs/investigations/metadados-para-classificacao/analisar.ts --issues /tmp/vetor-issues-620.json --out docs/investigations/metadados-para-classificacao/resultado.json --fetch-prs --repo Tavaressan/Vetor --limit 50`
  (2026-11-10).

**[Fato]** Resultado (`resultado.json.summary`): `total=50`, `withPr=41`,
`counts={acerto:24, parcial:17, erro:0, sem-pr:9}`, `accuracyOverall=0.585`,
`accuracyPartialOrBetter=1.0`, dimensões: `domain=0.805`, `operation=1.0`, `complexity=0.488`,
`risk=0.732`, `requirements=0.732`. Os 9 sem PR incluem 6 issues OPEN e 3 CLOSED sem referência de
PR comparável na amostra coletada (#558, #557, #556 no recorte `resultado.json`).

## 4. Resposta às perguntas do spike

### 4.1 Pergunta 1 — Fontes, cobertura e lacunas

**[Fato]** As fontes com maior valor determinístico **antes do dispatch** são: (1) título com
prefixo/escopo (`dispatch-prompt.ts:57-71`, `context-packet.ts` usa título/slug), (2) labels, (3)
checklist de critérios de aceite (`context-packet.ts:88-93`), (4) arquivos-alvo extraídos de crases
(`context-packet.ts:95-122`) e sua resolução contra `module-test-map.md`
(`context-packet.ts:124-182`), e (5) Spec/micro-spec quando existentes (`spec-parser.ts`,
`micro-spec.ts`). **[Inferência]** Juntas, elas cobrem bem operação e domínio grosseiro; cobrem
parcialmente requisitos, complexidade e risco.

**[Fato]** `ContextPacket` já consolida parte dessas fontes para o worker
(`issue.acceptanceCriteria`, `context.module`, `testCommand`, `targetFiles`, `microSpec?`,
`repoMap?` em `context-packet.ts:15-64,184-219`), mas é produzido no fluxo de dispatch
(`scripts/context-packet.ts`, `scripts/dispatch-prompt.ts:171-211`). **[Inferência]** Para o Task
Profiler, o ContextPacket é o melhor **formato-alvo de entrada normalizada** (ou um subconjunto
dele) se construído em modo de análise/planejamento sem depender de worktree real.

**[Fato]** Metadados do coordinator existem e são ricos para execução (status file, PR, SHA testado,
suspensão/timeout, worktree — `agent-status.template.md`, `skills/coordinator/SKILL.md`), porém
pertencem ao ciclo de vida do dispatch. **[Inferência]** Podem informar calibração offline, não o
profiler online (ver §4.4).

### 4.2 Pergunta 2 — Amostra real, taxa de acerto e casos ambíguos

**[Fato]** Amostra: 50 issues (abertas e fechadas) de `Tavaressan/Vetor`, recorte
`gh issue list --state all --limit 50` salvo em `/tmp/vetor-issues-620.json` e analisado em
`resultado.json` (2026-11-10). Comparação "previsto vs. necessário" usou, para issues com PR de
fechamento, os arquivos alterados dos PRs referenciados (`closedByPullRequestsReferences`,
`gh pr view --json files`) como proxy determinístico do que foi de fato tocado (`analisar.ts`:
`fetchPR`, `classifyActual`, `compare`).

**[Fato]** Taxas (41 issues comparáveis): acerto estrito 58,5% (24), parcial 41,5% (17), erro 0%,
parcial+acerto 100%. Por dimensão: domínio 80,5%, operação 100%, complexidade 48,8%, risco 73,2%,
requisitos 73,2% (`resultado.json.summary`).

**[Fato]** Casos ambíguos representativos (extraídos de `resultado.json`):

| Issue      | Previsto (domínio/op/complex./risco)                     | Real observado (PR)                                                                                     | Por que divergiu                                                                     |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| #587       | scripts/automação\|orchestrator / spike / medium / low   | documentação / spike,docs / low / low, 1 arquivo `docs/investigations/orchestrator-adapter-contract.md` | Label `scripts` + título de spike induziu domínio de código; entrega foi relatório   |
| #585       | scripts/automação\|native / spike / medium / low         | documentação / spike,docs / low / low, 2 arquivos em `docs/investigations/`                             | Mesmo padrão de spike de investigação                                                |
| #583, #582 | scripts/automação\|system / spike / medium / low         | documentação / spike,docs / low / low, 2-3 arquivos                                                     | Mesmo padrão                                                                         |
| #577       | compatibilidade\|worktree / spike / medium / low         | documentação / spike,docs / low / low, 1 arquivo                                                        | Label `compat` não implicou mudança em código de compat                              |
| #574       | skills/fluxos / refactor,implement / medium / medium     | agents+skills+docs / refactor,implement / high / high, 54 arquivos                                      | Escopo real muito maior que o sugerido por labels/título                             |
| #569       | scripts/automação / refactor,implement / medium / medium | docs+opencode+scripts+skills / refactor,implement,test / high / high, 36 arquivos                       | Refatoração transversal subestimada                                                  |
| #568       | compatibilidade / docs / medium / medium                 | scripts+skills+docs / docs,test / high / high, 24 arquivos                                              | "docs(compat)" gerou mudanças amplas em skills e testes de contrato                  |
| #563       | safety / enhancement / medium / medium                   | scripts+docs / enhancement,implement,test / medium / high, 3 arquivos                                   | Risco de segurança/hook subestimado pela ausência de label específica                |
| #540       | hooks/segurança / fix / high / high                      | agents+scripts+skills / fix,test / high / medium, 6 arquivos                                            | Domínio real atravessou agentes/skills além de hooks; risco previsto alto mas difuso |

**[Inferência]** Operação é fácil quando o título segue convenção (100% no recorte). Domínio erra
principalmente em spikes (label de área vs. artefato entregue) e em mudanças transversais.
Complexidade falha por depender de dispersão real (nº de arquivos/módulos) que metadados textuais
antecipam mal. Requisitos `browser/parallelism/longContext` raramente aparecem explícitos em issues
deste repo, então o classificador tende a acertar por omissão, não por evidência positiva.

**[Fato]** Limitação do método: o "real" foi aproximado pelos arquivos do PR de fechamento, não por
uma taxonomia manual independente. **[Inferência]** Isso mede aderência ao impacto em
código/artefatos melhor do que "intenção original", mas pode superestimar operação `test/docs`
quando o PR inclui testes/ajustes colaterais.

### 4.3 Pergunta 3 — Confiança insuficiente e limiar para fallback semântico opcional

**[Fato]** O protótipo atribuiu confiança composta por sinais (`titlePrefix`, `label`,
`targetFiles`, `acceptanceCriteria`, `titleScope`) com base 0,2 e teto 1,0 (`analisar.ts`:
`classify()`), resultando em 50/50 issues com confiança ≥ 0,7 no bucket atual
(`resultado.json.summary.byConfidenceBucket`). **[Inferência]** Esse escore é otimista porque conta
sinais fracos como suficientes e não penaliza conflitos (ex.: label `scripts` + entrega documental
de spike). Ele não deve ser usado como limiar real sem calibração.

**[Opinião]** Proposta de confiança determinística por decisão (0–1), calculada sem modelo:

| Sinal                                                    | Peso sugerido | Condição                                                                                                               |
| -------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Prefixo de operação reconhecido no título                | +0,20         | `fix/feat/docs/spike/refactor/test/chore/perf/ci`                                                                      |
| Labels de tipo e módulo consistentes                     | +0,15         | pelo menos 1 label de tipo e 1 de área/módulo                                                                          |
| Critérios de aceite estruturados                         | +0,10         | ≥1 checklist; +0,05 extra se ≥3 (cap em 0,15)                                                                          |
| Arquivos-alvo extraídos e resolvidos em módulo conhecido | +0,20         | `targetFiles` não vazio e `resolveModule` não cai no catch-all por ausência total                                      |
| Spec/micro-spec válida associada                         | +0,20         | Spec parseável ou micro-spec válida (`validateMicroSpec`)                                                              |
| Consistência título × labels × tipo de issue             | +0,10         | ex.: `spike` label/título alinhados; sem contradição óbvia                                                             |
| Penalidades                                              | -0,10 a -0,30 | sem labels úteis; body vazio/muito curto; só catch-all; sinais contraditórios (bug + docs-only aparente sem evidência) |

**[Opinião]** Confiança por campo: `operation` e `git/filesystem/terminal` (quase sempre
necessários) tendem a alta; `domain` média; `complexity`, `risk`, `browser`, `parallelism`,
`dataSensitivity` baixas a menos que haja evidência explícita (Spec, AC, paths, palavras-chave
fortes).

**[Opinião]** Limiar proposto para fallback semântico opcional (conforme ADR-002 §4.3: "opcional
quando informação estruturada é insuficiente"):

- **`confidence_global >= 0,75` e nenhum campo obrigatório abaixo de 0,60:** classificação
  determinística aceita; sem chamada de modelo.
- **`0,50 <= confidence_global < 0,75` ou algum campo obrigatório entre 0,40 e 0,60:** aceitar
  determinístico para campos de alta confiança (ex.: operação) e marcar `needsSemanticFallback=true`
  apenas para campos incertos; se o runtime não suportar fallback, retornar perfil com incerteza
  explícita.
- **`confidence_global < 0,50` ou ausência de título/labels/body útil:** acionar fallback semântico
  opcional para `domains`, `requirements`, `complexity`, `risk`; se indisponível, classificar como
  `unknown/low-confidence` com defaults conservadores (`requirements` só núcleo, `risk` pelo menos
  `medium` quando houver mutação de código, `parallelism=false`).

**[Inferência]** Campos "obrigatórios" mínimos para seleção de executor no sentido da ADR-002 §4.4
são os requisitos booleanos mandatórios da tarefa
(`filesystem/terminal/browser/git/parallelism/longContext`) e restrições declaradas;
`complexity`/`risk` podem influenciar score, mas não devem bloquear sozinhos.

### 4.4 Pergunta 4 — Metadados do coordinator reutilizáveis sem acoplamento

**[Fato]** O coordinator produz/consome: status files e estados (`RUNNING`, `BLOCKED_WAITING`,
`SUSPENDED`, `GREEN`, `PR_STAGED`, `FAILED_MAX_ITERATIONS`, `EJECTED`) com branch, iteração, SHA
testado, PR e bloqueios (`agent-status.template.md`); seleção e despacho por ondas/grupos, checagem
de duplicidade e de PRs órfãos (`skills/coordinator/SKILL.md`, `issue-coordinator-dispatch.md`);
pre-warming (`skills/shared/references/worktree-prewarm.md`); e lógica de orquestração que depende
de subagentes/worktree isolation/background (`coordinator` `compatibility`).

**[Opinião]** Reutilizáveis **sem acoplar o profiler ao coordinator** (como dados/contratos, não
como chamada ao coordinator):

| Metadado/artefato                                                                                                                            | Pode reutilizar?                          | Como                                                                                         | Risco de acoplamento se mal usado                            |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `module-test-map.md` (módulos, prefixos, comandos)                                                                                           | Sim                                       | Entrada determinística do profiler/planner para domínio operacional e `testCommand` esperado | Baixo; é artefato de config do repo (`.claude/vetor/`)       |
| Algoritmos de extração/resolução do ContextPacket (`extractAcceptanceCriteria`, `extractTargetFiles`, `parseModuleTestMap`, `resolveModule`) | Sim                                       | Reusar `scripts/lib/orchestrator/context-packet.ts` como biblioteca pura                     | Baixo, desde que o profiler não exija dispatch/worktree      |
| Micro-spec e Spec parseadas                                                                                                                  | Sim                                       | Entrada de requisitos/AC quando existir                                                      | Baixo                                                        |
| `repoMap` escopado gerado por CLI                                                                                                            | Sim, opcional                             | Só para enriquecer contexto de estimativa, nunca requisito                                   | Médio (custo/IO), mas não acopla ao coordinator              |
| Regras de nome de branch/slug/tipo de issue (`dispatch-prompt.ts:52-68`, convenções)                                                         | Sim                                       | Normalização de operação/domínio                                                             | Baixo                                                        |
| Status file, iteração, `SUSPENDED`, SHA testado, decisão inbox, PR_STAGED                                                                    | **Não** como entrada primária do profiler | Podem alimentar **telemetria/histórico** (ADR-002 §9) após execução                          | Alto: dependem do ciclo do coordinator e de harness/execução |
| DAG/ondas, escolha de modelo, teto de workers, prewarm, inbox                                                                                | Não                                       | Permanecem responsabilidades de planejamento/execução                                        | Alto: copiaria lógica do coordinator para o profiler         |

**[Opinião]** Regra de fronteira: o Task Profiler pode depender de **artefatos do repositório e da
issue** e de **funções puras** já existentes; não pode importar nem consultar estado de runtime do
coordinator, prompts de dispatch, status files vivos, nem heurísticas de escalonamento.

## 5. Proposta de limiar de confiança e contrato refinado de `TaskProfile`

### 5.1 Contrato refinado (proposta)

**[Opinião]** Evolução aditiva sobre o esboço da ADR-002 §4.3, preservando compatibilidade
conceitual:

```ts
interface TaskProfile {
  profileVersion: 1;
  source: {
    issue?: { number: number; title: string; labels: string[]; url?: string };
    specPath?: string;
    microSpecPath?: string;
    analyzedAt: string; // ISO 8601
  };
  domains: string[];
  operations: string[];
  complexity: "low" | "medium" | "high" | "unknown";
  risk: "low" | "medium" | "high" | "unknown";
  requirements: {
    filesystem: boolean;
    terminal: boolean;
    browser: boolean;
    git: boolean;
    parallelism: boolean;
    longContext: boolean;
    mcp?: boolean; // opcional: relevante quando houver orquestrador externo
  };
  constraints: {
    budget?: number;
    maxDurationMs?: number;
    dataSensitivity?: "public" | "private" | "sensitive" | "unknown";
  };
  evidence: {
    titlePrefix?: string;
    labels: string[];
    acceptanceCriteriaCount: number;
    targetFiles: string[];
    resolvedModules: string[];
    moduleTestMapUsed?: boolean;
    specProvided?: boolean;
    microSpecProvided?: boolean;
    bodyLength: number;
  };
  confidence: {
    global: number; // 0..1
    byField: Record<string, number>; // domains, operations, complexity, risk, requirements.*
    signals: Array<{ name: string; delta: number; detail?: string }>;
    conflicts: string[];
  };
  needsSemanticFallback: boolean;
  fallbackReason?: string;
  rationale: string[];
}
```

**[Opinião]** Invariantes: (1) `rationale`, `signals` e `conflicts` devem ser reproduzíveis para as
mesmas entradas; (2) `evidence` contém apenas fatos extraídos; (3) `unknown` é preferível a chute
quando confiança por campo for baixa; (4) fallback semântico é opt-in e nunca pode violar as
restrições de segurança/autorização da ADR-002 §8.

### 5.2 Aplicação do limiar

**[Opinião]**
`needsSemanticFallback = confidence.global < 0,75 || min(confiança dos campos mandatórios) < 0,60 || conflicts.length > 0`
(com calibração futura). Na amostra, muitos casos “parciais” vieram de **conflito semântico** (spike
rotulada por área de código mas entregue como docs) que um detector determinístico de contradição
poderia marcar como `conflict`, reduzindo confiança global mesmo com sinais formais presentes.

## 6. Implicações para o Vetor e restrições atendidas

- **[Fato]** Nenhuma recomendação depende de recurso exclusivo de harness: as fontes são arquivos,
  `gh`, `deno` e git (núcleo de `skills/shared/references/harness-capabilities.md` §1). Qualquer
  enriquecimento por MCP/subagentes/hooks fica como otimização opcional com fallback portátil
  (matriz em `wiki/Contrato-de-Capacidades.md`).
- **[Fato]** O `ToolCaller`/MCP do orquestrador é capacidade de harness já identificada como lacuna
  documental em `docs/investigations/runtime-boundary.md` (§4, P0), coerente com a necessidade de
  não acoplar o profiler a transporte específico.
- **[Inferência]** Para spikes, vale regra determinística adicional: se `operation` inclui `spike` e
  os alvos/entregáveis esperados são `docs/investigations/*`, o domínio provável deve incluir
  documentação/investigação independentemente de label de módulo, evitando o viés observado em
  #577/#582/#583/#585/#587.

## 7. Limitações e não verificado

- **[Fato]** O classificador “real” usou arquivos do PR como proxy; não houve rotulagem manual
  humana independente por dimensão. `requirements.browser/parallelism` reais são difíceis de inferir
  só por diff.
- **[Não verificado]** Presença de Spec formal associada para cada issue da amostra (não foi feito
  cruzamento automático `issue -> docs/specs/*` além da inspeção de formatos existentes).
- **[Inferência]** O peso exato dos sinais e os limiares 0,50/0,75 precisam calibração em amostra
  maior e com ground truth revisada; os valores propostos são ponto de partida determinístico e
  explicável.
- **[Fato]** O repositório `Tavaressan/delphos` é privado e não foi consultado; nenhuma informação
  dele foi incluída.

## Critério de aceite

- [x] **Relatório em `docs/investigations/` com o inventário de fontes de metadados, sua cobertura e
      as lacunas.** Atendido em §3 (tabela §3.1, cobertura §3.2) e referências de código/arquivos ao
      longo do documento.
- [x] **Protótipo descartável ou script de análise aplicado a uma amostra de issues, com taxa de
      acerto e casos ambíguos.** Atendido por
      `docs/investigations/metadados-para-classificacao/analisar.ts`,
      `docs/investigations/metadados-para-classificacao/resultado.json` e
      `docs/investigations/metadados-para-classificacao/pr-cache.json`; amostra de 50 issues, 41
      comparadas com PR; taxas em §2/§3.2/§4.2 e casos ambíguos em §4.2.
- [x] **Proposta de limiar de confiança e de contrato refinado de `TaskProfile`.** Atendido em §4.3
      e §5 (limiares, confiança por campo/sinais/conflitos e contrato refinado com `evidence`,
      `confidence`, `needsSemanticFallback`).
- [x] **Nenhuma dependência do coordinator.** Atendido: o protótipo usa `gh` e metadados de
      issue/PR; a proposta de `TaskProfile` consome artefatos do repo/issue e funções puras, e
      explicita que status files/DAG/inbox/prewarm do coordinator não entram no profiler (§4.4,
      §5.1).
