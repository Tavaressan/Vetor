# Investigação: revisão do contrato do `OrchestratorAdapter`

**Issue:** #587 — spike(orchestrator): revisão do contrato do OrchestratorAdapter (wake vs polling, dono
do worktree, falhas)
**Data:** 2026-11-09
**Base:** `master` em `f6ab98f`
**Contexto:** ADR-001, INV-002 (P0), §3.1, §3.2 e §7. Bloqueia a #588.
**Casos de teste:** o `AletheAdapter` (`scripts/lib/orchestrator/adapters/alethe.ts`) e o CLI do Orca
**1.4.255** (`stably-orca 1.4.255-1`, instalado em 2026-11-09 às 11:05; a ADR cita 1.4.251).

**Rótulos:** **[Fato]** verificado na fonte citada ou em comando registrado · **[Inferência]** conclusão
derivada dos fatos · **[Opinião]** juízo técnico.

---

## 1. Pergunta

O contrato `OrchestratorAdapter` (`scripts/lib/orchestrator/types.ts`) e o `OrchestratorRegistry` foram
desenhados a partir do Alethe. Antes de um segundo adapter:

1. `dispatch`/`check`/`release`/`cancel` e os estados normalizados são genéricos o bastante? O contrato
   representa conclusão por push/wake além de polling?
2. Como o contrato expressa quem cria o worktree, quem controla o ciclo de vida, qual diretório é o
   contexto de execução e quem limpa (ADR-001, §7)?
3. Que metadados de execução um orquestrador devolve, e o Vetor precisa deles?
4. As falhas dos adapters são normalizadas de forma consistente?

## 2. Resumo

- **[Fato]** O contrato atual cobre o Alethe e, com uma ressalva, também cobre o Orca. Os dois
  orquestradores entregam o resultado por **caixa de mensagens** (`worker_done`), e os dois aceitam
  uma leitura bloqueante com timeout (`alethe_check {wait, timeoutMs}` e `orca orchestration check
  --wait --timeout-ms`). A diferença está em **quem consome** a mensagem, não em push contra polling.
- **[Fato]** O Orca proíbe que um script consuma a caixa do coordinator ("a script's plain `check`
  takes your mail"; um observador deve usar `--peek`). O `check()` atual do Alethe **consome** a
  entrega e a guarda em cache (`alethe.ts:111-114`). Para o Orca, `check()` precisa ser uma leitura de
  estado que **não consome**: `worker-show --dispatch <id> --json`.
- **[Fato]** O contrato não diz quem é dono do worktree. `OrchestratorDispatchInput.cwd` é obrigatório
  (`types.ts:42`), então ele pressupõe que o Vetor sempre cria o worktree. O Orca pode criá-lo
  (`--worktree new-top-level`/`new-child`) e o Alethe também (`isolate: true`).
- **[Fato]** `cancel()` e `release()` devolvem `Promise<void>` (`types.ts:135-146`). Isso não expressa
  `stop_unknown`, `release_pending` nem `release_unknown`, que o Orca devolve com exit 1 ou 0
  conforme o caso.
- **[Fato]** As falhas não são normalizadas: o adapter lança `Error` com texto livre
  (`alethe.ts:63-67,80`) ou devolve `status: "failed"` com `error: string` (`alethe.ts:122-138`).
- **[Opinião]** Recomendo uma evolução **aditiva** do contrato (§6): campos opcionais novos,
  `cancel`/`release` devolvendo um resultado em vez de `void` e um tipo de erro normalizado. O
  `AletheAdapter` continua compilando com mudanças mínimas, sem reescrita.

## 3. Evidências

### 3.1 Contrato atual

| Elemento | Definição | Fonte |
| --- | --- | --- |
| Estados | `queued`, `running`, `completed`, `failed`, `cancelled` | `types.ts:12-17` |
| Capacidades | `displayName`, `safePollTimeoutMs`, `requiresExplicitRelease`, `supportedWorkers`, `supportsCancellation` | `types.ts:22-33` |
| Entrada do dispatch | `prompt`, `cwd` (obrigatório), `preferredWorker?`, `metadata?` | `types.ts:38-47` |
| Handle | `orchestratorId`, `jobId`, `cwd`, `dispatchedAt` | `types.ts:52-61` |
| Resultado do check | `status`, `summary?`, `error?`, `rawOutput?` | `types.ts:66-75` |
| Transporte | `ToolCaller = (toolName, args) => Promise<unknown>` | `types.ts:81-84` |
| Detecção | `isAvailable({ tools, env? })`, sem I/O | `types.ts:89-97,113` |
| Ciclo | `dispatch`, `check(handle, {timeoutMs})`, `release`, `cancel?` | `types.ts:116-147` |
| Seleção | só por preferência explícita | `registry.ts:68-98` |

### 3.2 Orca 1.4.255: comandos e contrato observados

Comandos rodados neste host (todos de leitura; nenhum worker foi iniciado):

```sh
orca-ide --version                                         # 1.4.255
orca-ide skills get orchestration                          # guia versionado (114 linhas)
orca-ide skills get orchestration --reference references/recovery-and-cleanup.md
orca-ide orchestration --help
orca-ide orchestration <worker-start|worker-show|worker-read|worker-stop|worker-abandon|worker-release|worker-list|check|request-show> --help
orca-ide orchestration worker-list --json
orca-ide orchestration worker-show --dispatch ctx_b0f8d7ab36b9 --json --full
orca-ide orchestration run-list --json
```

O `orca-ide` foi chamado por nome completo. O `ORCA_CLI_COMMAND` deste host aponta para um shim que
falha (`Unable to locate the Orca executable next to /usr/lib/stably-orca`); detalhes ficam para a
#588.

**Registro real de um Dispatch** (`worker-show --full`, worker da #568 de 2026-11-06, campos
relevantes):

```json
{
  "dispatch": { "id": "ctx_b0f8d7ab36b9", "runId": "run_8589e10bfe85", "taskId": "task_d07c21e88ff0",
    "contractVersion": 1, "assigneeHandle": "term_2bede6bb-…", "retryOfDispatchId": "ctx_aac30fca1cd6",
    "status": "failed", "lastFailure": "stopped", "completedAt": "2026-11-06T13:24:53.057Z" },
  "worker": { "state": "stopped", "stage": "process_stopped",
    "worktreeId": "15451574-…::/home/tavaressan/Projects/orca/workspaces/Vetor/agy-568-compat",
    "effects": [ { "kind": "worktree", "action": "reused" }, { "kind": "terminal", "action": "created" } ],
    "residualResources": [ { "kind": "terminal", "role": "agent", "id": "term_2bede6bb-…" } ],
    "startOptions": { "agent": "opencode", "timeoutMs": 60000, "setupSource": "existing_worktree" } },
  "projection": { "outcome": "failed", "liveness": { "verdict": "exited", "source": "worker_stop" },
    "resource": { "state": "owned", "ownerDispatchId": "ctx_b0f8d7ab36b9", "releaseState": "not_requested",
      "terminalState": "retained" },
    "nextAction": { "kind": "release", "argv": ["orchestration", "worker-release", "--dispatch", "ctx_b0f8d7ab36b9"] } }
}
```

**[Fato]** `worker-list --json` devolveu 10 Dispatches de 2026-11-06, todos `failed` ou `stopped`,
com `terminalState: "retained"` e `workspace` em `/home/tavaressan/Projects/orca/workspaces/Vetor/…`.
Esse diretório está **vazio** hoje (`ls -la` em 2026-11-09). Os worktrees foram removidos, mas o Orca
ainda lista os terminais como retidos e sugere `worker-release`.

### 3.3 Mapeamento do ciclo de vida

| `OrchestratorAdapter` | Alethe (MCP) | Orca (CLI) | Observação |
| --- | --- | --- | --- |
| `isAvailable` | `mcp__alethe__*` na lista de ferramentas | executável resolvido por `ORCA_CLI_COMMAND`, `orca-dev`, `orca-ide`, `orca` | O Orca exige detecção por executável, que o `OrchestratorProbeContext` não carrega (`types.ts:89-97`) |
| `dispatch` | `alethe_delegate {tasks, cwd, agent, isolate}` → `jobs[0].id` | `worker-start --spec-file - --worktree <sel> --agent <id> --json` → `dispatchId`, `taskId`, `runId` | O Orca cria um Run se não houver um ligado ("With --spec and no bound Run, a coordinator gets a new Run") |
| `check` | `alethe_check {wait, timeoutMs ≤ 50000, untilAllSettled:false}`; **consome** a entrega | `worker-show --dispatch <id> --json`: não consome; ou `check --peek --wait --timeout-ms`: não consome | O `check` sem `--peek` consome a caixa do coordinator; o guia proíbe isso fora do próprio agente |
| `release` | `alethe_release {jobIds}` → `{released}` | `worker-release --dispatch <id>`: idempotente; `retained`, `release_pending`, `already_released` (exit 0) ou `release_unknown` (exit 1) | Com `orchestration.worker-auto-release.v1`, o Orca já agenda o release ~2 min após o `worker_done` |
| `cancel` | `alethe_cancel {jobIds}`, resposta não observada | `worker-stop` (para e prova, ou `stop_unknown` com exit 1) e `worker-abandon` (cerca sem agir em processo) | Duas semânticas que o `cancel(): void` não separa |
| (sem equivalente) | — | `request-show --request <id>` e `--retry-request <id>` | Idempotência de mutações após resposta perdida |
| (sem equivalente) | — | `send --to dispatch:<id>`, `ask`/`reply`, `gate-*` | Mensagens e decisões; ficam fora do contrato mínimo |

### 3.4 Pergunta 1: push/wake contra polling

**[Fato]** Os dois orquestradores avisam a conclusão com uma mensagem `worker_done` numa caixa:

- Alethe: `alethe_check` devolve `deliveries: [{ type: "worker_done", jobId, outcome, text }]`, global à
  sessão e **entregue uma única vez** (`delegate-alethe.md` §6.2, sonda de 2026-10-23).
- Orca: o worker emite `worker_done`, e o Orca **acorda o agente coordinator** injetando a mensagem na
  conversa dele (guia `orchestration`, "When Orca wakes you"). O `check` sem `--peek` "marks the batch
  it returns as handled" e "consuming checks belong to the agent itself" (`check --help`).

**[Inferência]** O wake do Orca é um recurso do **agente que roda dentro de um terminal do Orca**, não
do CLI. Um processo Deno que chama o CLI não é acordado por ninguém. O Vetor pode ser coordinator de
duas formas:

| Modo | Quem recebe o `worker_done` | Papel do `check()` do adapter |
| --- | --- | --- |
| **A. Agente do Vetor dentro de um terminal do Orca** | O próprio agente, por wake | Não é necessário para a conclusão; serve para inspecionar estado (`worker-show`) |
| **B. Script ou agente fora do Orca** | Ninguém, a menos que alguém leia a caixa | Necessário. Deve ler sem consumir (`worker-show` ou `check --peek --wait`) para não roubar mensagens do coordinator do Run |

**[Fato]** O contrato atual descreve `check()` como "polling seguro" (`types.ts:124`) e expõe
`safePollTimeoutMs` como capacidade obrigatória (`types.ts:26`). Os dois servem ao modo B dos dois
orquestradores. O que falta é declarar (a) se o orquestrador também acorda o coordinator e (b) se o
`check()` consome ou não a mensagem.

**Resposta:** sim, o contrato consegue representar os dois, desde que `check()` seja definido como
**observação idempotente de estado** e a capacidade declare o sinal de conclusão (§6.1).

### 3.5 Pergunta 2: dono do worktree

**[Fato]** Comportamento observado por orquestrador:

| Caso | Quem cria | Quem controla o ciclo | Diretório de execução | Quem limpa | Fonte |
| --- | --- | --- | --- | --- | --- |
| Alethe, `isolate: false` (contrato atual) | Vetor (`worktree-create`) | Vetor | `cwd` passado | Vetor, **depois** do `alethe_release` | `delegate-alethe.md` §6.3, regras 1 e 7 |
| Alethe, `isolate: true` | Alethe (`.alethe/worktrees/job-N`, branch `alethe/agent-job-N`) | Alethe até o release | worktree do Alethe | **Vetor** (`git worktree remove`, `git branch -d`) após o release | `delegate-alethe.md` §6.3, regra 1 |
| Orca, `--worktree current` ou seletor existente | Vetor | Vetor | o worktree informado | Vetor; o Orca fecha só o terminal (`worker-release`) | `worker-start --help`: "Current and existing worktrees never rerun setup" |
| Orca, `new-top-level` / `new-child` | Orca (fora do repo, em `…/orca/workspaces/<repo>/<nome>`) | Orca; o worker fica aberto ("is kept open, so release it") | caminho devolvido no recibo | Orca, por `orca worktree rm`; `worker-stop` "never deletes the worktree" | `worker-start --help`, `worker-stop --help`, `orca worktree --help` |

**[Fato]** No caso Orca + worktree próprio, o caminho só é conhecido **depois** do `worker-start`. Hoje
`OrchestratorJobHandle.cwd` é copiado da entrada (`alethe.ts:83-88`), então o handle não consegue
refletir um caminho escolhido pelo orquestrador.

**[Fato]** A limpeza tem **duas fases** nos dois orquestradores: liberar o recurso do orquestrador
(terminal ou lock) e depois remover o worktree. A ordem importa no Alethe (sem o release, `git worktree
remove` falhou com `Permission denied` no Windows; regra 7).

**[Fato]** O estado do Orca não acompanha a remoção externa do worktree (§3.2: 10 registros apontam para
um diretório vazio). Quem remove o worktree precisa liberar o recurso do Orca antes, ou o registro
fica órfão.

### 3.6 Pergunta 3: metadados de execução

| Metadado | Alethe | Orca | O Vetor precisa? |
| --- | --- | --- | --- |
| ID do job | `jobs[].id` | `dispatchId` | Sim: é o `jobId` do handle |
| Lote/execução | `runId` | `runId` | Sim, para retomar após perda de contexto (Orca: `inbox --terminal run:<id>`) |
| Unidade de trabalho | — | `taskId` (o retry reusa a Task, `--retry-of` exige `--task`) | Sim, para retry sem criar Task nova (o disjuntor do Orca conta por cadeia `--retry-of`) |
| Worktree efetivo | `jobs[].worktree` | `worker.worktreeId` (`<repoId>::<path>`) | Sim, para atribuição, status file e limpeza |
| Terminal/processo | — | `assigneeHandle`, `processIncarnation`; **sem PID** | Só para diagnóstico; o Vetor não deve agir sobre o processo |
| Idempotência | — | `requestId` (`--retry-request`, `request-show`) | Sim: sem ele, um timeout no `dispatch` não diz se o worker começou |
| Versão do contrato | — | `dispatch.contractVersion: 1` | Sim, para a #588 detectar mudança de contrato |
| Próxima ação | `next` (texto) | `nextAction.argv` (sem executável) | Útil, nunca executado sem validação |
| Espera por humano | — | `observation.agentWait` / `waitingOnHuman` | Sim, para a #562 e a #564 (worker parado em prompt de permissão) |

**[Fato]** Nenhum dos dois expõe PID. A atribuição deve usar o `dispatchId`/`jobId` e o worktree
efetivo, como a ADR §10.1 pede ("not assumptions based solely on working directory names").

### 3.7 Pergunta 4: falhas

| Classe normalizada proposta | Alethe | Orca | Hoje no contrato |
| --- | --- | --- | --- |
| `unavailable` | namespace `mcp__alethe__*` ausente | executável não resolvido, `status` com runtime não `ready` | `isAvailable() → false`, sem motivo |
| `rejected` | worker não suportado (`alethe.ts:62-67`) | flags inválidas, disjuntor após 3 falhas na cadeia `--retry-of` | `throw new Error(texto)` |
| `outcome_unknown` | timeout do MCP ≥ 90 s perdeu entregas (regra 6) | `worker-start` com `outcome_unknown` e `failedStage`; resposta perdida (`request-show` = `absent`) | indistinguível de falha |
| `timeout` | `alethe_check` sem entrega no prazo | `--timeout-ms` expirado | `status: "running"` (correto) |
| `delivery_lost` | entrega consumida por outra chamada e não guardada | mensagem consumida por um `check` de script | não representado |
| `empty_result` | `succeeded` com `text` vazio (regra 9) | — | `status: "failed"` com texto (`alethe.ts:124-131`) |
| `cancel_unproven` | resposta do `alethe_cancel` não observada | `worker-stop` → `stop_unknown` (exit 1) | `cancel(): void`, invisível |
| `release_unproven` | — | `release_pending`, `release_unknown` (exit 1) | `release(): void`, invisível |

**[Fato]** O guia do Orca proíbe agir sozinho com base em silêncio: "Silence, a timeout, or
`unverifiable` liveness alone never proves exit or authorizes autonomous recovery". A regra 10 do
contrato do Alethe (sem retry automático) já é compatível com isso.

## 4. Opções avaliadas

### Opção A: manter o contrato e encaixar o Orca

Implementar o Orca com `check()` = `worker-show`, `cancel()` = `worker-stop` e ignorar `stop_unknown`.

- A favor: zero mudança no contrato.
- Contra: perde `stop_unknown` e `release_unknown`, que o guia do Orca manda reportar; não representa
  worktree criado pelo orquestrador; não carrega `taskId`/`runId`/`requestId`, que o retry e a
  recuperação exigem.

### Opção B: evolução aditiva (recomendada)

Campos opcionais novos e resultados em vez de `void`, sem mudar a semântica do Alethe (§6).

- A favor: o `AletheAdapter` muda só nas assinaturas de `release`/`cancel` e no preenchimento de
  `workspace`; os testes existentes continuam válidos com ajuste mínimo.
- Contra: `release`/`cancel` deixam de devolver `void`, o que obriga a mudar os chamadores. Hoje não
  há chamador em produção (#586 §3.3), então o custo é só nos testes.

### Opção C: contrato novo orientado a eventos

Trocar `check()` por um `subscribe()`/callback.

- Contra: a ADR §3.1 manda preservar o contrato; um processo Deno não recebe o wake do Orca, então o
  callback seria um polling disfarçado. Rejeitada.

## 5. Regras de dono do worktree e de limpeza (parte do contrato)

Estas regras aplicam a ADR §7.1 e §7.2 ao contrato e valem para todo adapter:

1. **Declaração no dispatch.** O chamador diz se fornece o worktree (`workspace.mode: "provided"`, com
   `cwd`) ou se pede um ao orquestrador (`"orchestrator"`). O adapter recusa (`rejected`) o modo que
   o orquestrador não suporta.
2. **Declaração no handle.** O handle diz o caminho efetivo, quem o criou e quem deve removê-lo
   (`workspace.path`, `createdBy`, `removedBy`).
3. **Ordem de limpeza.** Primeiro `release()` do recurso do orquestrador; só com resultado `released`
   ou `already_released` o dono remove o worktree. Com `release_pending` ou `release_unknown`, o
   worktree **não** é removido e a pendência vai para o relatório.
4. **Quem remove.** Se `removedBy` for `"vetor"`, o Vetor remove com `vetor-checks.sh
   safe-remove-worktree`. Se for `"orchestrator"`, o Vetor chama o comando do orquestrador (Orca:
   `orca worktree rm`) ou deixa para o usuário, e nunca roda `git worktree remove` num worktree que o
   orquestrador ainda registra. Isso evita o estado órfão de §3.2.
5. **Transferência explícita.** O Alethe com `isolate: true` cria o worktree e transfere a remoção ao
   Vetor (`createdBy: "orchestrator"`, `removedBy: "vetor"`). Essa transferência fica escrita no
   adapter, não suposta pelo chamador.
6. **Cancelamento não é limpeza.** `cancel()` nunca remove worktree. Com `cancel_unproven`, o worktree
   e o recurso ficam retidos, e a decisão volta ao humano.

## 6. Proposta de mudança no contrato

**[Opinião]** Todas as mudanças são aditivas, exceto o tipo de retorno de `release`/`cancel`.

### 6.1 Tipos

```ts
// Novo: como o orquestrador sinaliza conclusão e se o check consome mensagens.
export interface OrchestratorCapabilities {
  // ...campos atuais inalterados...
  /** "poll": só por check(). "wake": o orquestrador acorda o agente coordinator. "both": os dois. */
  readonly completionSignal?: "poll" | "wake" | "both"; // padrão "poll"
  /** Modos de worktree aceitos no dispatch. */
  readonly workspaceModes?: Array<"provided" | "orchestrator">; // padrão ["provided"]
  /** Versão do contrato externo que o adapter conhece (ex.: Orca contractVersion 1). */
  readonly externalContractVersion?: number;
}

export interface OrchestratorDispatchInput {
  prompt: string;
  /** Mantido: equivale a workspace { mode: "provided", cwd }. */
  cwd: string;
  preferredWorker?: string;
  metadata?: Record<string, unknown>;
  /** Novo. Ausente = { mode: "provided", cwd }. */
  workspace?: { mode: "provided"; cwd: string } | { mode: "orchestrator"; name?: string; baseRef?: string };
  /** Novo: chave de idempotência para repetir um dispatch após resposta perdida. */
  requestId?: string;
}

export interface OrchestratorWorkspace {
  readonly path: string;
  readonly createdBy: "vetor" | "orchestrator";
  readonly removedBy: "vetor" | "orchestrator" | "user";
}

export interface OrchestratorJobHandle {
  readonly orchestratorId: string;
  readonly jobId: string;
  /** Mantido: igual a workspace.path. */
  readonly cwd: string;
  readonly dispatchedAt: number;
  /** Novo. */
  readonly workspace?: OrchestratorWorkspace;
  /** Novo: IDs externos para retomar e recuperar (ex.: { runId, taskId, requestId }). */
  readonly externalRefs?: Readonly<Record<string, string>>;
}

export type OrchestratorErrorKind =
  | "unavailable"
  | "rejected"
  | "outcome_unknown"
  | "delivery_lost"
  | "empty_result"
  | "cancel_unproven"
  | "release_unproven";

export class OrchestratorError extends Error {
  constructor(readonly kind: OrchestratorErrorKind, message: string, readonly raw?: unknown) {
    super(message);
  }
}

export interface OrchestratorCheckResult {
  status: JobExecutionStatus;
  summary?: string;
  error?: string;
  /** Novo: classe da falha quando status === "failed". */
  errorKind?: OrchestratorErrorKind;
  /** Novo: o worker espera uma resposta humana (Orca: observation.agentWait). */
  waitingOnHuman?: boolean;
  rawOutput?: unknown;
}

/** Novo: resultado de release/cancel em vez de void. */
export interface OrchestratorActionResult {
  outcome: "done" | "already_done" | "pending" | "unproven";
  rawOutput?: unknown;
}
```

### 6.2 Semântica

| Método | Regra nova |
| --- | --- |
| `check()` | Observação **idempotente** de estado. Repetir não perde resultado. Um adapter cujo transporte consome a mensagem guarda a entrega até o `release` (o Alethe já faz isso em `alethe.ts:111-114`). Um adapter de orquestrador com `completionSignal: "wake"` usa a leitura que não consome (Orca: `worker-show`). |
| `release()` | Devolve `OrchestratorActionResult`. `pending` ou `unproven` impede a remoção do worktree (§5, regra 3). |
| `cancel()` | Devolve `OrchestratorActionResult`. `unproven` = `cancel_unproven`; nunca reportar como cancelado. Abandono sem parar o processo (Orca `worker-abandon`) fica fora do contrato mínimo. |
| `isAvailable()` | O `OrchestratorProbeContext` ganha `executables?: Record<string, string>`, com caminhos já resolvidos pelo chamador sem executar nada (o mesmo princípio de `command -v` em `delegate-to-runtime.md`). |
| Seleção | Inalterada: `registry.select` só escolhe com preferência configurada. |

### 6.3 Impacto no `AletheAdapter`

| Mudança | Alteração no Alethe |
| --- | --- |
| Capacidades novas | `completionSignal: "poll"`, `workspaceModes: ["provided"]` (o contrato atual usa `isolate: false`) |
| `workspace` no handle | `{ path: input.cwd, createdBy: "vetor", removedBy: "vetor" }` |
| `externalRefs` | `{ runId }` vindo do `alethe_delegate` |
| `release()` | devolve `{ outcome: "done" }` quando `released` contém o id, senão `"unproven"` |
| `cancel()` | devolve `"unproven"` até a resposta do `alethe_cancel` ser observada |
| Erros | `throw new OrchestratorError("rejected", …)` no worker não suportado; `errorKind: "empty_result"` na regra 9 |

Nada disso muda as chamadas MCP, o teto de 50 s nem o cache de entregas.

## 7. Recomendação

**[Opinião]**

1. **Adotar a Opção B** numa issue de implementação própria, antes da #588. A #588 passa a validar o
   adapter do Orca contra o contrato revisado.
2. **Incluir as regras do §5 no contrato**, em `docs/specs/delegacao-runtimes-orquestradores.md` e no
   JSDoc de `types.ts`, como requisito de todo adapter.
3. **`check()` nunca consome mensagem destinada ao agente coordinator.** Para o Orca isso significa
   `worker-show` ou `check --peek`, nunca `check` puro. O adapter do Orca só deve ser usado no modo B
   (coordinator fora do Orca). No modo A, o agente já recebe o wake e segue o guia do próprio Orca, sem
   o adapter.
4. **Seleção continua explícita:** nenhuma mudança no `registry.select`. Nenhum orquestrador é
   escolhido sem `delegation.preferredRuntime`.
5. **Registrar `waitingOnHuman`** como sinal para a #562 e a #564: o Orca já distingue "parado
   esperando humano" de "falhou", que foi a hipótese não verificada da onda de 5 workers.

A decisão continua humana: este spike não altera o contrato nem cria issues de follow-up.
