# Investigação: contrato mínimo viável da Fase 1 (Capability Registry)

**Issue:** #623 — spike(execution): descritor mínimo viável e contratos refinados do roteamento por
capacidade\
**Data:** 2026-11-11\
**Base:** `master` em `6685310`\
**Contexto:** ADR-002 (`docs/adr/ADR-002-capability-based-execution-routing.md`), Fase 0, objetivo 6
e questões abertas de §13 (`ADR-002:497-510`). Consolida os relatórios
`descoberta-de-capacidades.md` (#618), `modos-de-execucao.md` (#619),
`metadados-para-classificacao.md` (#620), `selecao-de-modelo.md` (#621) e
`autorizacao-no-roteamento.md` (#622), mais `teto-de-workers.md` (#564) para a questão 8. Nenhum
deles é redefinido aqui: onde este relatório diverge de um spike, a divergência é explicitada (§8).

**Rótulos:** **[Fato]** verificado na fonte citada (arquivo aberto nesta sessão) · **[Inferência]**
conclusão derivada dos fatos · **[Opinião]** juízo técnico, passível de revisão.

---

## 1. Pergunta

Os tipos `HarnessDescriptor` e `TaskProfile` da ADR-002 são "ilustrativos" e anteriores a qualquer
investigação (`ADR-002:155`, `ADR-002:206`). Com os cinco spikes mergeados, qual é o contrato que a
Fase 1 implementa? As cinco perguntas da issue:

1. Qual o menor `HarnessDescriptor` que sustenta matching obrigatório e ranking determinístico, com
   estados declarado, verificado e operacional distintos?
2. Quais campos de `TaskProfile` são realmente derivados dos metadados existentes?
3. Qual o formato do plano de execução e do registro de decisão para telemetria?
4. Como concorrência/limites (questão 8) e persistência (questão 6) entram no contrato?
5. Qual a estrutura de módulos mínima da Fase 1 em `scripts/lib/capabilities/`, sem tocar o
   coordinator?

## 2. Resumo

- **[Opinião]** O `HarnessDescriptor` v1 é **só o perfil declarado e estático** (`id`, `kind`,
  `command?`, `versionRange?`, `declared`). Verificado e operacional **não moram no descritor**: são
  `HarnessObservation`s produzidas em runtime e fundidas por uma função pura (`resolveEffective`).
  Isso torna os três estados distintos por construção e impede que um perfil embutido "vire" prova
  (ADR-002 §4.1 e §8, `ADR-002:114`, `ADR-002:362`).
- **[Opinião]** Saem do descritor da ADR: `domains` e `operations` (nenhum spike produziu fonte para
  eles), `execution.parallel` (confunde subagente nativo com paralelismo de dispatch),
  `constraints.requiresApproval` e `networkAccess` (dependem de sessão/política, não do harness) e
  `models` (não há consumidor no planner; fica no adapter, conforme #621).
- **[Fato]** Dos campos do `TaskProfile` da ADR, só `operations` (73,2%) e `domains` (80,5%) têm
  evidência de que são derivados com qualidade razoável; `complexity` (48,8%) e `risk` (73,2%) são
  informativos; `longContext` teve precisão de 26,7%; `browser` teve zero positivos reais
  (`metadados-para-classificacao.md:50-63`). **[Opinião]** O `TaskProfile` v1 só deixa decidir o que
  for **explícito ou de configuração**; campos derivados nunca gateiam o roteamento.
- **[Opinião]** O plano consumido pelos caminhos existentes **não precisa de campo novo neles**: o
  planner entrega um `executorId` que vira o `preferred` de `selectDelegationRuntime`
  (`scripts/lib/delegation-runtime.ts:17-29`) ou de `OrchestratorConfig`
  (`scripts/lib/orchestrator/types.ts:168-169`). O plano **não carrega `prompt` nem `cwd`** (diverge
  de #619 §5.2, ver §8).
- **[Opinião]** Concorrência e persistência **não entram no contrato da Fase 1**. Persistência:
  JSONL local escrito a partir da Fase 2, lido só na Fase 5. Concorrência: teto global continua no
  coordinator; o planner só aceita, a partir da Fase 3, um _snapshot_ de carga como filtro duro;
  ranqueamento por carga fica para a Fase 5.
- **[Opinião]** A Fase 1 cabe em **7 issues** que só criam arquivos novos em
  `scripts/lib/capabilities/` e testes em `scripts/tests/` (§9). Nenhuma toca `skills/coordinator/`,
  `delegation-runtime.ts` ou `orchestrator/`.

## 3. Evidências usadas (arquivo:linha verificado nesta sessão)

| Fato                                                                                                                                                                | Fonte                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Núcleo obrigatório de qualquer harness: ler, editar, rodar shell (`git`, `gh`, `deno`); capacidade opcional é otimização aditiva; detectar por ferramenta na sessão | `skills/shared/references/harness-capabilities.md:7-20`                                   |
| Matriz #568 cobre subagentes, hooks, isolamento, perguntas, background e agendamento só para Claude Code, OpenCode, Antigravity, Codex e Cursor (sem Kilo/Kiro)     | `wiki/Contrato-de-Capacidades.md:24-30`                                                   |
| `selectDelegationRuntime` só delega por preferência explícita; preferência indisponível nunca é substituída; sem preferência e headless vira `inline`               | `scripts/lib/delegation-runtime.ts:43-49,62-76,85-96`                                     |
| Entrada/saída do seletor de CLI (`available`, `mcpAvailable`, `preferred`, `interactive` → `inline`/`delegate`/`ask`)                                               | `scripts/lib/delegation-runtime.ts:17-36`                                                 |
| `OrchestratorAdapter` expõe `id`, `capabilities` e `isAvailable(context)` estático, sem rede nem subprocesso                                                        | `scripts/lib/orchestrator/types.ts:102-113`, `:89-97`                                     |
| `OrchestratorDispatchInput` tem `prompt`, `cwd`, `preferredWorker?`, `metadata?`                                                                                    | `scripts/lib/orchestrator/types.ts:38-47`                                                 |
| `OrchestratorRegistry.select` usa só `preferred`; nunca escolhe em silêncio                                                                                         | `scripts/lib/orchestrator/registry.ts:58-98`                                              |
| Funções puras reaproveitáveis do ContextPacket                                                                                                                      | `scripts/lib/orchestrator/context-packet.ts:91,113,125,158,184`                           |
| `ContextPacket` não carrega labels da issue e exige `worktree.branch`/`baseBranch`                                                                                  | `scripts/lib/orchestrator/context-packet.ts:23-31,59-64`                                  |
| Saúde de modelo: `ModelHealthEntry`, `isHealthy`, `pickHealthyModel`, gravação com lock em disco                                                                    | `opencode/scripts/lib/model-health.ts:51-55,86-115,118,127`                               |
| `.claude/vetor/status/` é ignorado pelo git                                                                                                                         | `.gitignore:2`                                                                            |
| `config.json` atual tem `maxConcurrentWorkers: 5` e `modelFallback`; não tem `execution`                                                                            | `.claude/vetor/config.json:2,6`                                                           |
| Chave existente da preferência é `delegation.preferredRuntime`                                                                                                      | `scripts/lib/delegation-runtime.ts:9,25`; `scripts/lib/orchestrator/registry.ts:18`       |
| Testes de `scripts/lib/` ficam em `scripts/tests/<nome>_test.ts`                                                                                                    | `scripts/tests/orchestrator-registry_test.ts`, `scripts/tests/delegation-runtime_test.ts` |

## 4. Pergunta 1 — `HarnessDescriptor` mínimo e os três estados

### 4.1 O que fica e o que sai

| Campo da ADR (`ADR-002:121-152`)                                 | Decisão                                      | Motivo                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `version?`                                                 | **Fica** (`version` migra para a observação) | Versão é observada no ambiente, não propriedade do perfil; o perfil só declara `versionRange` coberta (#618 §7.2 item 2).                                                                                                                    |
| `capabilities.tools.{terminal,filesystem,git,mcp,browser}`       | **Fica**, achatado num mapa `declared`       | Mapa único por nome permite estados por capacidade (a ADR usa `boolean`, que não diferencia "não" de "não sei").                                                                                                                             |
| `capabilities.execution.parallel`                                | **Sai**; vira `subagents`                    | #619 usou `parallel` para representar subagente nativo, mas orquestrador também dá paralelismo real (`modos-de-execucao.md:142`). `subagents` é o que o modo `subagent` realmente exige.                                                     |
| `capabilities.execution.{background,resumable,isolatedWorktree}` | **Fica**                                     | Existem na matriz #568 e em #618 §4, com classificação por célula.                                                                                                                                                                           |
| `capabilities.domains`, `operations`                             | **Adiado (Fase 5)**                          | Nenhum spike achou fonte confiável de "para que o harness é bom". Declará-los à mão seria o mapeamento hardcoded domínio→harness rejeitado na Alternativa A (`ADR-002:473-478`). Só faz sentido derivado de histórico (§4 da ADR, Fase 5).   |
| `models?: ModelDescriptor[]`                                     | **Sai da v1**                                | O planner não conhece modelos (#621 §4.1). O único seletor existente é local ao OpenCode. Um harness sem modelo saudável é reportado como `availability: "unavailable"` pelo adapter (§4.4).                                                 |
| `constraints.maxContext`                                         | **Adiado**                                   | Nenhum arquivo do repositório registra contexto máximo (`selecao-de-modelo.md:540-542`) e `longContext` não é derivável (§5).                                                                                                                |
| `constraints.requiresApproval`                                   | **Sai**                                      | Aprovação depende do modo da sessão (subagente herda o `permissionMode`, `teto-de-workers.md:92`; CLI aprova antes da chamada, `modos-de-execucao.md:95`), não de uma propriedade estática do harness. Fica com `mode` e a política de #622. |
| `constraints.networkAccess`                                      | **Sai**                                      | Em nuvem é escolhido por sessão (`None/Trusted/Full/Custom`, `dispatch-na-nuvem.md` §3.3) e nada deriva "a tarefa exige rede" (§5).                                                                                                          |

### 4.2 Interfaces (contrato da Fase 1)

```ts
// scripts/lib/capabilities/types.ts

/** Lista fechada na v1; acrescentar nome é mudança aditiva. */
export const CAPABILITY_NAMES = [
  "terminal",
  "filesystem",
  "git", // núcleo (harness-capabilities.md:10-16)
  "mcp",
  "browser",
  "subagents", // subagente nativo invocado pela skill (modos-de-execucao.md §4)
  "background",
  "resumable",
  "isolatedWorktree",
] as const;
export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

/** Ordem crescente de confiança. `operational` é opt-in e não tem sonda na Fase 1. */
export type EvidenceLevel = "declared" | "verified" | "operational";
export type CapabilityState = "supported" | "unsupported" | "unknown";

export interface CapabilityClaim {
  state: CapabilityState;
  /** Origem citável: `arquivo:linha`, relatório, nome de sonda. Obrigatório (auditabilidade). */
  source: string;
}

/** `cli` = caminho de delegation-runtime.ts; `orchestrator` = OrchestratorAdapter. */
export type ExecutorKind = "cli" | "orchestrator";

/** Perfil estático e declarado. Não contém nada observado em runtime. */
export interface HarnessDescriptor {
  descriptorVersion: 1;
  /** kebab-case; mesmo `id` de `OrchestratorAdapter.id` e valor de `authorizedExecutors`. */
  id: string;
  kind: ExecutorKind;
  /** Executável no PATH (kind "cli"). Ausente para orquestrador sem binário (ex.: Alethe via MCP). */
  command?: string;
  /** Faixa semver que o perfil cobre. Ausente = não restringe. */
  versionRange?: string;
  /** Capacidade ausente do mapa equivale a `unknown`. */
  declared: Partial<Record<CapabilityName, CapabilityClaim>>;
}

/** Resultado de uma sonda executada em runtime. Imutável; nunca vira parte do descritor. */
export interface HarnessObservation {
  executorId: string;
  observedAt: string; // ISO 8601
  version?: string;
  /** Executável resolvido no PATH (cli) ou `isAvailable()` verdadeiro (orchestrator). */
  installed?: boolean;
  capabilities: Partial<
    Record<CapabilityName, {
      state: CapabilityState;
      level: Exclude<EvidenceLevel, "declared">;
      source: string;
    }>
  >;
  /** Estado de uso agora (rate limit, sem modelo saudável, queda). Alimentado pelo adapter. */
  availability?: {
    state: "available" | "degraded" | "unavailable";
    reason?: string;
    until?: string;
  };
  /** `possible` quando a sonda pode instalar/baixar algo (caso do shim do mise, #618 §3.2). */
  sideEffects: "none" | "possible";
}

/** Resultado de `resolveEffective` por capacidade. */
export interface EffectiveCapability {
  state: CapabilityState;
  level: EvidenceLevel;
  sources: string[];
  /** Quando uma observação contradisse o perfil declarado. */
  conflict?: string;
}
```

### 4.3 Regras de fusão (`resolveEffective(descriptor, observations, opts)`)

**[Opinião]** Função pura, sem I/O, determinística:

1. Ponto de partida: `declared[c]` com `level: "declared"`; ausente → `unknown`.
2. Uma observação de nível maior com estado conhecido **substitui** a de nível menor. Observação
   `unknown` não substitui nada.
3. Contradição entre níveis (perfil diz `supported`, observação diz `unsupported`): vale a
   observação e o resultado carrega `conflict`. Contradição no **mesmo** nível: vence `unsupported`
   (conservador, ADR-002 §8).
4. Observações mais velhas que `opts.maxAgeMs` são ignoradas (frescor decidido pelo chamador).
5. Se a versão observada está fora de `versionRange`, as afirmações `declared` viram `unknown`
   (perfil não cobre essa versão). Se a versão é desconhecida, o perfil vale como `declared` e o
   requisito de evidência do passo seguinte decide (#618 §7.2 itens 1–2).
6. `availability` não entra em `EffectiveCapability`: é filtro do planner (§6).

### 4.4 Quanto de evidência cada modo exige

| Modo da política (#622) | Evidência mínima (`meetsEvidence`)                                             | Justificativa                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `manual`                | não se aplica (roteamento desligado, `inline`)                                 | Comportamento atual preservado (`autorizacao-no-roteamento.md:415-422`).                                                                   |
| `assisted`              | `declared`                                                                     | Um humano aprova cada dispatch; o plano recomenda e mostra o nível de evidência.                                                           |
| `autonomous`            | `verified`                                                                     | "Capability declarations must not be trusted as proof" (`ADR-002:362`). Perfil embutido sozinho nunca autoriza escolha autônoma.           |
| qualquer, por requisito | `operational` só se o requisito pedir explicitamente (ex.: `isolatedWorktree`) | Sonda operacional tem custo e efeito colateral (#618 §5); não há sonda na Fase 1, então requisito `operational` falha fechado até existir. |

**[Fato]** "Presença de ferramenta na sessão" e "executável resolvido" são evidência **verificada**
na classificação de #618 (`descoberta-de-capacidades.md:198`). **[Opinião]** Para harness com perfil
embutido que declara `terminal`/`filesystem`/`git` como `supported`, a descoberta passiva promove
esses três a `verified` com `source: "núcleo + executável resolvido"`, porque #618 §9 os trata como
candidatos naturais a verificação barata e o núcleo é premissa de todo harness suportado
(`harness-capabilities.md:7-16`). As demais (`mcp`, `browser`, `subagents`, `background`,
`resumable`, `isolatedWorktree`) ficam `declared` até uma observação específica as elevar.

### 4.5 Ranking determinístico sem pesos

**[Opinião]** A ADR prevê função de score ponderada (`ADR-002:247-258`), mas dois dos cinco termos
(`historicalQuality`, `latencySuitability`) não têm dado até a Fase 5, e `costSuitability` não tem
campo no descritor. Para a Fase 2, o ranking é **lexicográfico**, o que dispensa pesos arbitrários e
é trivialmente reproduzível:

1. Preferência explícita do usuário (`delegation.preferredRuntime`), quando autorizada.
2. Maior nível mínimo de evidência entre as capacidades requeridas.
3. Mais capacidades _desejáveis_ (não obrigatórias) atendidas.
4. `availability.state`: `available` antes de `degraded`.
5. `id` em ordem alfabética (desempate estável).

A ponderação de §4.5 da ADR entra com a Fase 5, quando houver histórico para alimentá-la.

## 5. Pergunta 2 — `TaskProfile`: o que é realmente derivado

### 5.1 Campo a campo

| Campo (ADR `:182-204` / #620 §5)                  | Evidência                                                                          | Decisão v1                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `operations`                                      | Prefixo do título: 73,2% de acerto (`metadados-para-classificacao.md:52`)          | **Fica**, `source: "derived"`. Informativo.                                                                                 |
| `domains`                                         | 80,5% (módulo do `module-test-map` + tipo de arquivo)                              | **Fica**, `derived`. Informativo; sem harness com `domains` não há o que casar.                                             |
| `complexity`                                      | 48,8%                                                                              | **Fica opcional, `unknown` por padrão, não gateia.** Consumido apenas por seletores de modelo nos adapters (#621 §4.2).     |
| `risk`                                            | 73,2%                                                                              | Idem `complexity`.                                                                                                          |
| `requirements.filesystem/terminal/git`            | Quase constantes e não observáveis no diff (`:62-63`)                              | **Removidos**: são o núcleo (`harness-capabilities.md:7-16`) e o registry já exige o núcleo de todo candidato.              |
| `requirements.browser`, `mcp`                     | `browser`: 0 positivos em 41 (`:56-59`), detecção não validável                    | **Ficam como `boolean`, só `explicit`** (restrição declarada pelo usuário/chamador); padrão `false`. Nunca derivados.       |
| `requirements.parallelism`                        | Não observável                                                                     | **Removido**: paralelismo é propriedade do caminho de dispatch (orquestrador sim, CLI só com `&`), não requisito da tarefa. |
| `requirements.longContext`                        | Precisão 26,7%, recall 57,1% (`:59-61`)                                            | **Adiado**; regra atual marca quase tudo.                                                                                   |
| `constraints.budget`, `maxDurationMs`             | Nenhuma fonte nos metadados                                                        | **Adiados** (sem consumidor até a Fase 5).                                                                                  |
| `constraints.dataSensitivity`                     | Nenhuma derivação medida; #622 trata `unknown` como o mais restritivo (`:246-251`) | **Fica**, mas só `explicit` ou `config` (§5.2). Nunca inferido por heurística.                                              |
| `evidence`, `confidence.{global,byField,signals}` | Pesos e limiares "não calibrados" (`:175-192`)                                     | **Reduzidos**: `evidence` (fatos) fica; `confidence` numérico vira informativo, **sem limiar** (§7, questão 7).             |
| `needsSemanticFallback`, `fallbackReason`         | Fallback semântico é opcional (`ADR-002:208-212`) e inexistente até a Fase 5       | **Adiados.**                                                                                                                |

### 5.2 Interface (contrato da Fase 2, congelado agora para os nomes não divergirem)

```ts
// scripts/lib/execution/types.ts (Fase 2; listado aqui só para travar o contrato)

export type FieldSource = "derived" | "explicit" | "config" | "default";
export type DataSensitivity = "public" | "private" | "sensitive" | "unknown";

export interface TaskProfile {
  profileVersion: 1;
  taskId: string; // número da issue ou id externo
  operations: string[]; // derived
  domains: string[]; // derived
  complexity: "low" | "medium" | "high" | "unknown"; // derived, informativo, não gateia
  risk: "low" | "medium" | "high" | "unknown"; // derived, informativo, não gateia
  /** Só vale `true` por restrição explícita. Gateiam o matching. */
  requirements: { browser: boolean; mcp: boolean };
  /** Gateia a autorização. Explícito, vindo de `defaultDataSensitivity` da config, ou `unknown`. */
  dataSensitivity: DataSensitivity;
  provenance: {
    operations: FieldSource;
    domains: FieldSource;
    complexity: FieldSource;
    risk: FieldSource;
    requirements: FieldSource;
    dataSensitivity: FieldSource;
  };
  /** Somente fatos extraídos; nunca corpo da issue nem prompt (§6.3). */
  evidence: {
    titlePrefix?: string;
    labels: string[];
    acceptanceCriteriaCount: number;
    resolvedModules: string[];
    specProvided: boolean;
    microSpecProvided: boolean;
  };
}
```

**[Opinião] Regra de gate:** só campos com `provenance` `explicit`, `config` ou `default` podem
eliminar um executor. Campos `derived` entram no registro de decisão e nos seletores de modelo, mas
não impedem nem promovem um harness. Isso evita que os 48,8% de acerto de `complexity` decidam
segurança ou capacidade.

**[Opinião] `dataSensitivity`:** para que `unknown` conservador não bloqueie todo roteamento por
padrão, a config ganha `execution.defaultDataSensitivity` (o mantenedor declara se o repositório é
`public` ou `private`). Marcador por tarefa (label ou campo) fica **fora da Fase 1**: a Fase 2
aceita só `ExplicitConstraints` por entrada programática, e a convenção de label é decisão do
usuário (§10).

### 5.3 Fontes que o profiler pode usar sem acoplar ao coordinator

**[Fato]** São funções puras já exportadas: `extractAcceptanceCriteria` (`context-packet.ts:91`),
`extractTargetFiles` (`:113`), `parseModuleTestMap` (`:125`), `resolveModule` (`:158`).
**[Inferência]** O profiler deve chamá-las diretamente em vez de construir um `ContextPacket`
inteiro: `buildContextPacket` (`:184`) exige `worktree.branch`/`baseBranch` (`:23-31`) que ainda não
existem antes do dispatch, e o pacote não carrega labels. **Não** reutilizar status files, iteração,
SHA testado, inbox, DAG/ondas, prewarm nem seleção de modelo
(`metadados-para-classificacao.md:200-206`).

## 6. Pergunta 3 — plano de execução e registro de decisão

### 6.1 `ExecutionPlan`

```ts
// scripts/lib/execution/types.ts (Fase 2)

/** Vocabulário de DelegationAction (delegation-runtime.ts:15) + "blocked". */
export type PlanAction = "inline" | "delegate" | "ask" | "blocked";
/** `subagent` é modo de despacho, não executor (§7, questão 4). */
export type DispatchMode = "cli" | "orchestrator" | "subagent";
export type PolicyMode = "manual" | "assisted" | "autonomous";

export interface PlannedExecutor {
  executorId: string;
  mode: DispatchMode;
  /** → OrchestratorDispatchInput.preferredWorker (types.ts:44). */
  preferredWorker?: string;
  /** 1 = primário; ordem lexicográfica de §4.5. */
  rank: number;
}

export interface ExecutionPlan {
  planVersion: 1;
  taskId: string;
  policyMode: PolicyMode;
  action: PlanAction;
  /** Presente quando `action` é `delegate` ou `ask` (proposta ao humano). */
  primary?: PlannedExecutor;
  /** Já passaram por TODOS os filtros do primário; nenhum relaxa restrição (#622 F1). */
  fallbacks: PlannedExecutor[];
  /** Retentativas APÓS o primeiro dispatch. Padrão 2 (#622 F3). */
  maxRetryAttempts: number;
  reasons: string[];
  decisionId: string;
}
```

**Como os dois caminhos consomem sem mudar contrato [Opinião]:**

| `mode`         | Consumo                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli`          | `selectDelegationRuntime({ available, mcpAvailable, preferred: primary.executorId, interactive })`. O seletor continua decidindo disponibilidade. |
| `orchestrator` | `OrchestratorConfig.preferred = primary.executorId` (`types.ts:168-169`) e `registry.select(...)`; `preferredWorker` vai no `dispatch`.           |
| `subagent`     | Recomendação textual para a skill em execução no harness; não há consumidor TypeScript (`modos-de-execucao.md:116-121`).                          |
| `inline`       | Comportamento atual (`DelegationAction` `inline`).                                                                                                |

**[Fato]** Ambos os seletores já só decidem por `preferred` (`delegation-runtime.ts:43-49,62-76`;
`registry.ts:68-98`). **[Inferência]** Por isso o plano pode ser traduzido em "preferência
computada" sem alterar `DelegationSelectionInput` nem `OrchestratorDispatchInput`, e a regra de
"nunca substituir silenciosamente" continua valendo no último elo.

**Sequência de filtros do planner (Fase 2) [Opinião]:** (1) modo `manual` → `inline`; (2)
autorização: `authorizedExecutors` ∩ `dataSensitivityPolicy[dataSensitivity]` (#622 §4.2); (3)
requisitos obrigatórios com `meetsEvidence` (§4.4); (4) `availability` ≠ `unavailable` e, a partir
da Fase 3, carga abaixo do limite (§7, questão 8); (5) ranking lexicográfico (§4.5). Preferência
explícita indisponível ou sem a capacidade requerida **não é substituída**: o resultado é `ask` se
interativo, senão `inline`, com `reasons` e a lacuna registrada.

### 6.2 `RoutingDecision` e `ExecutionOutcome` (telemetria)

**[Opinião]** Dois registros separados, ligados por `decisionId`. A decisão é escrita antes do
dispatch (imutável); o desfecho é um evento posterior, porque duração, retry e intervenção humana só
existem depois (`ADR-002:366-381`). Estende o `RoutingDecision` de #622 §4.5 com a proveniência do
perfil e o nível de evidência usado em cada candidato.

```ts
export type RejectedBy =
  | "authorization" // fora de authorizedExecutors
  | "dataSensitivity" // fora da política do nível
  | "capability" // requisito obrigatório não atendido
  | "evidence" // atendido, mas abaixo da evidência exigida pelo modo
  | "availability" // degradado/indisponível/saturado
  | "attempted" // já falhou nesta execução (#622 F4)
  | "preference"; // preferência explícita aponta para outro

export interface RoutingDecision {
  decisionVersion: 1;
  decisionId: string; // `${taskId}#${attempt}`
  decidedAt: string; // ISO 8601
  taskId: string;
  attempt: number; // 0 = primeiro dispatch
  policyMode: PolicyMode;
  action: PlanAction;
  selected?: { executorId: string; mode: DispatchMode };
  /** Resumo do perfil: enums e contagens, nunca corpo da issue nem prompt. */
  profile: {
    operations: string[];
    domains: string[];
    dataSensitivity: DataSensitivity;
    requirements: { browser: boolean; mcp: boolean };
    provenance: TaskProfile["provenance"];
  };
  candidates: Array<{
    executorId: string;
    verdict: "selected" | "fallback" | "rejected";
    rejectedBy?: RejectedBy;
    detail: string;
    /** Nível efetivo de cada capacidade requerida, para auditar o gate de evidência. */
    evidence: Partial<Record<CapabilityName, EvidenceLevel>>;
  }>;
  restrictions: string[]; // ex.: "dataSensitivity=unknown", "mode=autonomous"
  reasons: string[]; // frases curtas, reproduzíveis para as mesmas entradas
}

export interface ExecutionOutcome {
  outcomeVersion: 1;
  decisionId: string;
  finishedAt: string;
  status: "succeeded" | "failed" | "cancelled" | "abandoned";
  durationMs?: number;
  retryCount: number;
  fallbackUsed: boolean;
  humanIntervention: boolean;
  validation?: "passed" | "failed" | "not-run";
  /** String opaca informada pelo adapter (#621 §6); o planner não a interpreta. */
  model?: string;
  estimatedCost?: number;
}
```

**[Opinião]** O registro **não** vai no status file do worker (que é do worker; #622 §4.5, último
parágrafo) e **não** carrega `prompt`, `cwd`, corpo da issue ou paths absolutos: log de decisão não
pode virar vazamento do contexto que a política de sensibilidade existe para proteger.

## 7. Decisão por questão aberta da ADR-002 §13

Legenda de status: **Decidida** (contrato fecha a questão) · **Decidida, implementação adiada** ·
**Adiada** (motivo explícito).

| # | Questão (`ADR-002:501-509`)                            | Status                         | Decisão                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Fase                        |
| - | ------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 1 | Descoberta: CLI, adapters ou ambos?                    | Decidida                       | **Ambos.** Fase 1: perfis embutidos (declarado) + descoberta **passiva** por resolução de executável no PATH, sem spawn. Sonda com execução (`--version`, `--help`) é opt-in do chamador e nunca roda na descoberta passiva (o shim do mise instalou `@kilocode/cli` ao receber `--version`, #618 §3.2). Adapters entram pelo `isAvailable` existente (`types.ts:113`), mapeado para observação sem alterá-lo.                                                                                                 | 1                           |
| 2 | O que é verificável automaticamente?                   | Decidida                       | Passivo (sem efeito colateral): executável resolvido e núcleo (§4.4). Opt-in (`sideEffects` declarado): `--version` e a superfície de `--help` para `mcp`/`resumable`/`isolatedWorktree`, que sobem a `verified` (comando existe), não a `operational`. Nunca verificado automaticamente: `browser`, `background` e `subagents` de harness que não é a sessão atual (só `declared`, ou `verified` por ferramenta presente na sessão). `operational`: sem sonda nas Fases 1–4.                                  | 1–2                         |
| 3 | Perfis embutidos, das integrações ou ambos?            | Decidida                       | **Ambos, em momentos distintos.** Fase 1: perfis embutidos em TypeScript (`profiles/`), tipados e validados. Integrações registram descritores por `registry.register()`, que passa pelo mesmo validador. **Não** se define formato de arquivo externo de perfil até uma integração real pedir (YAGNI).                                                                                                                                                                                                        | 1                           |
| 4 | Como representar subagentes nativos?                   | Decidida                       | **Capacidade `subagents` do harness**, não executor (Opção A de #619). Refino: `execution.parallel` da ADR é dividido, porque paralelismo também vem do orquestrador. `mode: "subagent"` no plano só é elegível com `subagents` em nível ≥ evidência do modo e vale para a **sessão atual**; fallback é `cli`/`inline`.                                                                                                                                                                                        | 1                           |
| 5 | Roteamento de modelo: planner separado ou no harness?  | Decidida                       | **Dentro do adapter de cada harness** (#621). O planner não conhece `ModelDescriptor`. Para não perder o sinal de "todos os modelos degradados", o adapter o reporta como `availability` do executor (`degraded`/`unavailable`), que é filtro do planner. `models` fica fora do descritor v1.                                                                                                                                                                                                                  | 1 (descritor), 3 (adapters) |
| 6 | Persistência do histórico                              | Decidida, implementação adiada | **JSONL append-only local** em `.claude/vetor/status/routing-log.jsonl` (já ignorado, `.gitignore:2`), uma linha por `RoutingDecision` ou `ExecutionOutcome`. Escrita com o padrão de lock de `model-health.ts:86-115` (`append` atômico não é garantido no Windows, que o Vetor suporta). Sem rotação na v1. **Fase 1 não persiste nada**; a Fase 2 escreve (o dry-run precisa gerar dados), a Fase 5 lê. Sem agregação entre máquinas.                                                                       | 2 / 5                       |
| 7 | Confiança mínima para classificação autônoma           | Decidida (por construção)      | **Sem limiar numérico.** Em modo autônomo só decidem campos `explicit`/`config`/`default`; campos `derived` nunca gateiam (§5.2). Logo, não há decisão autônoma dependente de confiança a calibrar. Os 0,75/0,60 de #620 §4.3 ficam como sinal informativo. Recalibrar, com ground truth revisado, só se um fallback semântico ou um campo derivado passar a gatear.                                                                                                                                           | 5                           |
| 8 | Concorrência e limites de recurso no ranking           | Decidida, implementação adiada | **Fora do ranking nas Fases 1–4.** O teto global de workers segue no coordinator (`maxConcurrentWorkers`, `.claude/vetor/config.json:2`; `teto-de-workers.md` §6) e o planner não agenda. A partir da Fase 3 o planner aceita um _snapshot_ opcional `load: Record<executorId, { running: number; limit?: number }>` e trata `running >= limit` como `availability: "saturated"` (filtro duro, não penalidade). Ranquear por carga exige dados que só a Fase 5 terá. Descritor v1 **não** tem campo de limite. | 3 / 5                       |
| 9 | Metadados do coordinator reutilizáveis sem acoplamento | Decidida                       | Reutilizar só **funções puras e artefatos**: `extractAcceptanceCriteria`, `extractTargetFiles`, `parseModuleTestMap`, `resolveModule` e `module-test-map.md` (§5.3). Proibido: status files, iteração, SHA, inbox, DAG/ondas, prewarm, seleção de modelo. O profiler não importa nada de `skills/coordinator/`.                                                                                                                                                                                                | 2                           |

**[Fato]** Nenhuma questão ficou sem decisão. Há dois adiamentos reais, ambos de **implementação**,
nunca de contrato: persistência (Fase 2) e carga/histórico no ranking (Fases 3 e 5).

## 8. Divergências em relação aos spikes e inconsistências encontradas

1. **#619 §5.2 — `prompt`/`cwd` no plano.** **Removidos.** O planner decide _quem_; montar prompt é
   do consumidor a partir do `ContextPacket`, e o plano vira registro de telemetria, que não deve
   conter contexto da tarefa (§6.2).
2. **#619 §4 — `subagents` ≙ `execution.parallel`.** **Refinado** para `subagents` (§4.1):
   `modos-de-execucao.md:142` mostra "Paralelo real" também no orquestrador, então `parallel` não
   identifica o modo `subagent`.
3. **#621 §4.3 vs §4.1 — "planner não conhece modelos" × "sem modelo saudável o harness perde
   elegibilidade".** Resolvido por `availability` reportada pelo adapter (§7, questão 5). Também:
   `ModelHealthEntry` está em `opencode/scripts/lib/model-health.ts:51-55`, não em `:64-68` como
   #621 cita.
4. **#622 §4.1 — nome `authorizedProviders`.** Colide com "provider" de modelo, que o repositório já
   usa em `modelFallback` (`"<provider>/<model>"`, `.claude/vetor/config.json:6-9`). Proposta:
   `authorizedExecutors`. Nada está implementado, então o custo da troca é zero (§10).
5. **#622 §4.1 — `execution.preferredRuntime`.** O exemplo coloca a preferência sob `execution`, mas
   a chave real é `delegation.preferredRuntime` (`delegation-runtime.ts:9,25`; `registry.ts:18`). O
   contrato **mantém** `delegation.preferredRuntime`; `execution.*` recebe só chaves novas.
6. **ADR §7 — `capabilities/tests/`.** Testes de `scripts/lib/` já vivem em
   `scripts/tests/*_test.ts` (§3); a Fase 1 segue o precedente para entrar no `deno task test` sem
   configuração nova.
7. **#621 §3.3 × §7 sobre `--model` do Kiro.** O relatório afirma a flag em `kiro-cli chat --help`
   e, em §7, a trata como não verificada no nível superior. Este spike **não depende** disso: Kiro e
   Kilo não ganham perfil embutido até haver verificação (§9, item 4), coerente com
   `modos-de-execucao.md:153`.

## 9. Pergunta 5 e entregável 3 — Fase 1: módulos e quebra em issues

### 9.1 Estrutura mínima (apenas arquivos novos; coordinator intocado)

```text
scripts/lib/capabilities/
├── types.ts       # CapabilityName, EvidenceLevel, HarnessDescriptor, HarnessObservation,
│                  # EffectiveCapability (§4.2)
├── validate.ts    # validateDescriptor(): puro; devolve erros com caminho do campo
├── evidence.ts    # resolveEffective(), meetsEvidence(), ordem de EvidenceLevel (§4.3, §4.4)
├── registry.ts    # CapabilityRegistry: register/get/list/query, ordem determinística
├── discovery.ts   # sondas passivas via interface injetada (resolve no PATH, sem spawn)
├── profiles/      # perfis declarados embutidos (um módulo por harness) + index.ts
└── index.ts       # API pública mínima

scripts/tests/
├── capabilities-validate_test.ts
├── capabilities-evidence_test.ts
├── capabilities-registry_test.ts
├── capabilities-discovery_test.ts
└── capabilities-profiles_test.ts
```

**[Fato]** Fica de fora, por pertencer às Fases 2+ (`ADR-002:317-346`): `scripts/lib/execution/`
inteiro (`task-profiler`, `requirements`, `matcher`, `scorer`, `planner`, `policy`, `fallback`),
leitura de `execution.*` do `config.json`, e qualquer alteração em `delegation-runtime.ts`,
`scripts/lib/orchestrator/` ou `skills/coordinator/`. **[Inferência]** As únicas dependências de
`capabilities/` são a biblioteca padrão e, opcionalmente, tipos de leitura; não importa de
`orchestrator/` (a ponte com `isAvailable` é do issue F1-6 e usa um parâmetro, não um import
circular).

### 9.2 Issues de implementação (apenas a lista; nenhuma foi criada no GitHub)

| ID   | Título sugerido                                                                                 | Escopo                                                                                                                                                                                                                                                                                                                                                     | Depende de |
| ---- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| F1-1 | `feat(capabilities): tipos e validação de HarnessDescriptor`                                    | `types.ts` e `validate.ts`: tipos de §4.2; validação de `id` (kebab-case, único), `kind`, `command` obrigatório quando `kind` é `cli`, `source` não vazio em toda afirmação, `versionRange` parseável, nomes de capacidade conhecidos. Testes unitários com descritores válidos e inválidos.                                                               | —          |
| F1-2 | `feat(capabilities): resolução de evidência declarada, verificada e operacional`                | `evidence.ts`: `resolveEffective` com as regras de §4.3 (precedência por nível, conflito, frescor, versão fora da faixa) e `meetsEvidence` por modo (§4.4). Testes por regra, incluindo falha fechada para `operational` sem sonda.                                                                                                                        | F1-1       |
| F1-3 | `feat(capabilities): CapabilityRegistry com consulta por capacidade e evidência`                | `registry.ts`: `register` (rejeita duplicata e descritor inválido via F1-1), `get`, `list` e `query({ capability, minLevel })`, todos em ordem alfabética de `id` (determinismo). Recebe observações por parâmetro; sem I/O. Testes de determinismo e de descritor desconhecido (não selecionável).                                                        | F1-1, F1-2 |
| F1-4 | `feat(capabilities): perfis declarados embutidos de Claude Code, OpenCode, Antigravity e Codex` | `profiles/`: um módulo por harness, derivado da matriz #568 (`wiki/Contrato-de-Capacidades.md:24-30`) e de #618 §4, cada afirmação com `source` citável; ❓ vira `unknown`. **Sem** Kilo e Kiro (sem evidência suficiente). Teste: todo perfil embutido passa F1-1 e não declara capacidade sem `source`.                                                  | F1-1       |
| F1-5 | `feat(capabilities): descoberta passiva sem efeitos colaterais`                                 | `discovery.ts`: interface `Probe` injetada (`resolveExecutable(name)` por busca no PATH, **sem spawn**); produz `HarnessObservation` (`installed`, núcleo `verified` quando o perfil o declara). Sonda de versão/`--help` existe só atrás de flag explícita, marca `sideEffects: "possible"` e nunca roda na descoberta passiva. Testes com `Probe` falsa. | F1-1, F1-2 |
| F1-6 | `feat(capabilities): observações a partir de OrchestratorAdapter.isAvailable e mcpAvailable`    | Mapeia o probe existente (`types.ts:89-113`, `mcpAvailable` de `delegation-runtime.ts:23`) para `HarnessObservation`, e acrescenta o perfil embutido de `kind: "orchestrator"` para o Alethe (único adapter implementado, `modos-de-execucao.md:101-104`). Recebe o resultado do probe por parâmetro; não altera nenhum contrato existente. Testes.        | F1-3, F1-5 |
| F1-7 | `docs(wiki): como declarar um harness no Capability Registry`                                   | Seção em `wiki/Contrato-de-Capacidades.md` (ou página nova) com os três níveis de evidência, a regra "capacidade declarada não é autorização" (`ADR-002:350`) e o passo a passo para adicionar um harness (princípio 8, `ADR-002:87`). Inclui a regra de que harness sem perfil validado não é selecionável.                                               | F1-3, F1-4 |

**[Opinião]** Ordem de entrega: F1-1 → (F1-2, F1-4 em paralelo) → F1-3 → (F1-5, F1-6) → F1-7. Cada
issue é independentemente testável com `deno task test`; nenhuma depende de harness instalado.

**Para o planejamento da Fase 2 (fora da Fase 1, só como insumo):** (a) `task-profiler` com as
funções puras de §5.3 e a regra de `provenance`; (b) `policy.ts` com `authorizedExecutors`,
`dataSensitivityPolicy`, `defaultDataSensitivity` e `mode`; (c) `matcher`/`planner` em modo dry-run
com o ranking lexicográfico de §4.5 e escrita de `RoutingDecision` (§7, questão 6).

## 10. Proposta de emenda da ADR-002 e pontos para o usuário decidir

**[Fato]** A emenda cabe como seção nova no fim da ADR (sem reescrever §4.2 e §4.3, que continuam
como registro histórico do contrato ilustrativo). Foi aplicada em `docs/adr/` como **Amendment A1**
(§16), com status `Proposed`, e resume: (1) o descritor v1 e a separação declarado/verificado/
operacional; (2) o `TaskProfile` v1 e a regra de gate por proveniência; (3) o plano e o registro de
decisão; (4) o ranking lexicográfico na Fase 2 no lugar da soma ponderada, até haver histórico; (5)
o status das nove questões abertas (§7 deste relatório).

**Pontos que ficam para o usuário decidir:**

1. **Nome da chave de autorização:** `authorizedExecutors` (recomendado) ou `authorizedProviders`
   (#622). O segundo colide com "provider" de modelo (§8, item 4).
2. **Convenção de marcador de sensibilidade por tarefa** (label ou campo no body). Nenhuma existe; o
   spike não inventou uma. Até lá, só `defaultDataSensitivity` por repositório e restrição explícita
   programática (§5.2).
3. **Evidência mínima do modo `autonomous`:** este relatório fixa `verified`. Exigir `operational`
   seria mais seguro, mas torna o modo inutilizável enquanto não houver sonda operacional.
4. **Kilo e Kiro sem perfil embutido na Fase 1** (§9.2, F1-4): consequência é que não podem ser
   selecionados automaticamente até alguém verificá-los e abrir uma issue de perfil. Alternativa:
   perfil mínimo só com o núcleo, o que os tornaria elegíveis em modo `assisted`.
5. **Limite de retentativas:** #622 usa `maxRetryAttempts: 2`. Este contrato o define como
   retentativas **após** o primeiro dispatch (3 despachos no máximo). Confirmar se é a semântica
   desejada.

## 11. Limitações e não verificado

- **[Fato]** Nenhum harness foi executado neste spike; as classificações de capacidade vêm dos
  relatórios #618, #619 e #621 e da matriz #568. Onde esses relatórios divergem entre si, a
  divergência está em §8.
- **[Não verificado]** Os números de acurácia de #620 (41 issues comparáveis) não foram reproduzidos
  aqui; foram lidos em `metadados-para-classificacao.md`. O contrato os trata como **evidência de
  limite**, não como calibração.
- **[Não verificado]** O contrato de plano/decisão não foi exercitado em código. A interface `Probe`
  de F1-5 e a regra de frescor de §4.3 são desenho; a validade fica sob teste na Fase 1.
- **[Fato]** O repositório `Tavaressan/delphos` não foi consultado.

## 12. Critério de aceite

- [x] **Relatório com as interfaces refinadas e a decisão sobre cada questão aberta (§13).** —
      Interfaces em §4.2, §5.2, §6.1 e §6.2; as nove questões em §7, com status e fase.
- [x] **Proposta de emenda da ADR-002.** — Aplicada como Amendment A1 em
      `docs/adr/ADR-002-capability-based-execution-routing.md` (resumo em §10).
- [x] **Quebra da Fase 1 em issues de implementação.** — §9.2: sete issues com título, escopo e
      dependências; nenhuma criada no GitHub.
- [x] **Nenhuma interface exige capacidade exclusiva de um harness.** — O único requisito do
      contrato é o núcleo (`harness-capabilities.md:7-16`). `subagents`, `background`, `resumable`,
      `isolatedWorktree`, `mcp` e `browser` são opcionais por construção (ausente = `unknown`) e
      sempre têm saída `cli`/`inline`; o descritor não referencia nome de harness; discovery é
      passiva e degrada para perfil embutido quando nada está instalado (#618 §7.2).
