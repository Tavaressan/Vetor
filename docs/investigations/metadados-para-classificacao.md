# Investigação: metadados existentes para classificação determinística de tarefas

**Issue:** #620 — spike(execution): metadados existentes para classificação determinística de
tarefas\
**Data:** 2026-11-10\
**Base:** `master` em `83bf32c`\
**Contexto:** ADR-002 (`docs/adr/ADR-002-capability-based-execution-routing.md`, ainda não
commitada), Fase 0 objetivo 4 e questões abertas 7 e 9, §4.3; ADR-001
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
  micro-spec JIT, parser/validador de Spec e status files. A cobertura varia: título/labels cobrem
  quase toda a amostra, enquanto arquivos-alvo explícitos e vínculo formal a Spec aparecem com menor
  frequência (`analisar.ts`, `resultado.json`, §3.2, §4).
- **[Fato]** O protótipo descartável `docs/investigations/metadados-para-classificacao/analisar.ts`,
  aplicado a 50 issues reais (abertas e fechadas) obtidas por
  `gh issue list --state all --limit 50`, comparou 41 issues com PR de fechamento usando **apenas
  evidência do PR** como gabarito: operação pelo prefixo convencional do título do PR mergeado e/ou
  tipo de arquivo alterado (nunca título/labels da issue), domínios/módulos e complexidade/risco
  pelos arquivos do PR, e requisitos observáveis apenas `browser` e `longContext`. Comando
  registrado (2026-11-10):
  `deno run -A docs/investigations/metadados-para-classificacao/analisar.ts --issues /tmp/vetor-issues-620.json --out docs/investigations/metadados-para-classificacao/resultado.json --fetch-prs --pr-cache /tmp/pr-cache-620.json --repo Tavaressan/Vetor --limit 50`.
- **[Fato]** Resultado estrito nas 4 dimensões principais (domínio, operação, complexidade, risco):
  `acerto=11`, `parcial=23`, `erro=7`, `sem-pr=9` (41 comparáveis). Acurácia por dimensão: domínio
  80,5% (33/41), operação 73,2% (30/41, por evidência do PR), complexidade 48,8% (20/41), risco
  73,2% (30/41). Critério de “parcial”: 2 ou 3 dessas 4 dimensões corretas; “acerto”: 4/4; “erro”: 0
  ou 1/4. A contagem “parcial ou melhor” é leniente e **não** é apresentada como resultado
  principal.
- **[Fato]** Requisitos observáveis no gabarito: `browser` teve 0 positivos reais em 41 comparáveis
  (41/41 corretos por predição negativa, mas não validável como capacidade de detecção);
  `longContext` teve 14 positivos reais e 13 acertos em 41 comparáveis (31,7%). `terminal`, `git`,
  `filesystem` e `parallelism` foram excluídos da acurácia por serem quase constantes ou não
  observáveis de forma confiável pelo diff/PR.
- **[Inferência]** A classificação determinística é viável para operação e domínio grosseiro e para
  parte do risco, mas fraca para complexidade e para requisitos finos observáveis nesta amostra.
  Spikes rotuladas por área de código mas entregues como `docs/investigations/*` e mudanças
  transversais seguem como principais fontes de ambiguidade (`resultado.json`, §4.2).
- **[Opinião]** O `TaskProfile` deve separar `evidence` de inferências, registrar confiança por
  campo e conflitos, e explicitar `needsSemanticFallback`. Os limiares numéricos propostos (0,75
  global / 0,60 por campo mandatário) são **[Opinião] não calibrada**: os números desta medição
  indicam viabilidade parcial, mas não sustentam calibração fina desses cortes.

## 3. Inventário de fontes de metadados

### 3.1 Tabela de fontes, sinal, cobertura e lacunas

| Fonte                                       | Onde existe                                                                                                   | Sinal útil para classificação                                                                                                                                              | Cobertura observada (amostra/protótipo)                                                                                                                                                                             | Lacunas                                                                                                                                               | Evidência                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Labels da issue**                         | GitHub issue (`gh issue view/list --json labels`)                                                             | Tipo/categoria (`bug`, `enhancement`, `spike`, `documentation`), módulo/área (`scripts`, `skills`, `cli`, `hooks`, `compat`), marcadores (`ai-generated`)                  | Alta: 50/50 issues da amostra tinham labels; usadas na predição (`resultado.json.issues[*].labels`)                                                                                                                 | Indicam intenção declarada, não artefato real; spikes de investigação podem ter label de módulo mas PR só de docs (ex.: #587, #585, #583, #582, #577) | `gh issue view 620 --json ...` (2026-11-10); `resultado.json`                                                            |
| **Título (prefixo convencional)**           | `title` da issue                                                                                              | Operação (`fix`, `feat`, `docs`, `spike`, `refactor`, `perf`, `test`, `chore`), escopo, pista de domínio                                                                   | Alta: parser `^([a-z]+)(?:\(([^)]+)\))?!?:` em `analisar.ts:parseTitleOp`                                                                                                                                           | Escopo pode ser amplo ou enganoso para artefato final                                                                                                 | `scripts/lib/orchestrator/dispatch-prompt.ts:52-71` (slug/tipo por convenção); `analisar.ts`                             |
| **Body: critérios de aceite (checklist)**   | Body da issue, itens `- [ ]`                                                                                  | Quantidade/presença de critérios; proxy de escopo e verificabilidade                                                                                                       | **[Fato]** `extractAcceptanceCriteria` extrai checklists (`scripts/lib/orchestrator/context-packet.ts:88-93`); entra no ContextPacket (`context-packet.ts:201`)                                                     | Não descreve requisitos não-funcionais finos (browser, paralelismo, sensibilidade) nem esforço real                                                   | `scripts/lib/orchestrator/context-packet.ts:88-93,196-221`                                                               |
| **Body/título: arquivos-alvo entre crases** | Tokens `` `path/ext` ``                                                                                       | Módulos/arquivos prováveis; base para domínio                                                                                                                              | **[Fato]** `extractTargetFiles` (`context-packet.ts:95-122`) e `resolveModule` por prefixo mais longo/catch-all (`context-packet.ts:124-182`)                                                                       | Muitos issues não citam paths; paths podem ser exemplos                                                                                               | `scripts/lib/orchestrator/context-packet.ts:95-182`; `scripts/context-packet.ts` CLI                                     |
| **`module-test-map.md`**                    | `.claude/vetor/module-test-map.md` (a partir do root)                                                         | Prefixo→módulo e comando de teste; domínio operacional/validação                                                                                                           | **[Fato]** módulos `root` (`deno task test`) e `cli` (`cd cli && npm test`), prefixos `cli/` e `./` (`.claude/vetor/module-test-map.md`, lido 2026-11-10)                                                           | Estrutura de teste, não semântica fina; desatualização gera erro/fallback (`context-packet.ts:160,192`)                                               | `.claude/vetor/module-test-map.md`; `scripts/lib/orchestrator/context-packet.ts:124-182`                                 |
| **ContextPacket**                           | `scripts/lib/orchestrator/context-packet.ts`, CLI `scripts/context-packet.ts`                                 | Pacote determinístico: issue (número, título, slug, AC), worktree, módulo, `testCommand`, `targetFiles`, `microSpec?`, `conventions?`, `repoMap?`                          | **[Fato]** schema `https://vetor.dev/schemas/context-packet.v1.json` (`context-packet.ts:13,59-64`); usado no prompt do worker (`dispatch-prompt.ts:35,153,186-193`)                                                | Gerado no dispatch; útil como formato normalizado derivável, não como metadado pré-existente isolado                                                  | `scripts/lib/orchestrator/context-packet.ts`; `scripts/context-packet.ts`; `scripts/lib/orchestrator/dispatch-prompt.ts` |
| **Micro-spec JIT**                          | `docs/specs/micro/<issue>-<slug>.md`, `scripts/lib/orchestrator/micro-spec.ts`                                | Objetivo, 3 critérios de aceite e 2 non-goals; escopo delimitado                                                                                                           | **[Fato]** validação estrutural (`micro-spec.ts:31-58`)                                                                                                                                                             | Existe só em alguns casos; conteúdo sintetizado que requer validação                                                                                  | `scripts/lib/orchestrator/micro-spec.ts`; `scripts/context-packet.ts`                                                    |
| **Specs formais**                           | `docs/specs/<slug>.md`, `scripts/lib/spec-parser.ts`                                                          | Requisitos, prioridades, AC por requisito, dependências, restrições                                                                                                        | **[Fato]** parser extrai overview/requisitos/prioridades/AC/dependências (`scripts/lib/spec-parser.ts`)                                                                                                             | Nem toda issue tem Spec; vínculo issue↔Spec não é chave forte observada                                                                               | `scripts/lib/spec-parser.ts`; `skills/coordinator/SKILL.md`                                                              |
| **Metadados do coordinator**                | status files (`skills/shared/references/agent-status.template.md`), `.claude/vetor/*`, prewarm, dispatch refs | Branch, iteração, status, SHA testado, PR, worktree, bloqueios/suspensão                                                                                                   | **[Fato]** status file canônico em `<repo-root>/.claude/vetor/status/<branch>.md` (`agent-status.template.md`); coordinator usa DAG/ondas/dispatch (`skills/coordinator/SKILL.md`, `issue-coordinator-dispatch.md`) | Metadados de execução em andamento, não de classificação pré-dispatch; acoplam ao runtime do coordinator                                              | `skills/shared/references/agent-status.template.md`; `skills/coordinator/SKILL.md`                                       |
| **PR que fechou a issue**                   | `closedByPullRequestsReferences`, `gh pr view --json title,files,state`                                       | Gabarito de avaliação: operação (prefixo do título do PR e tipos de arquivos), domínios/módulos, volume/complexidade e risco aproximados, sinais observáveis de requisitos | **[Fato]** 41/50 issues comparáveis com PR/diff acessível (`resultado.json.summary.withPr=41`)                                                                                                                      | Existe só após execução; não é fonte do profiler em runtime. `terminal/git/filesystem/parallelism` não são observáveis de forma confiável pelo diff   | `analisar.ts` (`fetchPR`, `classifyActual`), `resultado.json`                                                            |

### 3.2 Cobertura quantitativa no protótipo

**[Fato]** Comandos registrados (2026-11-10):

- Coleta:
  `gh issue list --state all --limit 60 --json number,title,labels,state,body,closedAt,createdAt,closedByPullRequestsReferences,url > /tmp/vetor-issues-620.json`
  (60 issues).
- Análise:
  `deno run -A docs/investigations/metadados-para-classificacao/analisar.ts --issues /tmp/vetor-issues-620.json --out docs/investigations/metadados-para-classificacao/resultado.json --fetch-prs --pr-cache /tmp/pr-cache-620.json --repo Tavaressan/Vetor --limit 50`.

**[Fato]** Resumo (`resultado.json.summary`): `total=50`, `withPr=41`,
`countsStrict={acerto:11, parcial:23, erro:7, sem-pr:9}`. Dimensões principais: domínio 0.805,
operação (só evidência do PR) 0.732, complexidade 0.488, risco 0.732. Requisitos observáveis:
`browser` `{comparable:41, actualPositives:0, correct:41, accuracy:1.0}`; `longContext`
`{comparable:41, actualPositives:14, correct:13, accuracy:0.317}`. `resultado.json` é um resumo
compacto (metodologia, totais e uma linha por issue com previsto/real/ok); o cache de PRs não é
commitado e pode ser regenerado com `gh`.

## 4. Resposta às perguntas do spike

### 4.1 Pergunta 1 — Fontes, cobertura e lacunas

**[Fato]** Fontes com maior valor determinístico **antes do dispatch**: (1) título com
prefixo/escopo, (2) labels, (3) checklist de critérios de aceite (`context-packet.ts:88-93`), (4)
arquivos-alvo entre crases e resolução por `module-test-map.md` (`context-packet.ts:95-182`), e (5)
Spec/micro-spec quando existentes (`spec-parser.ts`, `micro-spec.ts`). **[Inferência]** Cobrem bem
operação e domínio grosseiro; cobrem parcialmente complexidade, risco e requisitos observáveis.

**[Fato]** `ContextPacket` consolida parte dessas fontes (`issue.acceptanceCriteria`,
`context.module`, `testCommand`, `targetFiles`, `microSpec?`, `repoMap?`,
`context-packet.ts:15-64,184-219`) mas é produzido no dispatch (`scripts/context-packet.ts`,
`scripts/dispatch-prompt.ts`). **[Inferência]** É o formato natural de entrada normalizada para o
profiler se construído como derivação pura de metadados, sem exigir worktree/execução.

### 4.2 Pergunta 2 — Amostra real, taxa de acerto e casos ambíguos

**[Fato]** Amostra: 50 issues (abertas e fechadas) de `Tavaressan/Vetor`
(`/tmp/vetor-issues-620.json`, 2026-11-10). Comparação usou diffs/metadata dos PRs de fechamento
(`gh pr view --json title,files,state`).

**[Fato]** Metodologia corrigida: (a) **operação real** derivada só do prefixo convencional do
título do PR mergeado e/ou do tipo de arquivos alterados (somente `docs/wiki` → `docs`, somente
testes → `test`), sem usar título ou labels da issue; (b) **requisitos** avaliados apenas em
`browser` e `longContext` por evidência observável do diff, pois `terminal`, `git`, `filesystem` e
`parallelism` são quase constantes ou não observáveis no gabarito por PR; (c) **overall estrito**
calculado sobre 4 dimensões (domínio, operação, complexidade, risco), com critério `acerto=4/4`,
`parcial=2 ou 3/4`, `erro=0 ou 1/4`. Esse critério é leniente e a métrica “parcial ou melhor” não é
resultado principal.

**[Fato]** Taxas (41 comparáveis): domínio 33/41 (80,5%), operação 30/41 (73,2%), complexidade 20/41
(48,8%), risco 30/41 (73,2%); overall estrito 11 acertos, 23 parciais, 7 erros. `browser`: 0
positivos reais, 41/41 corretos por negativa — **não dá para validar** a capacidade de detecção de
necessidade de browser nesta amostra. `longContext`: 14 positivos reais, 13 acertos em 41 (31,7%) —
sinal fraco.

**[Fato]** Casos ambíguos representativos (`resultado.json.issues`):

| Issue            | Previsto (dom/op/complex./risco)                                | Real observado (evidência do PR)                                                                | Observação                                                         |
| ---------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| #587             | scripts/automação,orchestrator / spike / medium / low           | documentação / docs (arquivos somente docs/wiki) / low / low, 1 arquivo                         | Label/escopo de código, entrega documental                         |
| #585, #583, #582 | scripts/automação,(native                                       | system) / spike / medium / low                                                                  | documentação / docs / low / low                                    |
| #577             | compatibilidade,worktree / spike / medium / low                 | documentação / docs / low / low                                                                 | Artefato final documental                                          |
| #574             | skills/fluxos / refactor,implement / medium / medium            | agents,skills,documentação / docs,implement / high / high, 54 arquivos                          | Escopo real transversal maior que metadados sugeriam               |
| #569             | scripts/automação / refactor,implement / medium / medium        | docs,compat-opencode,scripts,skills / docs,implement,test / high / high, 36 arquivos            | Subestimação de dispersão/módulos                                  |
| #568             | compatibilidade / docs / medium / medium                        | scripts,skills,documentação / docs,implement,test / high / high, 24 arquivos                    | Mudança ampla apesar de operação documental                        |
| #563             | safety / enhancement,implement / medium / medium                | scripts,documentação / fix,docs,implement,test / medium / high, 3 arquivos                      | Risco real maior; operação prevista divergiu do prefixo/tipo do PR |
| #540             | hooks,worker,agents,skills,scripts / fix / high / high          | agents,scripts,skills / fix,implement,test / high / medium, 6 arquivos                          | Domínio previsto amplo mas risco divergente                        |
| #546             | skills,release,núcleo/config,scripts,agents / fix / high / high | núcleo/config,scripts,skills,documentação / fix,docs,implement,test / high / medium, 8 arquivos | Risco superestimado                                                |

**[Inferência]** Complexidade é a dimensão menos confiável porque depende de dispersão real do diff;
operação melhora quando há convenção no PR, mas spikes de investigação ainda confundem domínio
previsto vs. artefato entregue. Sem positivos reais de `browser`, não há evidência de recall para
esse requisito.

### 4.3 Pergunta 3 — Confiança insuficiente e limiar para fallback semântico opcional

**[Fato]** O protótipo anterior usava um escore otimista; após a correção metodológica, os
resultados mostram acurácia desigual por dimensão e baixa confiabilidade em complexidade e em
`longContext` observado. **[Inferência]** Um escore de confiança deve refletir qualidade dos sinais
e conflitos, não apenas sua contagem.

**[Opinião] [não calibrada]** Proposta de confiança determinística (0–1), a calibrar com ground
truth revisada:

| Sinal                                        | Peso sugerido | Condição                                          |
| -------------------------------------------- | ------------- | ------------------------------------------------- |
| Prefixo de operação reconhecido              | +0,20         | `fix/feat/docs/spike/refactor/test/chore/perf/ci` |
| Labels de tipo e módulo consistentes         | +0,15         | ≥1 tipo e ≥1 área/módulo                          |
| Critérios de aceite estruturados             | +0,10 a +0,15 | ≥1 checklist; bônus se ≥3                         |
| Arquivos-alvo resolvidos em módulo conhecido | +0,20         | `targetFiles` não vazio e não só catch-all        |
| Spec/micro-spec válida                       | +0,20         | Spec parseável ou micro-spec válida               |
| Consistência título×labels×tipo              | +0,10         | sem contradição óbvia                             |
| Penalidades                                  | -0,10 a -0,30 | body vazio, sem sinais úteis, catch-all, conflito |

**[Opinião] [não calibrada]** Limiar proposto: `global ≥ 0,75` e campos mandatórios `≥ 0,60` →
determinístico; `0,50–0,74` ou campo incerto/conflito → `needsSemanticFallback` para campos afetados
(ou incerteza explícita sem fallback); `< 0,50` → fallback semântico opcional ou defaults
conservadores (`unknown`/restritivo). Estes cortes são ponto de partida explicável, **não
validados** pelos números atuais.

### 4.4 Pergunta 4 — Metadados do coordinator reutilizáveis sem acoplamento

**[Fato]** O coordinator produz status files, estados de execução, PR/SHA testado, suspensão,
DAG/ondas, prewarm e dispatch (`skills/shared/references/agent-status.template.md`,
`skills/coordinator/SKILL.md`, `issue-coordinator-dispatch.md`).

**[Opinião]** Reutilizáveis sem acoplamento (como artefatos/contratos/funções puras):
`module-test-map.md`; funções puras de `scripts/lib/orchestrator/context-packet.ts`
(`extractAcceptanceCriteria`, `extractTargetFiles`, `parseModuleTestMap`, `resolveModule`, montagem
do pacote); Spec/micro-spec parseadas/validadas; convenções de título/slug/branch. **Não**
reutilizar como entrada do profiler: status files vivos, iteração, `SUSPENDED`, SHA testado, inbox,
PR_STAGED, DAG/ondas, teto/prewarm, seleção de modelo — pertencem ao planejamento/execução do
coordinator e criariam dependência circular.

## 5. Proposta de contrato refinado de `TaskProfile`

**[Opinião]** Evolução aditiva sobre ADR-002 §4.3, com fatos separados de inferências e confiança
por campo:

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
    mcp?: boolean;
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
    byField: Record<string, number>;
    signals: Array<{ name: string; delta: number; detail?: string }>;
    conflicts: string[];
  };
  needsSemanticFallback: boolean;
  fallbackReason?: string;
  rationale: string[];
}
```

**[Opinião]** Invariantes: `evidence` contém apenas fatos extraídos;
`rationale`/`signals`/`conflicts` reproduzíveis para mesmas entradas; `unknown` quando confiança por
campo for baixa; fallback semântico opcional e sem violar segurança/autorização (ADR-002 §8).
Conflitos como `spike` de área de código com entregável esperado documental devem reduzir confiança
de domínio/complexidade.

## 6. Implicações e restrições

- **[Fato]** Fontes e ferramentas usadas (arquivos, `gh`, `deno`, `git`) cabem no núcleo portátil
  (`skills/shared/references/harness-capabilities.md` §1; `wiki/Contrato-de-Capacidades.md`); nenhum
  recurso exclusivo de harness é exigido.
- **[Inferência]** Para spikes, regra determinística útil: quando operação é `spike` e
  artefatos/paths esperados são `docs/investigations/*`, incluir domínio de
  documentação/investigação independentemente de label de módulo.
- **[Fato]** O repositório `Tavaressan/delphos` não foi consultado; nenhuma informação dele foi
  incluída.

## 7. Limitações e não verificado

- **[Fato]** O gabarito usou PRs de fechamento como proxy do que foi necessário; não houve rotulagem
  manual independente por dimensão. `browser` não teve positivos reais (0/41), logo sua detecção não
  é validável nesta amostra; `longContext` teve 14 positivos reais e baixo acerto (31,7%).
- **[Fato]** `terminal`, `git`, `filesystem` e `parallelism` não foram medidos por serem quase
  constantes ou não observáveis no diff.
- **[Não verificado]** Cruzamento automático issue↔Spec formal na amostra; calibração empírica dos
  pesos e limiares de confiança.
- **[Inferência]** Uma amostra maior e ground truth revisada (incluindo casos com
  browser/paralelismo/sensibilidade explícitos) é necessária para calibrar limiares.

## Critério de aceite

- [x] **Relatório em `docs/investigations/` com o inventário de fontes de metadados, sua cobertura e
      as lacunas.** Atendido em §3 (tabela §3.1, cobertura §3.2).
- [x] **Protótipo descartável ou script de análise aplicado a uma amostra de issues, com taxa de
      acerto e casos ambíguos.** Atendido por
      `docs/investigations/metadados-para-classificacao/analisar.ts` e
      `docs/investigations/metadados-para-classificacao/resultado.json` (resumo compacto, 50 issues,
      41 comparáveis com evidência de PR), com metodologia corrigida, taxas por dimensão e casos
      ambíguos em §4.2.
- [x] **Proposta de limiar de confiança e de contrato refinado de `TaskProfile`.** Atendido em §4.3
      (limiares propostos como **[Opinião] não calibrada**) e §5 (contrato refinado com `evidence`,
      `confidence`, `needsSemanticFallback`).
- [x] **Nenhuma dependência do coordinator.** Atendido: análise usa issues/PRs via `gh` e metadados
      de arquivos; contrato proposto reutiliza artefatos/funções puras e exclui status
      files/DAG/inbox/prewarm do coordinator (§4.4, §5).
