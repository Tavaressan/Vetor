# Investigação: modos de execução — CLI, orquestrador e subagente nativo

**Issue:** #619 — spike(execution): execução via CLI, orquestrador e subagente nativo no roteamento
por capacidade\
**Data:** 2026-11-10\
**Base:** `master` em `5f96ed9`\
**Contexto:** ADR-002 (`docs/adr/ADR-002-capability-based-execution-routing.md`, ainda não
commitada, lida para referência, sem copiar nem commitar), ADR-001
(`docs/adr/ADR-001-runtime-independence.md`), matriz de capacidades da #568
(`skills/shared/references/harness-capabilities.md`, `wiki/Contrato-de-Capacidades.md`). Relatórios
base: `runtime-boundary.md` (#586), `orchestrator-adapter-contract.md` (#587), `orca-adapter.md`
(#588), `teto-de-workers.md` (#564), `dispatch-na-nuvem.md` (#565), `descoberta-de-capacidades.md`
(#618), `metadados-para-classificacao.md` (#620). Esses relatórios são reutilizados diretamente;
este não os redefine.

**Rótulos:** **[Fato]** verificado na fonte citada ou em comando registrado · **[Inferência]**
conclusão derivada dos fatos · **[Opinião]** juízo técnico.

---

## 1. Pergunta

A ADR-002 prevê dois caminhos existentes: delegação a CLI (`delegation-runtime.ts`) e delegação a
orquestrador (`OrchestratorAdapter`). Harnesses também expõem subagentes nativos que não passam por
nenhum dos dois. O spike responde:

1. Que diferenças existem entre os três modos de execução nos eixos isolamento, contexto, aprovação,
   retomada e observabilidade do resultado?
2. Como representar subagentes nativos no descritor: como capacidade do harness ou como executor
   separado?
3. O plano de execução produzido pelo planner consegue ser consumido pelos dois caminhos existentes
   sem mudar seus contratos?
4. Que restrições de aprovação e de rede cada caminho impõe, e como o roteamento as preserva?

---

## 2. Resumo

- **[Fato]** Os três modos divergem em três eixos fundamentais: a CLI é síncrona e sem estado
  persistido; o orquestrador é assíncrono com estado externo e handle; o subagente nativo é
  assíncrono mas gerenciado inteiramente pelo harness, sem API contratual própria no Vetor
  (`runtime-boundary.md` §3.1; `orchestrator-adapter-contract.md` §3.3).
- **[Fato]** O subagente nativo não tem contrato no Vetor: a skill o invoca como texto em Markdown
  (`Agent()` no Claude Code, `task` no OpenCode, bloco de agente no Antigravity/Codex), e o harness
  decide o contexto, o isolamento e a supervisão. Não existe uma interface TypeScript que o Vetor
  possa chamar diretamente por `deno run` (`runtime-boundary.md` §3.3).
- **[Fato]** Para aprovação, o subagente nativo herda o `permissionMode` da sessão principal (Claude
  Code: pedido sobe para a sessão do coordinator; `teto-de-workers.md` §3.2). A CLI não pede
  aprovação ao harness — a aprovação deve vir de antes do `Deno.Command`. O orquestrador gerencia
  aprovação por worker de forma independente, mas pode paralisar se o worker espera por humano
  (`orchestrator-adapter-contract.md` §3.6).
- **[Fato]** ADR-002 §13 Q4 registra como questão em aberto: "How should native harness subagents be
  represented?" A ADR-002 §4.2 propõe o `HarnessDescriptor` com bloco
  `execution: { parallel,
  background, resumable, isolatedWorktree }` — subagentes nativos são
  capturados pelo campo `execution.parallel`, não como um quarto tipo de executor. A ADR-002 §6
  reafirma que o planner integra com os dois caminhos existentes sem introduzir runtime novo.
- **[Inferência]** Para a pergunta 2, subagente nativo é uma **capacidade do harness** (campo
  `execution.parallel` do `HarnessDescriptor` da ADR-002 §4.2, equivalente ao `subagents` de
  `harness-capabilities.md` §2.1), não um executor separado. O planner consulta esse campo antes de
  rotar para esse modo.
- **[Fato]** O plano de execução mínimo que `delegation-runtime.ts` já consome é
  `{ available, mcpAvailable, preferred, interactive }` (`delegation-runtime.ts:17-30`). O
  `OrchestratorAdapter.dispatch` consome `{ prompt, cwd, preferredWorker?, metadata? }`
  (`types.ts:38-47`). Ambos os campos são produzíveis a partir do `ContextPacket` existente
  (`context-packet.ts:15-64`) sem quebrar contratos — alinhado com ADR-002 §6, que exige que o
  planner integre com a infraestrutura existente.
- **[Fato]** ADR-002 §8 enumera sete restrições de segurança obrigatórias para o roteamento: somente
  harnesses autorizados podem ser selecionados; acesso à rede deve respeitar políticas de execução;
  contexto sensível não pode ser encaminhado a provedores não autorizados; permissões de harness
  devem ser explícitas; fallback automático deve preservar as restrições de segurança originais;
  requisitos de aprovação de execução não podem ser bypassados silenciosamente; declarações de
  capacidade não podem ser tratadas como prova de comportamento operacional real.
- **[Opinião]** A representação como capacidade do harness é a abordagem mais coerente com a ADR-002
  §4.2 e §6, com o contrato existente de `harness-capabilities.md` §2.1 e com ADR-001 §6.4. O
  planner não precisa de nova interface: o `mode` no plano de execução direciona para o caminho
  existente adequado.

---

## 3. Evidências

### 3.1 Comparação por eixo

#### 3.1.1 Modo 1: Delegação a CLI (`delegation-runtime.ts`)

**[Fato]** A delegação a CLI é implementada em `scripts/lib/delegation-runtime.ts`. A função
`selectDelegationRuntime` é uma função pura, testada em `scripts/tests/delegation-runtime_test.ts`.
O despacho efetivo usa `Deno.Command` para invocar o CLI escolhido.

| Eixo                | Comportamento                                                                                                                                                                                                                                                                                                  | Fonte                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Isolamento**      | Processo filho do SO; worktree determinado pelo `cwd` passado explicitamente ao CLI. O harness não controla o worktree; o Vetor cria com `git worktree add` antes (`harness-capabilities.md` §2.3).                                                                                                            | `delegation-runtime.ts:1-17`; `harness-capabilities.md` §2.3      |
| **Contexto**        | O prompt é passado por stdin ou argumento — apenas texto. O CLI não recebe o estado do harness, o histórico de conversa nem ferramentas MCP da sessão principal.                                                                                                                                               | `delegate-tasks.md` (stdin via pipe); `delegate-to-runtime.md` §1 |
| **Aprovação**       | A aprovação do harness ocorre **antes** da chamada. O CLI roda como processo do SO e não interage com o harness diretamente. Se o classificador do harness bloquear a chamada (ex.: modo `auto` do Claude Code bloqueando exfiltração), o fallback é inline imediato, sem retry (`delegate-to-runtime.md` §3). | `delegate-to-runtime.md` §3                                       |
| **Retomada**        | Sem estado persistido no Vetor. Não há `handle` que permita retomar o trabalho após falha. Uma falha resulta em fallback inline (`delegate-to-runtime.md` §3).                                                                                                                                                 | `delegation-runtime.ts:40-100`; ausência de tipo `handle`         |
| **Observabilidade** | Resultado por stdout/exit code. O Vetor lê e valida; saída vazia ou corrompida → fallback inline imediato (`delegate-to-runtime.md` §3).                                                                                                                                                                       | `delegate-to-runtime.md` §3, §5                                   |

#### 3.1.2 Modo 2: Delegação via `OrchestratorAdapter`

**[Fato]** O contrato do `OrchestratorAdapter` está em `scripts/lib/orchestrator/types.ts`. O único
adapter implementado e testado é o `AletheAdapter` (`scripts/lib/orchestrator/adapters/alethe.ts`).
O Orca foi especificado em `orca-adapter.md` mas o adapter TypeScript ainda não foi implementado
(adiar até a mudança aditiva de contrato da #587 entrar, `orca-adapter.md` §8).

| Eixo                | Comportamento                                                                                                                                                                                                                                                                                                                                                                                                 | Fonte                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Isolamento**      | Worktree criado pelo Vetor ou pelo orquestrador, dependendo do modo (`orchestrator-adapter-contract.md` §3.5). O contrato atual pressupõe que o Vetor cria (`OrchestratorDispatchInput.cwd` é obrigatório, `types.ts:42`); a evolução proposta na #587 adiciona `workspace.mode: "orchestrator"`.                                                                                                             | `types.ts:38-47`; `orchestrator-adapter-contract.md` §3.5 |
| **Contexto**        | O prompt é texto autocontido (`dispatch.prompt`), como na CLI. O adapter pode incluir metadados em `metadata?: Record<string, unknown>`. O worker recebe um contexto isolado; não compartilha o estado da sessão do coordinator.                                                                                                                                                                              | `types.ts:38-47`                                          |
| **Aprovação**       | O worker executa em sessão separada. Se o worker bloquear esperando aprovação humana, o `check()` detecta por `waitingOnHuman` (proposta da #587, `orchestrator-adapter-contract.md` §6.1). O Alethe não expõe esse campo; o Orca expõe `observation.agentWait`. Enquanto o worker espera, o `check()` retorna `running`. O coordinator não pode responder ao bloqueio sem ação humana no terminal do worker. | `orchestrator-adapter-contract.md` §3.6                   |
| **Retomada**        | O `OrchestratorJobHandle` persiste o `jobId` e o `cwd`. Após perda de contexto, o coordinator pode retomar desde que o handle seja reconstruído (Orca: `externalRefs.runId`, `taskId`, `requestId`; proposta da #587, `orchestrator-adapter-contract.md` §3.6). O Alethe não expõe `runId` no contrato atual.                                                                                                 | `types.ts:52-61`; `orchestrator-adapter-contract.md` §3.6 |
| **Observabilidade** | `check()` retorna `{ status, summary?, error?, rawOutput? }` (`types.ts:66-75`). Para o Orca, `worker-read --dispatch <id>` expõe a transcrição completa (`orca-adapter.md` §4.5). O Alethe devolve o texto da entrega via `alethe_check`.                                                                                                                                                                    | `types.ts:66-75`; `orca-adapter.md` §4.5                  |

#### 3.1.3 Modo 3: Subagente nativo do harness

**[Fato]** O subagente nativo é invocado pela skill em Markdown — no Claude Code, a ferramenta
`Agent()`; no OpenCode, o bloco `task`; no Antigravity, subagentes em Markdown; no Codex, blocos em
TOML (`wiki/Contrato-de-Capacidades.md:25`). O Vetor não tem interface TypeScript para invocar esse
mecanismo por `deno run`; a invocação ocorre dentro da skill em execução no harness
(`runtime-boundary.md` §3.3). ADR-002 §4.2 representa essa capacidade pelo campo
`execution.parallel: boolean` do `HarnessDescriptor`.

| Eixo                | Comportamento                                                                                                                                                                                                                                                                                                                                                                | Fonte                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Isolamento**      | Determinado pelo harness. Claude Code: `isolation: "worktree"` cria worktree temporário; `isolation: "remote"` usa VM na nuvem (disponibilidade condicional, `dispatch-na-nuvem.md` §3.1). OpenCode: `--dir` define o cwd do processo filho. Antigravity: isolamento nativo não documentado como disponível (`wiki/Contrato-de-Capacidades.md:27`). Codex: só por instrução. | `wiki/Contrato-de-Capacidades.md:27`; `dispatch-na-nuvem.md` §3.1             |
| **Contexto**        | O subagente recebe o contexto que o coordinator explicitamente passa no prompt. No Claude Code, o subagente herda a lista de ferramentas da sessão principal (MCP inclusive) mas não o histórico de conversa.                                                                                                                                                                | `dispatch-na-nuvem.md` §3.1; `sub-agents.md` citado em `dispatch-na-nuvem.md` |
| **Aprovação**       | Todo pedido de permissão de um subagente em background sobe para a sessão principal no Claude Code (`teto-de-workers.md` §3.2). Plugin subagents (como `vetor:issue-worker`) não aceitam `permissionMode`: herdam o modo da sessão. Com vários workers simultâneos, disputam a mesma fila de aprovação.                                                                      | `teto-de-workers.md` §3.2                                                     |
| **Retomada**        | Sem handle persistido no Vetor. O `SendMessage` para um subagente em execução não tem fallback portátil (`harness-capabilities.md` §2.1): "Mensagens a um subagente em execução (`SendMessage`) não têm fallback: o canal é o status file, e uma decisão nova vira redespacho no mesmo worktree."                                                                            | `harness-capabilities.md` §2.1                                                |
| **Observabilidade** | O resultado volta como resposta na sessão do coordinator (modo síncrono) ou pelo wake do harness (modo background, Claude Code: `Monitor`). O Vetor não tem acesso programático ao estado do subagente enquanto ele executa; a observação ocorre via status file que o próprio worker mantém (`skills/coordinator/SKILL.md`, Fase 5).                                        | `harness-capabilities.md` §2.5; `skills/coordinator/SKILL.md`                 |

### 3.2 Tabela comparativa

| Eixo                       | CLI (`delegation-runtime.ts`)                           | Orquestrador (`OrchestratorAdapter`)                                              | Subagente nativo                                           |
| -------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Isolamento**             | Worktree pelo Vetor; processo filho do SO               | Worktree pelo Vetor ou pelo orquestrador (`workspace.mode`)                       | Pelo harness; varia por harness e por `isolation`          |
| **Contexto**               | Texto via stdin/argumento; sem ferramentas MCP          | Prompt texto; `metadata?` para contexto extra; sem ferramentas MCP do coordinator | Herda ferramentas da sessão principal (harness-dependente) |
| **Aprovação**              | Antes da chamada, pelo harness; falha → inline imediato | No worker, independente; `waitingOnHuman` detectável no Orca                      | Sobe para a sessão do coordinator; disputa fila única      |
| **Retomada**               | Sem handle; falha → inline                              | Handle com `jobId`; retomada com `externalRefs` (proposta #587)                   | Sem handle no Vetor; redespacho no mesmo worktree          |
| **Observabilidade**        | stdout/exit code; síncrono                              | `check()` assíncrono; transcrição disponível                                      | Via status file; resultado por wake ou resposta direta     |
| **Acoplamento ao harness** | Nenhum: processo do SO                                  | Nenhum: CLI (`OrcaAdapter`) ou MCP (`AletheAdapter`)                              | Total: invocado pela ferramenta do harness                 |
| **Portabilidade**          | Alta: qualquer harness com `deno`                       | Alta para Orca (CLI); Alethe exige MCP                                            | Baixa: implementação por harness                           |
| **Paralelo real**          | Não nativo (só com `&` no shell)                        | Sim: múltiplos dispatches independentes                                           | Sim: múltiplos `Agent()` simultâneos                       |

### 3.3 Comutação `kiro-cli` (3.1.0)

**[Fato]** O `kiro-cli` foi identificado como harness que o Vetor precisa suportar (adendo ao task
2026-11-10). Não foi possível verificar diretamente a versão instalada neste worktree sem risco de
efeito colateral (a #618 §3.2 registrou que shims de mise podem disparar bootstrap durante
`--version`/`--help`). O `kiro-cli` não consta na matriz de `wiki/Contrato-de-Capacidades.md:24-30`;
até que seja verificado e adicionado, vale o tratamento de harness desconhecido: núcleo obrigatório
com fallback portátil para toda capacidade opcional (`harness-capabilities.md` §1;
`descoberta-de-capacidades.md` §7.2). Na ADR-002 §4.1, harnesses desconhecidos que não tenham perfil
declarado no `CapabilityRegistry` não podem ser selecionados automaticamente.

**[Inferência]** Pela presença deste próprio arquivo (gerado por uma sessão do `kiro-cli` `3.1.0`),
sabe-se que o `kiro-cli` oferece ao menos o núcleo obrigatório (ler, editar, rodar shell).
Capacidades adicionais (subagentes, hooks, isolamento, background) precisam de verificação explícita
antes de serem declaradas no `HarnessDescriptor` (ADR-002 §4.1 e §4.2).

---

## 4. Pergunta 2: como representar subagentes nativos no descritor

**[Fato]** A ADR-002 §13 Q4 registra explicitamente como questão em aberto: "How should native
harness subagents be represented?" A ADR-002 §4.2 propõe o `HarnessDescriptor` com bloco
`execution: { parallel, background, resumable, isolatedWorktree }` — subagentes nativos são
capturados pelo campo `execution.parallel: boolean`, sem campo dedicado. A ADR-002 §6 reafirma que o
`ExecutionPlanner` integra com os dois caminhos existentes (CLI e Orchestrator), sem introduzir um
terceiro runtime.

### 4.1 Opção A: capacidade do harness (recomendada)

Tratar subagentes nativos como a capacidade `subagents` já declarada em `harness-capabilities.md`
§2.1, mapeada no campo `execution.parallel` do `HarnessDescriptor` da ADR-002 §4.2. O planner
consulta esse campo antes de selecionar o modo. Se presente e confirmado, o planner inclui
`mode: "subagent"` no plano de execução; se ausente, recorre a CLI ou inline com o fallback
documentado.

**[Fato]** A matrix da #568 já classifica `subagents` por harness: Claude Code ✅, OpenCode ⚠️,
Antigravity ✅, Codex ✅, Cursor ✅ (`wiki/Contrato-de-Capacidades.md:25`). O campo `parallel` do
`HarnessDescriptor` proposto em ADR-002 §4.2 corresponde a essa capacidade declarada.

Vantagens:

- Nenhum tipo novo no contrato de execução; a ADR-002 §4.2 já prevê o campo `execution.parallel`.
- O planner já tem a informação necessária na matriz existente e no `HarnessDescriptor`.
- O fallback documentado em `harness-capabilities.md` §2.1 cobre harnesses sem `subagents`.
- Consistente com ADR-001 §6.4 e com ADR-002 §6, que proíbe introduzir novo runtime.
- Responde diretamente a ADR-002 §13 Q4 sem abrir nova questão arquitetural.

### 4.2 Opção B: executor separado no descritor

Introduzir um terceiro tipo de executor no plano (`"executor": "subagent-native"`) além de `"cli"` e
`"orchestrator"`.

Desvantagens:

- Exige nova interface: `delegation-runtime.ts` não tem um código-path para subagentes (é uma função
  pura sobre candidatos no PATH), e o `OrchestratorAdapter` não descreve a invocação via ferramenta
  do harness.
- O Vetor não pode chamar subagentes nativos por `deno run`: a invocação ocorre dentro do harness
  (`runtime-boundary.md` §3.3).
- Contradiz ADR-002 §6, que limita o planner a integrar com os caminhos existentes sem criar novo
  runtime.
- Cria acoplamento ao harness no contrato, contrariando ADR-001 §2.1 e §6.4.

**[Opinião]** A Opção B não é recomendada. A Opção A é a abordagem correta: subagente nativo é a
capacidade `execution.parallel` do `HarnessDescriptor` (ADR-002 §4.2), não um terceiro executor.
Isso responde a ADR-002 §13 Q4 de forma compatível com §6.

---

## 5. Pergunta 3: o plano de execução consegue ser consumido pelos dois caminhos sem mudar contratos

### 5.1 O que cada caminho consome hoje

**`delegation-runtime.ts`** (`scripts/lib/delegation-runtime.ts:17-30`) consome:

```ts
interface DelegationSelectionInput {
  available: string[]; // CLIs no PATH
  mcpAvailable?: string[]; // runtimes MCP detectados
  preferred?: string | null;
  interactive: boolean;
}
```

**`OrchestratorAdapter.dispatch`** (`scripts/lib/orchestrator/types.ts:38-47`) consome:

```ts
interface OrchestratorDispatchInput {
  prompt: string;
  cwd: string;
  preferredWorker?: string;
  metadata?: Record<string, unknown>;
}
```

**[Fato]** ADR-002 §6 define que o `ExecutionPlanner` produz um plano consumido pela infraestrutura
de delegação existente ("The planner produces an execution plan that the existing delegation
infrastructure consumes"). O planner não executa tarefas nem gerencia workers.

### 5.2 Formato do plano de execução compatível com os dois contratos

**[Fato]** O `ContextPacket` já produz os campos necessários para ambos os caminhos
(`scripts/lib/orchestrator/context-packet.ts:15-64`):

- `context.module` → domínio/módulo da tarefa.
- `issue.number`, `issue.title`, `issue.acceptanceCriteria` → base do `prompt`.
- `context.testCommand`, `targetFiles` → metadados para o `prompt` ou `metadata`.
- O `cwd` é o worktree criado pelo Vetor antes do dispatch.

**[Fato]** ADR-002 §4.3 define o `TaskProfile` com campos `domains`, `operations`, `complexity`,
`risk`, `requirements` e `constraints`. Esses campos são deriváveis das fontes existentes sem
chamada a modelo adicional (ADR-002 §4.3: "The initial implementation should prioritize
deterministic classification using existing metadata"), como confirmado em
`metadados-para-classificacao.md` §4.1.

Um plano de execução mínimo que os dois contratos existentes conseguem consumir **sem mudança**,
compatível com ADR-002 §4.4 e §6:

```ts
// Formato do plano de execução — compatível com delegation-runtime.ts e OrchestratorAdapter.dispatch
// sem alterar nenhum dos dois contratos. Alinhado com ADR-002 §4.4 (ExecutionPlanner) e §6
// (Execution Integration).
interface ExecutionPlan {
  // Núcleo: presente em todos os modos
  prompt: string; // prompt autocontido (produzido a partir do ContextPacket)
  cwd: string; // worktree criado antes do dispatch

  // Roteamento: informa o planner qual caminho usar (ADR-002 §4.4)
  mode: "cli" | "orchestrator" | "subagent" | "inline";

  // Campos opcionais por modo:
  // Para "cli": available/mcpAvailable/preferred/interactive são descobertos no momento do
  //   dispatch, não no plano — o plano só indica "cli" como modo desejado.
  // Para "orchestrator": usado diretamente como OrchestratorDispatchInput.
  preferredWorker?: string; // → OrchestratorDispatchInput.preferredWorker
  metadata?: Record<string, unknown>; // → OrchestratorDispatchInput.metadata

  // Rationale inspecionável exigido por ADR-002 §3.1.5:
  selectionRationale: string;
}
```

**[Fato]** Mapeamento para cada contrato existente:

| Campo do plano         | `DelegationSelectionInput`                                                | `OrchestratorDispatchInput`                |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------ |
| `mode: "cli"`          | Sinal para chamar `selectDelegationRuntime` com os candidatos do ambiente | —                                          |
| `mode: "orchestrator"` | —                                                                         | Sinal para chamar `adapter.dispatch(plan)` |
| `prompt`               | Passado ao CLI por stdin/argumento                                        | `dispatch.prompt`                          |
| `cwd`                  | Passado como `--dir`/argumento ao CLI                                     | `dispatch.cwd` (obrigatório)               |
| `preferredWorker?`     | Não mapeado diretamente (a seleção de CLI usa `preferred` da config)      | `dispatch.preferredWorker`                 |
| `metadata?`            | Não consumido por `delegation-runtime.ts`                                 | `dispatch.metadata`                        |
| `selectionRationale`   | Não consumido; registrado para observabilidade                            | Pode ir em `metadata`                      |

**[Inferência]** `delegation-runtime.ts` não precisa de `prompt` ou `cwd` para selecionar o runtime:
ela recebe os candidatos do ambiente e decide a ação. O `prompt` e o `cwd` são passados na etapa de
invocação, fora de `delegation-runtime.ts`. O plano pode conter os dois sem que nenhum contrato
precise ser alterado.

**[Fato]** O único campo novo que o plano introduz além dos contratos existentes é `mode` e
`selectionRationale`. `mode` não altera nenhuma interface: é informação do planner para quem
despacha. `selectionRationale` atende ADR-002 §3.1.5 ("Explainability: every automatic selection
must have an inspectable decision rationale").

---

## 6. Pergunta 4: restrições de aprovação e de rede por caminho (ADR-002 §8)

**[Fato]** ADR-002 §8 ("Security and Authorization") enumera as seguintes restrições obrigatórias
para o roteamento por capacidade:

1. Somente harnesses autorizados podem ser selecionados.
2. Acesso à rede deve respeitar as políticas de execução.
3. Contexto sensível da tarefa não deve ser encaminhado a provedores não autorizados.
4. Permissões de harness devem permanecer explícitas.
5. Fallback automático deve preservar as restrições de segurança originais.
6. Requisitos de aprovação de execução não devem ser bypassados silenciosamente.
7. Declarações de capacidade não devem ser tratadas como prova de comportamento operacional real.

Essas restrições se aplicam a cada caminho de execução da seguinte forma:

### 6.1 Restrições de aprovação

| Caminho              | Restrição de aprovação                                                                                                                                                                                                                                                                                                                                                                                                                             | Como o roteamento preserva                                                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CLI**              | O harness pode bloquear a chamada ao processo (ex.: modo `auto` do Claude Code; classificador de exfiltração). Sem aprovação do harness, a chamada não ocorre. Se bloqueada, fallback inline imediato sem retry (`delegate-to-runtime.md` §3). ADR-002 §8.6: o roteamento não pode bypassar silenciosamente o requisito de aprovação.                                                                                                              | Checar autorização do harness antes de selecionar CLI; fallback inline se bloqueado (`delegate-to-runtime.md` §3). ADR-002 §8.5: o fallback preserva a restrição original.                                                               |
| **Orquestrador**     | O worker executa em sessão separada com seu próprio modo de aprovação. Se o worker bloquear em aprovação humana, o `check()` retorna `running` indefinidamente. O `waitingOnHuman` (proposta da #587, `orchestrator-adapter-contract.md` §6.1) permite detectar esse estado. O Orca expõe `observation.agentWait` (`orchestrator-adapter-contract.md` §3.6). ADR-002 §8.6: bloqueio de aprovação não pode ser ignorado pelo roteamento.            | O coordinator deve verificar `waitingOnHuman` em cada `check()` e reportar o bloqueio ao humano, nunca reiniciar o worker silenciosamente (`orca-adapter.md` §8.3). ADR-002 §8.4: permissões de harness permanecem explícitas no worker. |
| **Subagente nativo** | Pedidos de permissão sobem para a sessão principal no Claude Code (`teto-de-workers.md` §3.2). Plugin subagents herdam o `permissionMode` da sessão; o coordinator não pode alterar por worker. Com múltiplos workers, disputam a mesma fila: o teto de 3 workers simultâneos reduz a probabilidade de disputa (`teto-de-workers.md` §6). ADR-002 §8.6: o roteamento não pode selecionar subagente nativo ignorando o modo de aprovação da sessão. | O roteamento deve considerar o teto de workers e o modo de aprovação antes de decidir por subagente nativo. ADR-002 §8.5: a seleção preserva a restrição de aprovação original da sessão.                                                |

### 6.2 Restrições de rede

| Caminho              | Restrição de rede                                                                                                                                                                                                                                                                                                                              | Como o roteamento preserva                                                                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CLI**              | O processo filho herda as variáveis de ambiente e a conectividade do processo pai. O harness pode impor restrições de rede ao processo (ex.: `sandbox` do Codex, `agy --sandbox`). ADR-002 §8.2: acesso à rede deve respeitar as políticas de execução; ADR-002 §8.3: contexto sensível não pode ser encaminhado a provedores não autorizados. | O roteamento verifica se a tarefa carrega dados sensíveis (`TaskProfile.constraints.dataSensitivity`, ADR-002 §4.3) antes de selecionar um CLI que encaminharia dados para um provedor externo. Nenhuma rede adicional é aberta pelo `delegation-runtime.ts` além do `Deno.Command`. |
| **Orquestrador**     | Alethe: MCP sobre HTTPS; restrição de rede determinada pelo servidor MCP. Orca: em sessões locais, herda o ambiente; em sessões na nuvem, níveis `None`/`Trusted`/`Full`/`Custom` (`dispatch-na-nuvem.md` §3.3). ADR-002 §8.2: o dispatch respeita a política de rede do orquestrador.                                                         | O plano pode declarar os recursos de rede necessários em `metadata.networkRequirements?` para que o adapter valide antes do dispatch. Para o Orca em nuvem, o nível de rede é escolhido fora do Vetor. ADR-002 §8.5: fallback preserva as restrições de rede originais.              |
| **Subagente nativo** | Herda as políticas de rede do harness e da sessão. No Claude Code em nuvem, o nível de rede é configurado na sessão. Localmente, sem restrição adicional além do harness. ADR-002 §8.7: a capacidade declarada (`networkAccess`) não prova comportamento operacional real.                                                                     | O roteamento documenta a dependência de rede no plano e deixa a decisão ao harness/usuário. Se `HarnessDescriptor.constraints.networkAccess` for falso para o harness atual e a tarefa exigir rede, o roteamento rejeita subagente nativo para essa tarefa (ADR-002 §4.2 e §8.1).    |

### 6.3 Regra portável de roteamento derivada de ADR-002 §8

**[Inferência]** A partir de ADR-002 §8 e das fontes coletadas, a regra de roteamento que preserva
as restrições de aprovação e de rede em qualquer harness, sem exigir recurso exclusivo:

1. **Checar autorização do harness antes de qualquer seleção** (ADR-002 §8.1). Somente harnesses com
   perfil declarado no `CapabilityRegistry` e explicitamente autorizados podem ser selecionados.
2. **Checar `execution.parallel` no `HarnessDescriptor` antes de rotar para subagente nativo.** Se
   ausente ou não verificado, usar CLI ou inline (`harness-capabilities.md` §2.1; ADR-002 §8.7).
3. **Checar `mcpAvailable` antes de rotar para orquestrador MCP.** Se ausente, e o Orca estiver
   disponível por CLI, usar o `OrcaAdapter` (modo B de `orca-adapter.md` §6; ADR-002 §8.1).
4. **Verificar `dataSensitivity` no `TaskProfile` antes de encaminhar contexto** (ADR-002 §8.3).
   Tarefa `sensitive` não pode ser roteada para harness sem autorização explícita para dados
   sensíveis.
5. **Fallback automático deve preservar todas as restrições originais** (ADR-002 §8.5). Um fallback
   não pode usar um harness de menor segurança do que o original.
6. **Nunca bypassar silenciosamente requisito de aprovação** (ADR-002 §8.6). Se o harness
   selecionado exige aprovação e ela não foi obtida, o roteamento retorna para modo `Assisted` ou
   `Manual` (ADR-002 §5).
7. **A seleção permanece explícita no modo `Manual` e `Assisted`:** nenhum orquestrador ou CLI é
   escolhido sem `delegation.preferredRuntime` configurado ou consentimento interativo
   (`delegation-runtime.ts:63-100`; `registry.ts:68-98`; ADR-002 §5).

---

## 7. Opções avaliadas

### Opção A: manter os dois caminhos existentes, adicionar `mode` ao plano

Introduzir `mode: "cli" | "orchestrator" | "subagent" | "inline"` no plano de execução como campo do
planner, sem alterar `DelegationSelectionInput` nem `OrchestratorDispatchInput`. O subagente nativo
fica como capacidade do harness (`execution.parallel` do `HarnessDescriptor`, ADR-002 §4.2).

- A favor: nenhum contrato muda; o `ContextPacket` já produz os campos necessários; o fallback
  portátil já existe; alinhado com ADR-002 §6 e §3.1.4.
- Contra: o `mode` precisa ser calculado antes do worktree ser criado, o que exige que o profiler
  conheça as capacidades do harness atual.

### Opção B: terceiro tipo de executor no contrato

Introduzir um adapter `SubagentNativeAdapter` com interface similar ao `OrchestratorAdapter`.

- Contra: o Vetor não pode invocar subagentes por `deno run` (`runtime-boundary.md` §3.3); a
  interface seria uma abstração vazia que só o harness implementa, sem código Deno. Contradiz
  ADR-002 §6. Rejeitada.

### Opção C: unificar CLI e orquestrador num único `ExecutionAdapter`

Criar uma interface comum para os dois caminhos existentes.

- Contra: o `OrchestratorAdapter` tem ciclo de vida assíncrono (dispatch/check/release), enquanto a
  CLI é síncrona (Deno.Command); unificá-los forçaria polimorfismo falso. ADR-001 §3.4 manda
  "Maintain the distinction between CLI delegation and orchestrator delegation." ADR-002 §6 reafirma
  os dois caminhos separados. Rejeitada.

---

## 8. Recomendações

**[Opinião]**

1. **Adotar a Opção A** para a representação do subagente nativo: tratar como capacidade
   `execution.parallel` do `HarnessDescriptor` (ADR-002 §4.2), não como executor separado. Isso
   responde ADR-002 §13 Q4 de forma compatível com §6.

2. **Usar o formato mínimo de plano** descrito em §5.2 como entrada do planner. Ele é derivável do
   `ContextPacket` existente e compatível com os dois caminhos sem mudança de contrato. O campo
   `selectionRationale` atende ADR-002 §3.1.5. O campo `metadata` pode carregar
   `networkRequirements` para o Orca em nuvem sem quebrar a interface.

3. **Incluir o `kiro-cli` na matriz de `wiki/Contrato-de-Capacidades.md`** assim que suas
   capacidades opcionais forem verificadas (subagentes, hooks, isolamento, background, retomada).
   Até lá, `kiro-cli` = núcleo obrigatório + fallback portátil para tudo. Sem perfil declarado no
   `CapabilityRegistry`, `kiro-cli` não pode ser selecionado automaticamente (ADR-002 §8.1 e §4.1).

4. **Registrar `waitingOnHuman`** no plano de execução quando o modo for `orchestrator`, para que o
   coordinator possa reportar bloqueios sem ação autônoma. Compatível com a proposta da #587 §6.1 e
   com ADR-002 §8.6.

5. **Nenhuma recomendação exige recurso exclusivo de harness.** O `mode: "subagent"` só é
   selecionado quando `execution.parallel` está declarado e verificado no harness atual (ADR-002
   §4.1 e §8.7). Os fallbacks portáteis de `harness-capabilities.md` cobrem todos os casos sem
   capacidade.

---

## 9. Critério de aceite

| Item                                                                                                                                          | Status | Onde atendido                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Relatório comparando os três modos nos eixos isolamento, contexto, aprovação, retomada e observabilidade, com fonte no código ou documentação | ✅     | §3.1 e §3.2: tabelas por modo, com fontes em `arquivo:linha` ou relatório mergeado                                                                                                 |
| Recomendação para a pergunta 2 (subagente nativo: capacidade ou executor separado)                                                            | ✅     | §4: Opção A recomendada (`execution.parallel` do `HarnessDescriptor`, ADR-002 §4.2 e §13 Q4), com justificativa e fontes                                                           |
| Esboço do formato do plano de execução consumível por `delegation-runtime.ts` e por `OrchestratorAdapter`                                     | ✅     | §5.2: formato `ExecutionPlan` com mapeamento explícito para os dois contratos, sem alterar nenhum; alinhado com ADR-002 §4.4 e §6                                                  |
| Restrições de aprovação e de rede por caminho, e como o roteamento as preserva (ADR-002 §8)                                                   | ✅     | §6: análise das sete restrições de ADR-002 §8 aplicadas a cada caminho (§6.1 e §6.2), com regra portável em §6.3                                                                   |
| Nenhuma mudança necessária no coordinator                                                                                                     | ✅     | §5.2: o plano é derivado do `ContextPacket` existente; nenhuma skill, coordinator nem configuração foi alterada; ADR-002 §6 confirma que o Coordinator não é modificado nesta fase |
