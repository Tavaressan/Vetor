# Investigação: modelo de autorização no roteamento por capacidade

**Issue:** #622 — spike(execution): modelo de autorização, sensibilidade de dados e fallback no
roteamento\
**Data:** 2026-11-10\
**Base:** `master` em `0e2b39a`\
**Contexto:** ADR-002 (`docs/adr/ADR-002-capability-based-execution-routing.md` no `master`, PR
#633), ADR-001 (`docs/adr/ADR-001-runtime-independence.md`), relatórios já mergeados:
`docs/investigations/runtime-boundary.md` (#586),
`docs/investigations/orchestrator-adapter-contract.md` (#587), `docs/investigations/orca-adapter.md`
(#588), `docs/investigations/teto-de-workers.md` (#564), `docs/investigations/dispatch-na-nuvem.md`
(#565), `docs/investigations/descoberta-de-capacidades.md` (#618),
`docs/investigations/metadados-para-classificacao.md` (#620). Matriz de capacidades da #568
(`skills/shared/references/harness-capabilities.md`, `wiki/Contrato-de-Capacidades.md`), usada sem
redefini-la.

**Rótulos:** **[Fato]** verificado na fonte citada ou em comando registrado · **[Inferência]**
conclusão derivada dos fatos · **[Opinião]** juízo técnico.

---

## 1. Pergunta

A ADR-002 §5 e §8 estabelecem que casar capacidade nunca é autorização: o roteamento só pode
escolher ambientes previamente autorizados, respeitar `dataSensitivity` e política de rede, e o
fallback não pode relaxar nenhuma dessas restrições. Este relatório responde as cinco perguntas do
spike:

1. Onde a lista de executores autorizados é configurada e por quem, e como se relaciona com a
   preferência explícita de runtime de delegação?
2. Como expressar `dataSensitivity` e vinculá-la a quais provedores podem receber contexto?
3. Como garantir que fallback e retry herdem as restrições originais e não entrem em loop?
4. Como os modos manual, assistido e autônomo se mapeiam em configuração?
5. Que evidência o plano deve registrar para a decisão ser auditável?

---

## 2. Resumo

- **[Fato]** O repositório já possui dois mecanismos de controle de seleção que formam a base da
  autorização: a preferência explícita via MCP (`scripts/lib/delegation-runtime.ts:43-49`) e o
  princípio "nenhuma escolha silenciosa", implementado em três pontos do código
  (`delegation-runtime.ts:51-60`, `62-76` e `85-96`). Nunca se escolhe um executor sem consentimento
  do usuário.
- **[Fato]** O `TaskProfile` proposto em #620 (`docs/investigations/metadados-para-classificacao.md`
  §5) já carrega `constraints.dataSensitivity` como campo opcional. O `safety-policy.ts` trata hoje
  a política de saída (bloqueio de push/PR), mas não há avaliação de `dataSensitivity` ligada ao
  provedor do executor.
- **[Fato]** O `selectDelegationRuntime` já garante que a preferência indisponível **não** é
  substituída silenciosamente por outro candidato (`delegation-runtime.ts:62-76`). Isso cobre parte
  do requisito de herança de restrições no fallback.
- **[Inferência]** A lista de executores autorizados, o `dataSensitivity` e os modos Manual,
  Assistido e Autônomo são três dimensões ortogonais da autorização (ADR-002 §5, §8). Hoje só a
  primeira está implícita no código (via preferência e princípio de não-escolha). As outras duas
  estão na ADR-002 mas sem implementação.
- **[Opinião]** O modelo proposto neste relatório é aditivo: adiciona campos opcionais a
  `.claude/vetor/config.json` e ao `TaskProfile`, e define regras que o Execution Planner (ADR-002
  §4.4) aplica antes de despachar. Nenhuma recomendação exige recurso exclusivo de harness; todas
  têm fallback portátil.

---

## 3. Evidências

### 3.1 Mecanismo de seleção atual (base para a autorização)

**[Fato]** `scripts/lib/delegation-runtime.ts` implementa a seleção de runtime com estas garantias
observadas no código-fonte:

| Garantia                                    | Trecho                        | Comportamento                                                                          |
| ------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| Nenhuma escolha silenciosa entre candidatos | `delegation-runtime.ts:85-96` | Com múltiplos candidatos e sem preferência, sessão headless: `action: "inline"`        |
| Preferência indisponível não é substituída  | `delegation-runtime.ts:62-76` | Preferência configurada mas ausente no PATH: `action: "inline"`, nunca outro candidato |
| Runtime MCP só com preferência explícita    | `delegation-runtime.ts:43-49` | `mcpAvailable` só é selecionado quando `preferred === mcpAvailable[i]`                 |
| Um único candidato sem preferência é aceito | `delegation-runtime.ts:78-83` | "único candidato disponível", sem perguntar                                            |

**[Fato]** O campo `delegation.preferredRuntime` em `.claude/vetor/config.json` é hoje a única chave
de autorização de runtime de delegação. O arquivo `config.json` lido em 2026-11-10 contém
`maxConcurrentWorkers`, `runtime`, `packageManager`, `testCommand` e `modelFallback`, mas não
`delegation.preferredRuntime` neste worktree (`.claude/vetor/config.json`, conteúdo lido nesta
sessão).

**[Fato]** O `OrchestratorRegistry` (`scripts/lib/orchestrator/registry.ts`) usa o campo
`OrchestratorConfig.preferred` (tipo `scripts/lib/orchestrator/types.ts:169`) e aplica o mesmo
princípio: seleção só por preferência configurada (`runtime-boundary.md` §3.3;
`orchestrator-adapter-contract.md` §3.1).

### 3.2 `dataSensitivity` e sua ligação a provedores

**[Fato]** O `TaskProfile` proposto em #620 (`metadados-para-classificacao.md` §5) define:

```ts
constraints: {
  dataSensitivity?: "public" | "private" | "sensitive" | "unknown";
}
```

**[Fato]** O `safety-policy.ts` avalia hoje três regras de saída: (a) git destrutivo, (b) push para
branches protegidas e (c) worker não-GREEN. Não há verificação de `dataSensitivity` ligada ao
executor (`scripts/lib/safety-policy.ts`, conteúdo lido nesta sessão).

**[Fato]** A issue #565 documenta que sessões na nuvem têm nível de rede `None`, `Trusted`, `Full`
ou `Custom` (`dispatch-na-nuvem.md` §3.3). Isso é um proxy de política de rede por executor, mas não
está vinculado ao `dataSensitivity` da tarefa.

**[Inferência]** A ligação entre `dataSensitivity` e provedor precisa de uma tabela de política
(quais provedores aceitam qual nível de sensibilidade) e de verificação no momento da seleção, antes
do dispatch.

### 3.3 Fallback e retry: herança de restrições e prevenção de loop

**[Fato]** O `selectDelegationRuntime` já garante que a preferência indisponível não é substituída.
Isso implica que o fallback para `inline` preserva a restrição (nenhum executor não-autorizado é
usado). O problema é o caso em que o fallback `inline` não é viável por `dataSensitivity` (ex.:
tarefa `sensitive` não pode ser enviada para nenhum executor disponível): hoje o código retornaria
`action: "inline"` sem sinalizar a incompatibilidade.

**[Fato]** O contrato proposto em #587 (`orchestrator-adapter-contract.md` §6.2) define que
`check()` é observação idempotente e que `release_pending` impede a remoção do worktree. O retry do
Orca reusa a Task (`--task <id> --retry-of <dispatchId>`), com disjuntor após 3 falhas na cadeia
(`orca-adapter.md` §4.1).

**[Fato]** O `permissions-setup.ts` define regras mínimas de allowlist que nunca incluem merge, push
nem comandos destrutivos (`scripts/permissions-setup.ts:15-25`).

**[Inferência]** O loop de retry pode ocorrer se: (a) o executor falha, (b) o Execution Planner
retenta num executor diferente sem verificar se ele satisfaz as restrições, e (c) o novo executor
também falha. O disjuntor do Orca (3 falhas) não resolve o caso em que o Execution Planner troca de
executor entre tentativas.

### 3.4 Modos manual, assistido e autônomo

**[Fato]** A issue #565 documenta que o modo de permissão no Claude Code é por sessão
(`dispatch-na-nuvem.md` §3.3: "o modo de permissão é escolhido por sessão"). A issue #564 documenta
que subagentes plugin (como `vetor:issue-worker`) herdam o modo da sessão principal
(`teto-de-workers.md` §3.2: "plugin subagents não aceitam `permissionMode`: herdam o modo da
sessão").

**[Fato]** A issue #603 trouxe `permissions-setup.ts` com allowlist mínima para fluxos autônomos
(`teto-de-workers.md` §3.5). O modo `auto` é detectado por `autoMode.environment` em
`~/.claude/settings.json` (`scripts/permissions-setup.ts:85-94`, `96-112`).

**[Fato]** A issue #565 define o modo `--headless` como contexto sem humano para aprovar permissões,
em que workers que pedem permissão são suspensos (Fase 5.b do coordinator). A issue #564 recomenda
teto de N diferente por modo (`teto-de-workers.md` §6).

**[Inferência]** Os três modos (manual, assistido, autônomo) já existem implicitamente no Vetor como
"sem allowlist" (manual), "com allowlist mínima" (assistido) e "auto mode + headless" (autônomo). A
configuração explícita dessa distinção em `config.json` tornaria o comportamento auditável.

### 3.5 Evidência para auditabilidade

**[Fato]** O status file canônico do Vetor (`skills/shared/references/agent-status.template.md`)
registra branch, iteração, SHA testado, PR e status. Não há campo de registro da decisão de
roteamento.

**[Fato]** O `TaskProfile` proposto em #620 (`metadados-para-classificacao.md` §5) já inclui
`evidence`, `confidence.signals`, `confidence.conflicts` e `rationale[]` como campos de rastreio das
decisões de classificação. O mesmo padrão se aplica à decisão de roteamento.

**[Fato]** O contrato proposto em #587 define `externalRefs` no handle (com `runId`, `taskId`,
`requestId`) e `workspace.createdBy`/`removedBy` para rastreabilidade do worktree
(`orchestrator-adapter-contract.md` §6.1).

---

## 4. Respostas às perguntas do spike

### 4.1 Pergunta 1 — Lista de executores autorizados

**[Opinião]** A lista de executores autorizados deve residir em `.claude/vetor/config.json`, sob uma
chave `execution.authorizedProviders`, por três razões:

1. É o único arquivo que o Vetor lê hoje para configuração de delegação (já contém
   `maxConcurrentWorkers`, `modelFallback` e é a fonte de `delegation.preferredRuntime`).
2. É versionado por repositório: a política de autorização acompanha o código e pode ser revisada no
   mesmo PR.
3. Pode ser sobrescrito por `settings.local.json` para uso local sem commit, seguindo o mesmo padrão
   do Claude Code (`scripts/permissions-setup.ts:97-100`).

**Nota de terminologia:** a ADR-002 §8 usa "authorized harnesses". O campo proposto é
`authorizedProviders` em vez de `authorizedHarnesses` porque o Vetor delega para dois tipos de
executores — harnesses (Claude Code, Antigravity, OpenCode, Codex, Kiro) e orquestradores
assíncronos (Orca, Alethe) —, ambos identificados pelo `id` do adapter. "Providers" cobre os dois
sem criar dois campos separados. A semântica de segurança da ADR-002 §8 é preservada: nenhum
executor não listado recebe contexto.

**[Opinião]** Estrutura proposta:

```jsonc
// .claude/vetor/config.json
{
  "execution": {
    // Lista explícita de executores (harnesses ou orquestradores) que este repositório autoriza
    // a receber contexto. Ausente ou vazio = apenas execução inline (modo padrão, sem roteamento
    // externo). Corresponde a "authorized harnesses" da ADR-002 §8.
    "authorizedProviders": ["opencode", "codex", "orca"],
    // Preferência de runtime de delegação (já existente; mantida por compatibilidade).
    "preferredRuntime": null
  }
}
```

**[Opinião]** Relação com `preferredRuntime` existente:

- `preferredRuntime` continua como campo de compatibilidade (§3.1).
- `authorizedProviders` é uma lista explícita (opt-in): um executor não listado nunca recebe
  contexto, mesmo que esteja no PATH ou seja preferido.
- Se `preferredRuntime` aponta para um executor **não** em `authorizedProviders`, o Execution
  Planner devolve `action: "inline"` com motivo
  `"preferredRuntime não está em authorizedProviders"`.
- Se `authorizedProviders` está ausente ou vazio, o comportamento atual é preservado (sem roteamento
  externo).

**[Fato/Inferência]** Quem configura: o mantenedor do repositório, em `config.json` versionado. O
usuário pode adicionar entradas via `.claude/settings.local.json` (não commitado). Uma política de
organização (nível de usuário em `~/.claude/settings.json`) pode ser consultada como camada
adicional, seguindo a precedência já documentada para o Claude Code
(`scripts/permissions-setup.ts:97-102`).

### 4.2 Pergunta 2 — `dataSensitivity` e ligação a provedores

**[Opinião]** A ligação entre `dataSensitivity` do `TaskProfile` e os provedores autorizados deve
ser uma tabela de política em `config.json`:

```jsonc
// .claude/vetor/config.json
{
  "execution": {
    "authorizedProviders": ["opencode", "codex", "orca"],
    "dataSensitivityPolicy": {
      // Mapeamento: nível de sensibilidade → lista de provedores que podem receber esse contexto.
      // Provedores ausentes aqui nunca recebem tarefas do nível correspondente, mesmo que
      // autorizados em authorizedProviders.
      // Os três primeiros níveis seguem ADR-002 §4.3; "unknown" é extensão do #620 para o caso
      // de classificação com baixa confiança — tratado como o nível mais restritivo.
      "public": ["opencode", "codex", "orca"],
      "private": ["codex"],
      "sensitive": [],
      "unknown": []
    }
  }
}
```

**Nota de terminologia:** a ADR-002 §4.3 define `dataSensitivity` com três valores:
`"public" | "private" | "sensitive"`. O valor `"unknown"` é uma extensão proposta em #620
(`metadados-para-classificacao.md` §5) para o caso em que a classificação determinística tem baixa
confiança. Essa extensão é aditiva e conservadora: o Execution Planner trata `"unknown"` como o
nível mais restritivo, o que está alinhado com ADR-002 §8 ("Sensitive task context must not be
forwarded to unauthorized providers").

**[Opinião]** Regra de avaliação: o Execution Planner intersecta `authorizedProviders` com
`dataSensitivityPolicy[taskProfile.constraints.dataSensitivity ?? "unknown"]` para obter a lista de
candidatos elegíveis. Se a intersecção for vazia, `action: "inline"` com motivo
`"nenhum executor autorizado para dataSensitivity=<nível>"`.

**[Opinião]** Ligação a `safety-policy.ts`: o `safety-policy.ts` avalia políticas de **saída**
(push, merge, destrutivo). A avaliação de `dataSensitivity` é uma política de **entrada** (antes do
dispatch). São camadas ortogonais: a política de entrada evita que o contexto chegue ao executor
errado; a política de saída evita que o executor cause dano depois. As duas devem permanecer
separadas para rastreabilidade.

**[Fato]** O campo `dataSensitivity` no `TaskProfile` é derivado deterministicamente de metadados da
issue (labels, título, critérios de aceite) com confiança anotada (`metadados-para-classificacao.md`
§4.3). Quando `needsSemanticFallback: true` ou `confidence.byField["dataSensitivity"] < 0,60`, o
Execution Planner usa o valor `"unknown"` (mais restritivo) em vez do valor inferido. **Isso é uma
regra de segurança alinhada à ADR-002 §8: na dúvida, o contexto não é enviado.**

### 4.3 Pergunta 3 — Fallback e retry: herança de restrições e prevenção de loop

**[Fato]** A ADR-002 §5.1 lista os gatilhos de fallback: (a) indisponibilidade do executor, (b) rate
limits do provedor, (c) falhas de startup, (d) erros de execução recuperáveis, (e) políticas de
timeout. O relatório cobre todos eles na tabela de cenários (§5) e nas Regras F1–F4.

**[Opinião]** Quatro regras para herança de restrições:

**Regra F1 — Fallback preserva o conjunto de restrições original.** Quando o executor preferido está
indisponível, o Execution Planner só pode fazer fallback para executores que satisfazem **todas** as
mesmas restrições da tarefa original (`dataSensitivity`, `authorizedProviders`, política de rede).
Nunca relaxa uma restrição para encontrar um executor disponível.

**Regra F2 — O fallback para `inline` é sempre permitido como último recurso.** `inline` não envia
contexto para fora: satisfaz qualquer `dataSensitivity`. Quando nenhum executor externo satisfaz as
restrições, `action: "inline"` é o resultado correto, não uma falha. O Execution Planner registra o
motivo.

**Regra F3 — Limite de tentativas configurável, com teto padrão.** Proposta de campo em
`config.json`:

```jsonc
{
  "execution": {
    "maxRetryAttempts": 2
  }
}
```

O padrão é 2 (compatível com o disjuntor do Orca de 3 falhas na cadeia `--retry-of`,
`orca-adapter.md` §4.1). O Execution Planner conta tentativas por `taskId` (ou equivalente por
orquestrador), não por executor. Ao atingir o limite, `action: "inline"` com motivo
`"maxRetryAttempts atingido"`.

**Regra F4 — Nenhuma tentativa num executor que já falhou na mesma execução.** O Execution Planner
mantém um conjunto de executores tentados para a tarefa corrente. Se o único executor disponível que
satisfaz as restrições já foi tentado e falhou, o resultado é `action: "inline"` (ou
`action: "escalate"` no modo Manual/Assistido), sem tentar novamente. Isso quebra o loop mesmo
quando `maxRetryAttempts` não foi atingido.

**[Fato]** Compatibilidade com o `selectDelegationRuntime` existente: a Regra F1 é compatível com o
princípio atual de "preferência indisponível não é substituída" (`delegation-runtime.ts:62-76`). As
Regras F2–F4 adicionam o critério de sensibilidade e o teto de tentativas, que hoje não existem.

### 4.4 Pergunta 4 — Modos manual, assistido e autônomo em configuração

**[Opinião]** Os três modos já existem implicitamente (§3.4). A proposta é torná-los explícitos em
`config.json`:

```jsonc
{
  "execution": {
    // "manual"   : roteamento desligado; sempre inline; comportamento atual quando authorizedProviders
    //              está ausente. Preserva compatibilidade com instalações existentes.
    // "assisted" : roteamento ativo, mas o planner pergunta antes de despachar para executor externo;
    //              equivale ao fluxo atual de "ask" no selectDelegationRuntime com interativo=true.
    // "autonomous": roteamento ativo, sem perguntar; requer authorizedProviders não-vazio
    //               e dataSensitivityPolicy explícita. Opt-in: nunca é o padrão.
    "mode": "manual"
  }
}
```

**[Opinião]** Tabela de comportamento por modo:

| Modo         | Roteamento externo | Pergunta ao usuário         | `authorizedProviders` obrigatório | `dataSensitivityPolicy` obrigatória |
| ------------ | ------------------ | --------------------------- | --------------------------------- | ----------------------------------- |
| `manual`     | desligado          | não                         | não                               | não                                 |
| `assisted`   | ativo              | sim, antes de cada dispatch | sim                               | recomendado                         |
| `autonomous` | ativo              | não                         | sim, não-vazio                    | sim                                 |

**[Opinião]** Regra de precedência: a preferência explícita do usuário (`preferredRuntime`) tem
precedência sobre o `mode` (ADR-002 §3.1 princípio 4: "existing explicit user preferences must take
precedence over automatic routing"). Se `preferredRuntime` está configurado e o executor está em
`authorizedProviders`, o Execution Planner despacha sem perguntar, independente do `mode`
(compatibilidade com o comportamento atual).

**[Fato]** O modo `autonomous` é **opt-in**: o valor padrão de `mode` é `"manual"`, preservando o
comportamento atual quando o campo está ausente. Isso satisfaz o critério de aceite "autônomo
permanece opt-in".

**[Opinião]** Integração com o `permissions-setup.ts`: no modo `autonomous`, o Execution Planner
deve verificar que `autoMode.environmentConfigured === true` (do `checkPermissions`) antes de
despachar o primeiro worker. Se não estiver configurado, devolve `action: "ask"` com sugestão de
rodar `deno run -A scripts/permissions-setup.ts --apply`.

### 4.5 Pergunta 5 — Evidência auditável

**[Opinião]** O Execution Planner deve registrar um objeto `RoutingDecision` em cada dispatch,
compatível com o padrão de `evidence`/`rationale` do `TaskProfile` (#620 §5) e alinhado à
rastreabilidade exigida pela ADR-002 §9:

```ts
interface RoutingDecision {
  decidedAt: string; // ISO 8601
  taskId: string; // número da issue ou ID externo
  mode: "manual" | "assisted" | "autonomous";
  outcome: "inline" | "delegate" | "ask" | "blocked";
  executor?: string; // quando outcome === "delegate"
  dataSensitivity: string; // valor usado (pode ser "unknown" por conservadorismo)
  dataSensitivityConfidence: number; // de 0 a 1, do TaskProfile
  authorizedProviders: string[];
  candidatesEvaluated: Array<{
    provider: string;
    eligible: boolean;
    reason: string;
  }>;
  retryAttempt: number; // 0 para o primeiro dispatch
  restrictions: string[]; // restrições ativas que limitaram a seleção
  rationale: string[]; // frases curtas, reproduzíveis para as mesmas entradas
}
```

**[Opinião]** Onde registrar: o `RoutingDecision` vai no log do coordinator (mesmo padrão do
relatório final da onda, `teto-de-workers.md` §6 item 6) e, quando o executor é externo, como campo
`externalRefs.routingDecisionId` no `OrchestratorJobHandle` proposto em #587
(`orchestrator-adapter-contract.md` §6.1). Isso vincula a decisão ao job no orquestrador.

**[Opinião]** O `RoutingDecision` não vai para o status file do worker: o status file é de
propriedade do worker; a decisão de roteamento é de propriedade do Execution Planner/coordinator.

---

## 5. Tabela de cenários (critério de aceite)

A tabela cobre os quatro cenários pedidos pela issue, com o comportamento esperado do planner e do
fallback para cada modo.

| Cenário                                                                                           | Modo         | Comportamento do planner                                                                                         | Comportamento do fallback                                       | Restrições preservadas?                       |
| ------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| **Executor não autorizado** (executor solicitado não está em `authorizedProviders`)               | qualquer     | `action: "inline"`, motivo: `"executor não em authorizedProviders"`                                              | N/A: o fallback é inline, que é sempre permitido (Regra F2)     | Sim                                           |
| **Executor não autorizado**                                                                       | `autonomous` | `action: "blocked"` + log de `RoutingDecision`                                                                   | N/A: sem executor disponível, não há retry externo              | Sim                                           |
| **Contexto sensível** (`dataSensitivity: "sensitive"` e `dataSensitivityPolicy.sensitive` vazio)  | qualquer     | `action: "inline"`, motivo: `"nenhum executor autorizado para sensitive"`                                        | N/A: inline sempre permitido                                    | Sim                                           |
| **Contexto sensível** (confiança baixa, `needsSemanticFallback: true`)                            | qualquer     | Usa `dataSensitivity: "unknown"` → política de unknown → inline ou bloqueio                                      | Mesmo comportamento: conservador                                | Sim: "na dúvida, não envia"                   |
| **Rate limit / executor indisponível** (executor autorizado, mas falha com rate limit ou timeout) | `manual`     | Primeira falha: `action: "inline"` imediato (modo manual não retenta)                                            | Inline, sem retry externo                                       | Sim                                           |
| **Rate limit / executor indisponível**                                                            | `assisted`   | `action: "ask"` com proposta de retry em N s ou inline                                                           | Usuário decide; planner registra                                | Sim: usuário aprova                           |
| **Rate limit / executor indisponível**                                                            | `autonomous` | Retry até `maxRetryAttempts`; cada retry verifica restrições (Regra F1); ao atingir o limite, `action: "inline"` | Inline, com `RoutingDecision.retryAttempt` = `maxRetryAttempts` | Sim: restrições verificadas em cada tentativa |
| **Loop de retry** (mesmo executor, mesmo erro, múltiplas tentativas)                              | `autonomous` | Regra F4: executor já tentado e falhou → `action: "inline"` imediatamente, sem esperar `maxRetryAttempts`        | Inline                                                          | Sim                                           |
| **Aprovação exigida** (modo `assisted`, executor disponível e autorizado)                         | `assisted`   | `action: "ask"`, proposta com executor e `dataSensitivity`; aguarda resposta                                     | Se negado: `action: "inline"`                                   | Sim: o usuário aprova explicitamente          |
| **Roteamento desligado** (`mode: "manual"` ou `authorizedProviders` ausente)                      | `manual`     | `action: "inline"` sempre, comportamento pré-ADR-002 preservado                                                  | N/A                                                             | N/A: sem restrições de roteamento             |

---

## 6. Compatibilidade com o comportamento atual

**[Fato]** O campo `execution` está ausente do `config.json` atual (`.claude/vetor/config.json`,
conteúdo lido em 2026-11-10). Portanto:

- `execution.mode` ausente → `"manual"` → roteamento externo desligado → comportamento atual
  preservado.
- `execution.authorizedProviders` ausente → nenhum executor externo autorizado → idem.
- `execution.dataSensitivityPolicy` ausente → qualquer `dataSensitivity` bloqueia o roteamento
  externo (porque a intersecção com `authorizedProviders` está vazia).

**[Fato]** O `selectDelegationRuntime` existente e o `OrchestratorRegistry` não são modificados: o
Execution Planner chama esses módulos como antes, mas adiciona a verificação de
`authorizedProviders` e `dataSensitivityPolicy` antes de usar o resultado. A camada de autorização é
pré-seleção, não dentro da seleção.

**[Opinião]** Migrações de instalações existentes: quem hoje tem `delegation.preferredRuntime`
configurado em `config.json` continua funcionando como antes (modo `manual` implícito, preferência
respeitada). Para ativar o roteamento, o mantenedor adiciona `execution.mode: "assisted"` ou
`"autonomous"` **e** `execution.authorizedProviders` explicitamente. Sem os dois, o comportamento
não muda.

---

## 7. Harnesses suportados e portabilidade

**[Fato]** A autorização proposta depende só de:

1. Leitura de `config.json` (ler arquivo — núcleo obrigatório).
2. Lógica determinística em Deno/TypeScript pura (`delegation-runtime.ts`,
   `scripts/lib/orchestrator/registry.ts`).
3. Nenhuma chamada a ferramenta de harness antes da decisão.

**[Fato]** A matriz de harnesses suportados é a da #568 (`wiki/Contrato-de-Capacidades.md`),
estendida com o Kiro (`kiro-cli` 3.1.0, adicionado por solicitação do adendo desta tarefa). A
autorização funciona em todos eles porque não usa capacidade opcional:

| Harness                 | Suporte à autorização proposta | Observação                                                                                                                                                                                                  |
| ----------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code             | ✅                             | `config.json` lido nativamente; hooks de saída não são afetados                                                                                                                                             |
| Antigravity             | ✅                             | núcleo de arquivo/shell suficiente                                                                                                                                                                          |
| OpenCode                | ✅                             | núcleo de arquivo/shell suficiente                                                                                                                                                                          |
| Codex                   | ✅                             | núcleo de arquivo/shell suficiente                                                                                                                                                                          |
| Cursor                  | ✅                             | núcleo de arquivo/shell suficiente                                                                                                                                                                          |
| Kiro (`kiro-cli` 3.1.0) | ✅                             | núcleo de arquivo/shell suficiente; Kiro expõe pelo menos as três capacidades do núcleo (ler, editar, rodar shell); capacidades opcionais não verificadas (❓ na matriz — vale o fallback portátil da #568) |

**[Opinião]** Nenhuma recomendação exige recurso exclusivo de harness. O `permissions-setup.ts`
continua sendo otimização aditiva para o Claude Code (modo auto); nos demais harnesses, a allowlist
equivale a verificação explícita antes de despachar, como descrito em `harness-capabilities.md`
§2.2.

---

## 8. Lacunas e itens não verificados

- **[Fato]** O campo `execution.authorizedProviders` não existe hoje em nenhum arquivo do
  repositório. Este relatório propõe o schema; a implementação é futura.
- **[Fato]** O `TaskProfile` com `dataSensitivity` não está implementado; existe como proposta em
  #620 (`metadados-para-classificacao.md` §5). Os limiares de confiança (0,75 global, 0,60 por
  campo) são `[Opinião] não calibrada` (#620 §4.3).
- **[Fato]** Kiro (`kiro-cli` 3.1.0) não está na matriz de `wiki/Contrato-de-Capacidades.md`. As
  capacidades opcionais do Kiro são ❓ (não verificadas). A investigação #618 não testou o Kiro
  neste contexto (`descoberta-de-capacidades.md` §4.4).
- **[Não verificado]** O comportamento do `selectDelegationRuntime` com o campo
  `execution.authorizedProviders` não foi testado em código; a proposta é de design.
- **[Não verificado]** A interação entre `dataSensitivityPolicy` e os níveis de rede do executor
  (ex.: `Trusted`/`Full` do Claude Code remoto, `dispatch-na-nuvem.md` §3.3) não foi mapeada.
  Recomenda-se uma issue de follow-up após a implementação do `TaskProfile`.
- **Questões abertas da ADR-002 §13 parcialmente respondidas por este relatório:**
  - §13 Q7 ("What is the appropriate minimum confidence threshold for autonomous task
    classification?"): abordada em §4.2 (limite 0,60 por campo para `dataSensitivity`) e §3.4 de
    #620 — ainda marcada como `[Opinião] não calibrada`.
  - §13 Q9 ("Which existing Coordinator metadata can be reused without introducing coupling?"):
    abordada em §4.5 (`RoutingDecision` separado do status file do worker).
  - §13 Q1 ("Should harness discovery use native CLI inspection, integration adapters, or both?"),
    Q3 ("Should capability profiles be bundled with Vetor, provided by integrations, or both?"), Q4,
    Q5, Q6 e Q8: não abordadas neste spike; permanecem abertas para fases subsequentes da ADR-002.

---

## Critério de aceite

Verificação de cada item da issue #622:

- [x] **Relatório em `docs/investigations/` com o modelo de autorização proposto, cobrindo as cinco
      perguntas.**
  - Pergunta 1 (executores autorizados): §4.1
  - Pergunta 2 (`dataSensitivity`): §4.2
  - Pergunta 3 (fallback e retry): §4.3
  - Pergunta 4 (modos): §4.4
  - Pergunta 5 (evidência auditável): §4.5
- [x] **Tabela de cenários (executor não autorizado, contexto sensível, rate limit, aprovação
      exigida) com o comportamento esperado do planner e do fallback.** — §5.
- [x] **Compatível com o comportamento atual quando o roteamento está desligado.** — §6:
      `execution.mode` ausente ou `"manual"` preserva o comportamento atual sem nenhuma mudança no
      código existente.
- [x] **Autônomo permanece opt-in.** — §4.4: `mode` padrão é `"manual"`; `"autonomous"` é opt-in e
      requer `authorizedProviders` não-vazio e `dataSensitivityPolicy` explícita.
