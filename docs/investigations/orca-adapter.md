# Investigação: viabilidade de um adapter do Orca via CLI

**Issue:** #588 — spike(orchestrator): viabilidade de um adapter do Orca via CLI
**Data:** 2026-11-09
**Base:** `master` em `f6ab98f`
**Orca:** 1.4.255 (`stably-orca 1.4.255-1`, pacote do AUR compilado localmente), runtime local
`ready`, contrato de orquestração `orchestration.contract.v1`
**Contexto:** ADR-001, INV-003 (P1), §3.6 e §7.2. Depende da #587
(`docs/investigations/orchestrator-adapter-contract.md`), cujas regras e tipos este relatório usa.

**Rótulos:** **[Fato]** comando rodado neste host, com a saída registrada · **[Inferência]** ·
**[Opinião]** · **[Não verificado]**.

---

## 1. Pergunta

1. Quais operações o CLI oferece, com quais flags e qual saída `--json`, na versão instalada?
2. Como os worktrees são provisionados e quem os limpa?
3. Como as sessões são identificadas (Run, Task, Dispatch) e como mapeiam para o
   `OrchestratorJobHandle`?
4. Qual a semântica de cancelamento e limpeza, já que `worker-stop` não prova que o agente parou?
5. Como resolver o executável com segurança em cada plataforma?
6. Como o adapter evita ficar preso a uma versão do Orca?

## 2. Resumo

- **[Fato]** O ciclo de vida inteiro foi executado ao vivo, com dois workers de teste do agente
  `opencode`: `worker-start` → `worker-show` → `send` → wake do coordinator → `check` →
  `worker-release` (duas vezes) → `worker-start` → `worker-stop` → `request-show` → `worker-release`
  → `worktree rm`. Todas as saídas estão no §4.
- **[Fato]** O mapeamento da #587 se confirma: `dispatch` = `worker-start`, `check` = `worker-show`
  (sem consumir mensagem), `release` = `worker-release` (idempotente), `cancel` = `worker-stop`
  (prova a parada com `ptyKilled: true` e matou também o neto `sleep 300`).
- **[Fato]** O CLI se descreve: `orca agent-context --json` publica o esquema de 325 comandos
  (`schemaVersion: 1`) **sem precisar do app aberto**, e `orca status --json` lista as capacidades do
  runtime (`orchestration.contract.v1`, `orchestration.worker-auto-release.v1`…). Isso resolve a
  pergunta 6 sem fixar versão.
- **[Fato]** Quatro riscos observados ao vivo:
  1. **Prompt inicial perdido** no primeiro worker: o Orca registrou `input_accepted` e
     `activity: done`, mas a tela do opencode mostrava o prompt vazio. Ficou 3 minutos parado, sem nada
     pedindo atenção (`agentWait: null`). Um `send` com o mesmo texto destravou. O segundo worker
     recebeu o prompt normalmente.
  2. **O wake chega como mensagem do usuário.** Quando o worker reportou, o Orca digitou no terminal
     deste agente: "You have 1 orchestration message. Run `orca orchestration check --run …`". O
     harness o entregou como mensagem do usuário.
  3. **Terminal fechado à mão vira `release_unknown` permanente** (6 de 10 workers antigos, §4.8).
  4. **O `ORCA_CLI_COMMAND` deste host estava quebrado** por um defeito de empacotamento do AUR (§4.9).
     Os comandos `next` que o próprio Orca sugere usam esse caminho.
- **[Opinião]** **Decisão: adiar a implementação** do `OrcaAdapter` em TypeScript até a mudança de
  contrato da #587 entrar. A especificação de integração está verificada (§5) e pode virar referência
  de skill já, para o caso em que o agente do Vetor roda dentro do Orca (§6).

## 3. Método

Tudo rodou em 2026-11-09, num terminal do Orca (`ORCA_TERMINAL_HANDLE` definido), sempre com o
executável por caminho completo (`orca-ide`, `/usr/bin/orca-ide`). Os dois workers de teste rodaram
em worktrees novos e descartáveis (`--worktree new-top-level --setup skip`), com tarefas que proibiam
editar arquivos e usar git. Ao final, os dois worktrees e as branches foram removidos com
`orca worktree rm --delete-branch`, e os terminais foram liberados.

## 4. Evidências

### 4.1 Versão e descoberta (perguntas 1 e 6)

```text
$ orca-ide --version
1.4.255
$ orca-ide agent-context --json        # 306 100 bytes, sem app
{ "schemaVersion": 1, "commandCount": 325, "commands": [ { "command": "...", "path": [...],
  "flags": [...], "usage": "...", "notes": [...], "examples": [...] }, ... ] }
$ orca-ide status --json               # runtime.capabilities: 300 itens; os de orquestração:
orchestration.contract.v1, orchestration.worker-auto-release.v1, orchestration.worker-stop-verdict.v1,
orchestration.worker-stop-helpers.v1, orchestration.worker-keep-open.v1,
orchestration.worker-start-implicit-run.v1, orchestration.worker-turn-stop-reports.v1, ...
```

Flags publicadas no `agent-context` para os comandos do adapter:

| Comando | Flags relevantes |
| --- | --- |
| `orchestration worker-start` | `spec`, `spec-file`, `task`, `task-title`, `worktree`, `name`, `repo`, `base-branch`, `setup`, `agent`, `model`, `effort`, `keep-open`, `retry-of`, `timeout-ms`, `run`, `retry-request`, `json`, `full` |
| `orchestration worker-show` | `dispatch`, `json`, `full` |
| `orchestration worker-read` | `dispatch`, `source`, `cursor`, `limit`, `json` |
| `orchestration worker-release` / `worker-stop` / `worker-abandon` | `dispatch`, `retry-request`, `json`, `full` |
| `orchestration request-show` | `request`, `json` |
| `orchestration check` | `run`, `terminal`, `peek`, `wait`, `timeout-ms`, `types`, `json` |
| `worktree rm` | `worktree`, `force`, `delete-branch`, `run-hooks` |

### 4.2 `worker-start` (worker A)

```text
$ orca-ide orchestration worker-start --spec-file spec-a.txt --task-title "vetor-588 probe A" \
    --worktree new-top-level --repo id:15451574-… --name vetor-588-probe-a --setup skip \
    --agent opencode --json
exit=0 7709ms
{"ok":true,"result":{"dispatchId":"ctx_6a0eea101539","taskId":"task_dab7c6741a66",
 "runId":"run_9773217dbba7","runCreated":true,"state":"ready","agent":"opencode","mode":"terminal",
 "terminal":"term_1d6c1cff-…","workspace":"15451574-…::/home/tavaressan/Projects/orca/workspaces/Vetor/vetor-588-probe-a",
 "keptOpen":true,"next":"Orca wakes you when workers report; end your turn when you're done."}}
```

O worker B subiu em 3 397 ms, no mesmo Run (`run_9773217dbba7`, sem `runCreated`).

### 4.3 Prompt inicial perdido e reentrega por `send`

`worker-show` a cada 3 s (não consome mensagens), durante 3 minutos:

```text
+0s ready input_accepted - live retained None
...
{"state":"ready","stage":"input_accepted","liveness":"live","activity":"idle","lastActivity":"3m ago",...}
```

`worker-show --full` naquele momento: `observation: {"status":"live","exactWorker":true,"agentWait":null}`,
`stage: {"worker":"ready","dispatch":"dispatched","detail":"input_accepted","activity":"done"}`,
`attention: {"categories":[],"requiresAction":false}`.

`worker-read --json` (fonte `terminal`, `fallbackReason: session_not_reported`) mostrava a tela inicial
do opencode 2.2.6, com o prompt vazio e um aviso de plugin:

```text
          ┃  Ask anything… "Fix a TODO in the codebase"
          ┃  Build · Iceman Free OpenCode
  ⊙ 1 MCP /mcps  ⊙ 1 plugin failed /plugins                                             2.2.6
```

Reentrega pelo canal que o guia manda usar:

```text
$ orca-ide orchestration send --to dispatch:ctx_6a0eea101539 --subject "vetor-588 probe" --body "<spec>" --json
{"ok":true,"result":{"messageId":"msg_bd5cdff6669d"}}
+0s  ready input_accepted - idle 3m ago
+4s  ready input_accepted - working just now
+36s succeeded settled - working just now
```

A tela do worker mostrou que ele mesmo chamou o shim para reportar:
`orca orchestration send --type worker_done --outcome succeeded --task-id task_dab7c6741a66 …` →
`{"ok":true,"result":{"messageId":"msg_2e90c5d87dab","lifecycle":"completed","next":"Recorded. End your turn."}}`.

**[Fato]** O worker B, iniciado logo depois, recebeu o prompt (`activity: working` na primeira
leitura). A perda foi intermitente. **[Não verificado]** se a causa é o plugin que falhou, a primeira
largada a frio do opencode ou outra coisa.

### 4.4 Wake do coordinator e `check`

Com o worker A concluído, o Orca escreveu no terminal deste agente, que é o coordinator do Run, este
texto, recebido pelo harness como uma mensagem do usuário no meio do turno:

```text
You have 1 orchestration message. Run `orca orchestration check --run run_9773217dbba7`.
```

```text
$ orca-ide orchestration check --run run_9773217dbba7 --json
{"ok":true,"result":{"messages":[{"id":"msg_2e90c5d87dab","type":"worker_done",
 "from":"term_1d6c1cff-…","subject":"vetor-588 probe","body":"OK",
 "followUp":"To give this worker more work: /home/tavaressan/.config/orca/linux-orca-cli-shim/orca orchestration send --to dispatch:ctx_6a0eea101539 --subject \"...\" --body \"...\"",
 "payload":{"taskId":"task_dab7c6741a66","dispatchId":"ctx_6a0eea101539","outcome":"succeeded"}}]}}
$ orca-ide orchestration worker-show --dispatch ctx_6a0eea101539 --json
{"ok":true,"result":{..."state":"succeeded","stage":"settled","liveness":"live","activity":"idle",
 "terminalState":"retained",...}}
```

### 4.5 `worker-release` (idempotência)

```text
$ orca-ide orchestration worker-release --dispatch ctx_6a0eea101539 --json
{"ok":true,"result":{"dispatchId":"ctx_6a0eea101539","state":"released","processAction":"closed_agent_terminal","archive":"terminal [captured]"}}
$ orca-ide orchestration worker-release --dispatch ctx_6a0eea101539 --json
{"ok":true,"result":{"dispatchId":"ctx_6a0eea101539","state":"already_released","processAction":"none","archive":"terminal [captured]"}}
$ orca-ide orchestration worker-show --dispatch ctx_6a0eea101539 --json
{..."state":"succeeded","stage":"settled","liveness":"exited","terminalState":"released","waitingOnHuman":"unknown"}
$ orca-ide orchestration worker-read --dispatch ctx_6a0eea101539 --json --limit 5
source: terminal  status: {"worker":"succeeded","terminal":"exited","liveness":"exited"}  fallbackReason: provider_unsupported
```

A saída continua legível depois do release, como o `--help` promete.

### 4.6 `worker-stop` no meio do trabalho (worker B)

Tarefa: rodar `sleep 300`. Com o `sleep 300` vivo havia 34 s (`ps`: `647925 34 sleep 300`):

```text
$ orca-ide orchestration worker-stop --dispatch ctx_527bc6ed23eb --json
stop exit=0 583ms
{"ok":true,"result":{"dispatchId":"ctx_527bc6ed23eb","state":"stopped","alreadySettled":false,
 "processAction":"closed_agent_terminal","close":{"handle":"term_4f75bcb2-…","tabId":"b55db97f-…","ptyKilled":true},
 "mutation":{"requestId":"a5ea1653-b09e-4591-8c2c-eadd0e8df5fc","replayed":false}}}
$ ps … | grep "sleep 300"        → nada (o neto também morreu)
$ orca-ide orchestration worker-show --dispatch ctx_527bc6ed23eb --json
{..."state":"stopped","stage":"process_stopped","liveness":"exited","terminalState":"retained","attention":["failure"]}
$ orca-ide orchestration request-show --request a5ea1653-b09e-4591-8c2c-eadd0e8df5fc --json
{"ok":true,"result":{"requestId":"a5ea1653-…","state":"completed","method":"orchestration.workerStop",
 "receipt":{ ...o mesmo recibo do stop... },"interpretation":"Request a5ea1653-… already …"}}
$ orca-ide orchestration worker-release --dispatch ctx_527bc6ed23eb --json
{"ok":true,"result":{"dispatchId":"ctx_527bc6ed23eb","state":"released","processAction":"none","archive":"terminal [captured]"}}
```

### 4.7 Worktrees e limpeza (pergunta 2)

```text
$ git worktree list | grep probe
/home/tavaressan/Projects/orca/workspaces/Vetor/vetor-588-probe-a  f6ab98f [Tavaressan/vetor-588-probe-a]
/home/tavaressan/Projects/orca/workspaces/Vetor/vetor-588-probe-b  f6ab98f [Tavaressan/vetor-588-probe-b]
$ orca-ide worktree rm --worktree path:/home/tavaressan/Projects/orca/workspaces/Vetor/vetor-588-probe-a --delete-branch --json
{"id":"bac8faff-…","ok":true,"result":{"removed":true},"_meta":{"runtimeId":"2a693aea-…"}}
(o mesmo para o probe-b)
$ git worktree list | grep probe   → nada
$ git branch --list | grep probe   → nada
```

**[Fato]** Com `new-top-level`, o Orca cria o worktree **fora do repositório**
(`~/Projects/orca/workspaces/<repo>/<nome>`), numa branch `<login-do-GitHub>/<nome>` a partir de
`f6ab98f` (o `master` local e o remoto coincidiam). O `worker-stop` "Never deletes the worktree"
(`--help`). O `worktree rm` não apaga a branch por padrão: só com `--delete-branch`, e só se o Orca
puder provar que ela já está mergeada ("A removal result without branch evidence does not confirm
branch deletion"). Aqui a branch foi apagada, como o `git branch --list` confirmou.

### 4.8 Workers antigos: `release_unknown`

Dos 10 workers retidos de 2026-11-06, 4 voltaram `released` e 6 `release_unknown`:

```text
{"ok":false,"result":{"dispatchId":"ctx_16385370f68e","state":"release_unknown","processAction":"none",
 "lastError":"The recorded terminal no longer resolves; whether its process is gone cannot be proven.",
 "next":"Inspect with: …/linux-orca-cli-shim/orca orchestration worker-show … Never substitute a broad terminal close."}}
```

O `worker-show --full` dos seis mostra `lastError: "Terminal closed by operator request"` e
`liveness: {"verdict":"exited","source":"execution_host"}`. Nenhum processo ligado a esses
workspaces estava vivo (`ps`). A única forma de limpar esses registros que o CLI oferece é
`orchestration reset (--all | --tasks | --messages)`, que é global ao estado de orquestração.

### 4.9 Resolução do executável (pergunta 5)

```text
ORCA_CLI_COMMAND=/home/tavaressan/.config/orca/linux-orca-cli-shim/orca
command -v orca-dev  → (ausente)
command -v orca-ide  → /usr/bin/orca-ide           (pacote stably-orca 1.4.255-1)
command -v orca      → …/linux-orca-cli-shim/orca  (o diretório do shim vem primeiro no PATH do terminal do Orca)
/usr/bin/orca        → não existe (o leitor de tela do GNOME não está instalado neste host)
```

Variáveis presentes num terminal do Orca (nomes apenas): `ORCA_CLI_COMMAND`, `ORCA_CLI_BIN_DIR`,
`ORCA_APP_VERSION`, `ORCA_TERMINAL_HANDLE`, `ORCA_WORKTREE_ID`, `ORCA_WORKSPACE_ID`,
`ORCA_USER_DATA_PATH`, entre outras.

**[Fato]** Até a correção local de 2026-11-09, o `ORCA_CLI_COMMAND` falhava:
`Unable to locate the Orca executable next to /usr/lib/stably-orca`. O Orca regrava o shim a cada
início com `exec '/usr/lib/stably-orca/bin/orca-ide' "$@"`, e o PKGBUILD do AUR empacota esse
launcher oficial, que procura o Electron em `/usr/lib/{orca-ide,orca,Orca}` em vez do `electron43` do
sistema. A correção (instalar o wrapper `/usr/bin/orca-ide` naquele caminho) vale até a próxima
atualização do pacote. **Os comandos `next` e `followUp` que o Orca imprime usam o caminho do shim**
(§4.4, §4.8), então seguir as sugestões do próprio Orca falhava neste host.

## 5. Especificação de integração verificada

### 5.1 Ciclo de vida

| `OrchestratorAdapter` (com a proposta da #587) | Comando | Resultado esperado | Verificado |
| --- | --- | --- | --- |
| `isAvailable` | nenhum: só variáveis e caminhos (§5.3) | — | §4.9 |
| `dispatch` (`workspace.mode: "provided"`) | `worker-start --spec-file - --worktree path:<wt> --agent <id> --task-title <t> --retry-request <uuid> --json` | `dispatchId`, `taskId`, `runId`, `terminal`, `workspace` | **[Não verificado]** com `path:`; rodado com `new-top-level` |
| `dispatch` (`workspace.mode: "orchestrator"`) | `worker-start … --worktree new-top-level --repo id:<repoId> [--name <n>] [--setup skip] --json` | idem, e `keptOpen: true` | §4.2 |
| `check` | `worker-show --dispatch <id> --json` | `state` ∈ `ready`/`succeeded`/`failed`/`stopped`; `stage`; `liveness`; `waitingOnHuman` | §4.3, §4.5, §4.6 |
| saída do worker | `worker-read --dispatch <id> --json [--source transcript]` | tela ou transcrição; legível após o release | §4.3, §4.5 |
| `release` | `worker-release --dispatch <id> --json` | `released` / `already_released` / `retained` / `release_pending` (exit 0); `release_unknown` (exit 1) | §4.5, §4.8 |
| `cancel` | `worker-stop --dispatch <id> --json` | `stopped` + `ptyKilled: true`; `stop_unknown` (exit 1) | §4.6 (`stop_unknown` não reproduzido) |
| repetir após resposta perdida | `request-show --request <uuid>`; repetir com `--retry-request <uuid>` | `completed` / `pending` / `absent` | §4.6 |
| remover worktree do Orca | `worktree rm --worktree path:<p> --delete-branch --json` | `removed: true` | §4.7 |

Normalização de estados para `JobExecutionStatus`: `ready` com `stage` `input_accepted` → `running`;
`succeeded` → `completed`; `failed` → `failed`; `stopped` → `cancelled`. **[Inferência]** `queued` não
aparece: o `worker-start` só volta depois que o terminal aceitou a entrada.

### 5.2 Identificadores

| Campo do handle | Origem |
| --- | --- |
| `jobId` | `dispatchId` |
| `externalRefs.runId` | `runId` (o primeiro `worker-start` sem Run cria um e o liga ao terminal que chamou) |
| `externalRefs.taskId` | `taskId` (o retry reusa a Task: `--task <id> --retry-of <dispatchId>`) |
| `externalRefs.requestId` | o `--retry-request` que o adapter gera antes de chamar; o recibo o devolve em `mutation.requestId` |
| `workspace.path` | parte depois de `::` em `workspace` |
| `workspace.createdBy` / `removedBy` | `new-*`: `orchestrator` / `orchestrator` (`worktree rm`); `path:`/`current`: `vetor` / `vetor` |

### 5.3 Detecção de disponibilidade (nunca executa `orca` sem caminho)

Ordem do próprio Orca: `ORCA_CLI_COMMAND`, `orca-dev`, `orca-ide`, `orca`. Para o Vetor:

1. `ORCA_CLI_COMMAND` definido e arquivo executável → candidato.
2. Senão, `orca-dev` ou `orca-ide` no `PATH` (`command -v`, que não executa nada).
3. **`orca` sem caminho nunca é candidato**: fora de um terminal do Orca, no Linux, ele costuma ser o
   leitor de tela do GNOME.
4. Ter um candidato **não basta** (o shim deste host existia e falhava). A disponibilidade só é
   confirmada na primeira chamada real, que já é `agent-context --json`: leitura local, sem efeito
   colateral e sem precisar do app. Se ela falhar, o adapter fica `unavailable` com a saída de erro.
5. `status --json` confirma o runtime (`state: ready`) e as capacidades antes do primeiro dispatch.

O passo 4 executa o binário, mas só depois de resolvido por caminho, e já como parte do uso, não
"para ver se existe".

### 5.4 Independência de versão (pergunta 6)

- **Esquema dos comandos:** o adapter lista os comandos e flags de que precisa e confere contra o
  `agent-context --json` (`schemaVersion: 1`). Falta de comando ou flag → `unavailable` com o nome do
  que falta, em vez de quebrar no meio de um dispatch.
- **Contrato de orquestração:** exigir `orchestration.contract.v1` em `status --json`; usar
  `worker-auto-release.v1` e `worker-stop-verdict.v1` só se presentes.
- **Registro:** `dispatch.contractVersion` (1 no registro de 2026-11-06) vai para o handle.
- **Guia:** `skills get orchestration` é servido pelo binário e muda com a versão. O adapter não
  copia o guia; uma referência de skill aponta para ele.
- **`next` e `followUp`:** carregam o caminho do shim. O adapter usa só `nextAction.argv` (sem
  executável, #587 §3.2) com o executável resolvido em §5.3, e nunca executa o texto `next`.

## 6. Modos de uso e o que isso muda

| Modo | Quem recebe o `worker_done` | Precisa do `OrcaAdapter` em TS? |
| --- | --- | --- |
| **A. Agente do Vetor dentro de um terminal do Orca** (`ORCA_TERMINAL_HANDLE` definido) | o próprio agente, por wake (§4.4) | **Não.** O agente já tem o guia do Orca (`orchestration`); o Vetor precisa só de uma referência que diga quando usar e como mapear para o status file |
| **B. Script ou agente fora do Orca** | ninguém; é preciso observar com `worker-show` | **Sim**, e é o primeiro adapter que um `deno run` consegue executar de verdade, porque o transporte é processo e não MCP (#586 §3.3) |

**[Inferência]** No modo A, o wake é texto injetado na entrada do agente. Para o Vetor, ele deve ser
tratado como dado: o agente confirma pelo `check`/`worker-show` antes de agir, como fez este spike, e
nunca executa um comando só porque o wake o mandou.

## 7. Opções avaliadas

| Opção | Avaliação |
| --- | --- |
| **Implementar agora** o `OrcaAdapter` | O contrato atual não representa `release_unknown`, `stop_unknown`, worktree do orquestrador nem `requestId` (#587). Implementar antes obriga a refazer. |
| **Adiar** até a mudança da #587 | **Recomendada.** A integração está verificada; o bloqueio é só o contrato. |
| **Descartar** | Não se justifica: o ciclo funcionou ao vivo, e o Orca é o único orquestrador que dá ao Vetor workers de outros agentes (Codex, OpenCode, Antigravity) com supervisão. |
| **Só referência de skill (modo A)** | Barata e útil já; não depende da #587. |

## 8. Recomendação

**[Opinião]**

1. **Adiar o `OrcaAdapter` em TypeScript** até a mudança aditiva de contrato da #587 entrar. Depois
   dela, implementar o adapter do modo B com um `ToolCaller` por processo, seguindo o §5, e testes
   que usem as saídas reais do §4 como fixtures.
2. **Já agora, uma referência `skills/shared/references/delegate-orca.md`** para o modo A: quando
   usar (só com `delegation.preferredRuntime: "orca"`), detecção do §5.3, o wake tratado como dado,
   status file mantido pelo coordinator e as regras de dono do worktree da #587 §5.
3. **Mitigar o prompt perdido** (§4.3): se um worker passar de N minutos com `stage: input_accepted`,
   `activity` ociosa e nenhuma saída nova no `worker-read`, reenviar a tarefa por `send` uma única vez
   e reportar se não destravar. Nunca reiniciar em silêncio (o guia proíbe retry autônomo).
4. **`release_unknown` de terminal fechado à mão** não bloqueia o Vetor: registrar no relatório do
   coordinator e não remover o worktree enquanto o registro existir (#587 §5, regra 3), a menos que o
   diretório já não exista.
5. A seleção continua explícita: o Orca só é usado com preferência configurada.

A decisão continua humana: este spike não implementa o adapter nem cria issues de follow-up.
