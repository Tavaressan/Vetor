---
id: spec:delegacao-runtimes-orquestradores
type: spec
project: Vetor
status: draft
created: 2026-10-22
updated: 2026-10-22
---
# Abstração e Interfaces para Runtimes Orquestradores (Alethe, Orca e MCP)

## Summary

Formalizar no Vetor uma camada de abstração normativa e polimórfica para orquestradores de agentes externos (como Alethe, Orca e servidores MCP genéricos), ampliando a capacidade de delegação além de CLIs síncronos pontuais (`agy`, `opencode`, `codex`) e evitando o acoplamento a vendor identificado na issue #482 e no Spike #451. A arquitetura estabelece contratos formais de ciclo de vida (`dispatch`, `check`, `release`), descoberta em duas camadas (in-harness e out-of-harness), adaptadores dedicados e uma pipeline compartilhada de salvaguardas (sanitização de rascunhos, isolamento estrito de worktree e validação soberana no host).

## Context

**Fatos verificados:**
1. **Delegação CLI existente (Issue #247):** O Vetor hoje delega tarefas mecânicas efêmeras de alto consumo de tokens (resumos de logs, rascunhos de PR, commits) para CLIs no PATH via pipes (`<producer> | $DELEGATE "<prompt>"`), gerenciados por `scripts/lib/delegation-runtime.ts` e `skills/shared/references/delegate-to-runtime.md`.
2. **Evidências do Spike #451:** No Spike #451 (`docs/investigations/alethe-orchestrator-awareness-spike.md`), o harness Claude Code foi operado sob o orquestrador Alethe. O Alethe injetou ferramentas MCP dinâmicas (`mcp__alethe__alethe_delegate`, `alethe_check`, `alethe_status`, `alethe_release`). A proposta original formulou uma integração acoplada a esses nomes literais de ferramentas.
3. **Problema da Issue #482:** Fixar o código do Vetor em ferramentas `mcp__alethe__*` introduz acoplamento a um único vendor. Novos orquestradores e multiplexadores de agentes — notadamente o **Orca**, servidores MCP padronizados ou gateways proprietários — operam sob a mesma premissa (despachar tarefas assíncronas em worktrees isolados), mas com identificadores de ferramentas e payloads próprios.
4. **Princípio de Disponibilidade MCP:** Conforme `skills/shared/references/mcp-availability.md` e `scripts/lib/mcp.ts`, a checagem de ferramentas MCP é estática por segmento (`matchesMcpServer(tool, server)`), sem chamadas dinâmicas exploratórias.
5. **Coordinator e Worktrees:** O `/vetor:coordinator` despacha subagentes nativos via `Agent({ isolation: "worktree" })` (`skills/coordinator/SKILL.md`). Sob orquestradores externos, o despacho deve ocorrer através de workers no filesystem com isolamento de diretório.

## Goals

- Definir uma interface TypeScript normativa (`OrchestratorAdapter`) com o ciclo de vida completo de delegação assíncrona: `isAvailable`, `dispatch`, `check` (polling seguro) e `release`.
- Implementar o `OrchestratorRegistry` para gerenciar a descoberta estática (in-harness via namespace MCP e out-of-harness via variáveis de ambiente) e a resolução do orquestrador ativo com suporte a preferências de configuração (`.claude/vetor/config.json`).
- Implementar adaptadores concretos para **Alethe** (`AletheAdapter`), **Orca** (`OrcaAdapter`) e um adaptador configurável para servidores MCP arbitrários (`GenericMcpAdapter`).
- Estabelecer um contrato de salvaguardas compartilhado e agnóstico de provedor:
  - Isolamento estrito de worktree (`one-call-per-group`);
  - Proibição de comandos git e gh no worker sandboxed;
  - Validação soberana da suíte de testes no host pelo coordinator;
  - Limite rígido de polling seguro (`safePollTimeoutMs <= 50000`) para evitar estouro de timeout do transporte MCP;
  - Liberação obrigatória de recursos (`release-before-cleanup`) para evitar erros de "Device or resource busy";
  - Pipeline de sanitização de rascunhos (`DraftSanitizer`) contra corrupções de UTF-8, escapes de Markdown e remoção indevida de documentação.
- Integrar a abstração no `/vetor:now` (sondagem e priming), `/vetor:coordinator` (plano de dispatch, monitoramento e release) e na referência central `skills/shared/references/delegate-to-runtime.md`.

## Non-Goals

- Unificar a interface de CLIs locais (pipes efêmeros síncronos) com a interface de orquestradores (tarefas assíncronas em worktree): ambos são tipos de delegação, mas possuem ciclos de vida e semânticas incompatíveis.
- Executar comandos de git remotos (push, pull request, merge) ou alteração de branches a partir de workers do orquestrador: o gerenciamento de versão permanece soberano no host principal do Vetor.
- Confiar no resultado de testes emitidos dentro do container ou sandbox do orquestrador como critério final de aceitação: o coordinator no host sempre executa a suíte de testes localmente.
- Gerenciar o ciclo de vida ou a instalação dos executáveis dos orquestradores (Alethe, Orca, etc.): o Vetor apenas detecta se o harness está inserido sob eles e os consome de forma não invasiva.

## Users / Personas

- **Desenvolvedor / Mantenedor do Vetor:** Opera o harness sob diferentes orquestradores (Alethe, Orca, Claude Code nativo, Codex) com comportamento previsível, auditável e sem regressões.
- **Skill `/vetor:coordinator`:** Coordenador autônomo que despacha ondas de issues paralelas para workers remotos com máxima conservação de contexto no agente principal.
- **Skill `/vetor:now`:** Ponto de entrada diário que identifica o orquestrador presente e prepara o agente para utilizá-lo.

## Functional Requirements

### RF-01 - Interface Normativa do Driver (`OrchestratorAdapter`)

**Priority:** Must

**Description:** Qualquer orquestrador externo deve implementar uma interface padronizada que expõe identidade, matriz de capacidades e os métodos fundamentais de ciclo de vida (`isAvailable`, `dispatch`, `check`, `release` e opcionalmente `cancel`).

**Acceptance Criteria:**
- [ ] O módulo `scripts/lib/orchestrator/types.ts` exporta a interface `OrchestratorAdapter`, `OrchestratorCapabilities`, `OrchestratorDispatchInput`, `OrchestratorJobHandle` e `OrchestratorCheckResult`.
- [ ] O estado de execução retornado por `check` é normalizado no enum canônico `JobExecutionStatus` (`queued`, `running`, `completed`, `failed`, `cancelled`).
- [ ] A interface desacopla chamadas de ferramentas através de uma função de injeção de dependência `toolCaller: (name, args) => Promise<unknown>`, permitindo testes unitários 100% determinísticos com mocks sem I/O real.

**Happy Path:**
1. O caller invoca `adapter.dispatch(input, toolCaller)`.
2. O adapter formata o payload específico do vendor e chama a ferramenta MCP correspondente.
3. O adapter retorna um `OrchestratorJobHandle` normalizado contendo `jobId`, `orchestratorId` e `cwd`.

### RF-02 - Registro e Resolução Polimórfica (`OrchestratorRegistry`)

**Priority:** Must

**Description:** Uma classe de registro central gerencia os adaptadores disponíveis, executa a detecção estática contra as ferramentas da sessão e variáveis de ambiente, e resolve o orquestrador ativo respeitando as preferências do usuário.

**Acceptance Criteria:**
- [ ] O `OrchestratorRegistry` permite registrar múltiplos adaptadores (`register(adapter)`).
- [ ] A função `detectAvailable({ tools, env })` filtra os adaptadores que retornam `isAvailable === true` sem disparar comandos shell nem chamadas de rede.
- [ ] A função `select(available, preferredId, interactive)` segue a regra:
  - Sem adaptadores ativos -> ação `native` (fallback para subagentes nativos do harness).
  - Preferência configurada presente nos disponíveis -> ação `orchestrate` com o adapter preferido.
  - Preferência configurada indisponível -> ação `native` (sem substituição silenciosa por outro vendor).
  - Um único adaptador disponível sem preferência -> ação `orchestrate` direto (sem ambiguidade).
  - Múltiplos adaptadores sem preferência em sessão interativa -> ação `ask`.
  - Múltiplos adaptadores sem preferência em sessão headless -> ação `native` (critério de desempate determinístico).

### RF-03 - Adaptador Concreto para Alethe (`AletheAdapter`)

**Priority:** Must

**Description:** Implementar o adaptador específico para o orquestrador Alethe, mapeando as ferramentas canônicas documentadas no Spike #451.

**Acceptance Criteria:**
- [ ] `isAvailable` retorna verdadeiro se houver ferramenta casando com `matchesMcpServer(tool, "alethe")` ou se `env.ALETHE_ORCHESTRATOR` / `env.ALETHE_SESSION_ID` estiver definido.
- [ ] `dispatch` chama `mcp__alethe__alethe_delegate` com `{ prompt, cwd, backend }` e extrai o `job_id`.
- [ ] `check` chama `mcp__alethe__alethe_check` com `{ job_id, timeoutMs }`, limitando estritamente `timeoutMs <= 50000` (50s).
- [ ] `release` chama `mcp__alethe__alethe_release` com `{ job_id }`.
- [ ] Declara `requiresExplicitRelease: true` em suas capacidades.

### RF-04 - Adaptador Concreto para Orca (`OrcaAdapter`)

**Priority:** Must

**Description:** Implementar o adaptador específico para o orquestrador Orca, permitindo que tarefas do Vetor sejam despachadas sob seu ecossistema.

**Acceptance Criteria:**
- [ ] `isAvailable` retorna verdadeiro se houver ferramenta casando com `matchesMcpServer(tool, "orca")` ou se `env.ORCA_ORCHESTRATOR_ACTIVE` estiver definido.
- [ ] `dispatch` mapeia o prompt e worktree para o payload aceito pelo Orca (ex.: `mcp__orca__task_dispatch` ou equivalente).
- [ ] `check` mapeia a consulta de progresso e traduz os estados internos do Orca para `JobExecutionStatus`.
- [ ] `release` libera recursos mantidos pelo Orca no worktree.

### RF-05 - Adaptador Configurável Genérico (`GenericMcpAdapter`)

**Priority:** Should

**Description:** Permitir a declaração de novos orquestradores baseados em MCP diretamente no arquivo `.claude/vetor/config.json`, sem exigir alteração no código-fonte do plugin.

**Acceptance Criteria:**
- [ ] Se o bloco `delegation.orchestrators.<nome>` estiver configurado com mapeamento de ferramentas (`dispatchTool`, `checkTool`, `releaseTool`), o `GenericMcpAdapter` é instanciado dinamicamente.
- [ ] O adaptador valida que as ferramentas declaradas existem no namespace ativo antes de se declarar disponível.
- [ ] Aplica por padrão o teto de segurança de polling de 50s.

### RF-06 - Pipeline de Sanitização de Rascunhos (`DraftSanitizer`)

**Priority:** Must

**Description:** Utilitário autônomo que inspeciona diffs e arquivos gerados por workers remotos antes de serem incorporados em commits pelo coordinator.

**Acceptance Criteria:**
- [ ] Detecta caracteres de controle crus e corrupção de acentuação/UTF-8.
- [ ] Detecta crases literais mal escapadas (como sequências `` `n `` em Markdown).
- [ ] Detecta remoção involuntária de blocos de comentários JSDoc em arquivos TypeScript.
- [ ] Detecta bashismos incompatíveis (como `declare -A`) em scripts shell que requerem portabilidade.
- [ ] Retorna relatório com arquivos afetados, linha e severidade (aviso ou bloqueante).

### RF-07 - Integração com `/vetor:now` e Sondagem

**Priority:** Must

**Description:** O comando de kickoff e o script `now-probe.ts` devem reportar a presença de qualquer orquestrador registrado e realizar o priming apropriado.

**Acceptance Criteria:**
- [ ] `now-probe.ts` inclui a checagem de variáveis de ambiente de orquestradores conhecidos no payload retornado.
- [ ] A skill `skills/now/SKILL.md` cruza o retorno do script com `registry.detectAvailable({ tools, env })`.
- [ ] Se um orquestrador estiver disponível, exibe no sumário executivo:
  `- Orquestrador: <DisplayName> detectado (ferramentas ativas)`
- [ ] Aplica o priming explícito orientando a delegação de ondas do coordinator ao orquestrador ativo.

### RF-08 - Integração com `/vetor:coordinator`

**Priority:** Must

**Description:** O fluxo do coordinator deve consultar o registry na Fase 2 para indicar o backend e, na Fase 4, despachar através do adaptador em vez de invocar diretamente o subagente nativo.

**Acceptance Criteria:**
- [ ] A Fase 2 inclui na tabela de dispatch a identificação do orquestrador (ex.: `Backend: Alethe (Codex)` ou `Backend: Orca`).
- [ ] A Fase 4 despacha cada grupo para seu worktree próprio através de `adapter.dispatch()` (`one-call-per-group`).
- [ ] A Fase 5 realiza o loop de polling seguro invocando `adapter.check()` com pausas entre iterações e timeout limitado a 50s.
- [ ] A Fase 6 roda a suíte de testes no host principal, aplica o `DraftSanitizer` e invoca `adapter.release()` antes de qualquer limpeza de worktree.

## Non-Functional Requirements

### RNF-01 - Descoberta Estática com Zero I/O Desnecessário

**Priority:** Must

**Description:** Em conformidade com `mcp-availability.md`, a detecção de orquestradores nunca deve tentar chamadas "para ver se funciona" nem executar processos pesados de shell. Deve basear-se exclusivamente no namespace de ferramentas em memória e variáveis de ambiente já carregadas.

**Acceptance Criteria:**
- [ ] A avaliação de `isAvailable` nos adaptadores executa em menos de 10ms sem invocar processos shell secundários.
- [ ] A checagem de MCP apoia-se puramente no array de ferramentas ativas da sessão já provido pelo harness.

### RNF-02 - Tolerância a Falhas e Fallback Transparente

**Priority:** Must

**Description:** Qualquer falha de transporte MCP, erro de autenticação ou crash do worker delegado deve resultar em fallback imediato para execução local/nativa pelo coordinator, sem interromper a sessão do usuário.

**Acceptance Criteria:**
- [ ] Exceções lançadas por chamadas de ferramentas durante `dispatch` ou `check` não causam encerramento não tratado do processo do coordinator.
- [ ] Em caso de falha de comunicação, o grupo é automaticamente reclassificado para execução nativa com registro claro no log de auditoria.

### RNF-03 - Prevenção de Bloqueio de Recursos (Resource Leaks)

**Priority:** Must

**Description:** O ciclo de vida garante que `adapter.release(handle)` seja invocado em blocos `try...finally` antes de qualquer chamada a `safe-remove-worktree`, prevenindo o travamento de arquivos no Windows ("Device or resource busy").

**Acceptance Criteria:**
- [ ] A chamada a `adapter.release()` é executada antes da desmontagem ou remoção de qualquer worktree associado a um job de orquestrador.
- [ ] Falhas na rotina de release não bloqueiam o fluxo principal, emitindo aviso descritivo.

## Behavior / States

### Máquina de Estados do Job de Orquestração

```
+------------+       dispatch()        +-------------+
|    IDLE    | ----------------------> |   QUEUED    |
+------------+                         +-------------+
                                              |
                                              | worker assume tarefa
                                              v
+------------+   timeout / cancel()    +-------------+
| CANCELLED  | <---------------------- |   RUNNING   |
+------------+                         +-------------+
                                              |
                       +----------------------+----------------------+
                       | worker conclui                              | worker falha / crash
                       v                                             v
               +---------------+                             +---------------+
               |   COMPLETED   |                             |    FAILED     |
               +---------------+                             +---------------+
                       |                                             |
                       +----------------------+----------------------+
                                              |
                                              | adapter.release()
                                              v
                                     +-----------------+
                                     |    RELEASED     | (worktree seguro para cleanup)
                                     +-----------------+
```

### Ciclo de Execução no Coordinator sob Orquestrador

```
Host (Coordinator)                      Orchestrator Adapter               Worker Remoto (Sandbox)
        |                                       |                                    |
        |--- 1. provisiona worktree local ----->|                                    |
        |--- 2. adapter.dispatch(input) ------->|--- inicia container/worker ------->|
        |                                       |<-- retorna jobId ------------------|
        |<-- retorna OrchestratorJobHandle -----|                                    |
        |                                       |                                    |
        |=== Loop de Polling (timeout <= 50s) ==|                                    |
        |--- 3. adapter.check(handle) --------->|--- consulta progresso ------------>|
        |<-- status: RUNNING / COMPLETED -------|<-- responde status ----------------|
        |                                       |                                    |
        |--- 4. sanitiza diffs locais --------->|                                    |
        |--- 5. executa testes locais no host ->| (host verification soberana)       |
        |--- 6. adapter.release(handle) ------->|--- encerra handles/locks --------->|
        |--- 7. safe-remove-worktree ---------->| (worktree removido limpo)          |
```

## Data

### Modelos de Configuração (`.claude/vetor/config.json`)

```json
{
  "delegation": {
    "preferredRuntime": "opencode",
    "orchestrator": {
      "preferred": "orca",
      "fallbackToNative": true,
      "maxPollTimeoutMs": 50000,
      "pollIntervalSeconds": 10,
      "custom": {
        "my-harness": {
          "dispatchTool": "mcp__myharness__run_job",
          "checkTool": "mcp__myharness__get_job",
          "releaseTool": "mcp__myharness__drop_job"
        }
      }
    }
  }
}
```

### Estrutura de Diretórios de Código

```
scripts/lib/orchestrator/
├── types.ts              // Interfaces, enums e tipos canônicos
├── registry.ts           // Gerenciador de registro, detecção e seleção
├── draft-sanitizer.ts    // Validador e sanitizador de rascunhos de código
└── adapters/
    ├── alethe.ts         // Adaptador dedicado para Alethe
    ├── orca.ts           // Adaptador dedicado para Orca
    └── generic-mcp.ts    // Adaptador genérico configurável
```

## Integrations / Dependencies

- **Módulo de Detecção MCP:** `scripts/lib/mcp.ts` para casamento estrito de segmentos (`matchesMcpServer`).
- **Referência de Disponibilidade:** `skills/shared/references/mcp-availability.md`.
- **Referência de Delegação:** `skills/shared/references/delegate-to-runtime.md` para documentação do modelo unificado.
- **Skill Coordinator:** `skills/coordinator/SKILL.md` e referências `issue-coordinator-dispatch.md` / `issue-coordinator-monitoring.md`.
- **Skill Now:** `skills/now/SKILL.md` e script `scripts/now-probe.ts`.
- **Gerenciador de Worktrees:** `scripts/vetor-checks.sh safe-remove-worktree`.

## Edge Cases

1. **Timeout do Transporte MCP na Checagem:** Se a chamada MCP de checagem estourar o timeout da camada de transporte do harness (ex: > 60s), a conexão pode ser abortada. *Mitigação:* O adapter impõe teto rígido de 50.000 ms (`safePollTimeoutMs <= 50000`).
2. **Falsos Positivos de Falhas de Testes no Sandbox:** O container do worker remoto frequentemente bloqueia subprocessos ou acusa ownership inválido no git, acusando testes vermelhos. *Mitigação:* O relatório do worker é estritamente informativo; a validação oficial ocorre no host principal.
3. **Handle de Arquivo Preso ("Device or Resource Busy"):** No Windows, processos em background do worker mantêm diretórios do worktree abertos, impedindo sua exclusão. *Mitigação:* O coordinator exige a execução comprovada de `adapter.release(handle)` antes de qualquer tentativa de deleção do worktree.
4. **Múltiplos Orquestradores Ativos sem Preferência:** Se tanto Alethe quanto Orca estiverem ativos na mesma sessão. *Mitigação:* Em sessão interativa, pergunta via `AskUserQuestion`. Em sessão headless, adota fallback determinístico para subagentes nativos.
5. **Rascunho com Encoding Inválido ou Crases Quebradas:** Workers de determinados modelos podem emitir sequências literais corrompidas. *Mitigação:* O `DraftSanitizer` detecta as anomalias e bloqueia o commit até que o coordinator saneie o diff.

## Error Handling

- **Falha no `dispatch`:** Se o orquestrador recusar o job (permissão, sobrecarga ou ferramenta inexistente), o coordinator marca o grupo como elegível para execução nativa imediata (fallback transparente).
- **Falha no `check`:** Se uma iteração de polling falhar por erro transiente de rede, o coordinator tolera até 3 falhas consecutivas antes de classificar o job como `failed`.
- **Falha no `release`:** Falhas na chamada de liberação são registradas em log de aviso, mas não impedem a continuação do pipeline de coordenação.

## Security / Privacy

- **Prompts Isolados:** Prompts autocontidos enviados ao orquestrador devem conter apenas os requisitos da issue e o código do projeto, sem tokens de autenticação ou credenciais de CI.
- **Sandboxing Restritivo:** Workers remotos não recebem tokens de acesso ao GitHub (`GITHUB_TOKEN`), sendo proibidos de interagir diretamente com a API do repositório remoto.
- **Soberania do Host:** Toda linha de código produzida por agentes externos é tratada como input não confiável até validação da suíte de testes e sanitização de texto no host.

## Rollout

- **Fase 1 (Core & Domínio):** Criação dos módulos `types.ts`, `registry.ts` e testes unitários com mocks.
- **Fase 2 (Adaptadores & Sanitizer):** Implementação de `AletheAdapter`, `OrcaAdapter` e `draft-sanitizer.ts`.
- **Fase 3 (Sondagem & Priming):** Atualização de `now-probe.ts` e `skills/now/SKILL.md`.
- **Fase 4 (Coordinator & Referências):** Atualização do fluxo de dispatch e monitoring do coordinator e atualização da documentação normativa em `delegate-to-runtime.md`.

## Open Questions

- *Nenhuma pendente no momento.* As decisões de isolamento por worktree, teto de 50s, release prévio obrigatório e validação no host foram consolidadas com base no Spike #451 e nas diretrizes da issue #482.

## Decisions

- **Decidido (mantenedor, 2026-10-22):** Generalizar o suporte a orquestradores para além do Alethe, contemplando explicitamente o Orca e novos servidores MCP via abstração de driver (`OrchestratorAdapter`).
- **Decidido:** Manter separadas as abstrações de delegação CLI (pipes síncronos) e de orquestração MCP (workers assíncronos em worktree).
- **Decidido:** Teto de 50 segundos em chamadas de polling MCP para prevenir estouro do transporte do harness.
- **Decidido:** Validação de testes soberana e obrigatória no host principal, nunca delegada ao sandbox do worker.
- **Decidido:** Invocação obrigatória de `release` antes de remover worktrees para evitar travamento de recursos no Windows/Linux.

## References

- Issue #482 — Abstração abrangente de runtimes de orquestração (Alethe, Orca e MCP).
- Issue #451 & Relatório: `docs/investigations/alethe-orchestrator-awareness-spike.md` — Spike de awareness de orquestradores MCP.
- Proposta: `docs/proposals/alethe-orchestrator-awareness-spike.md`.
- Issue #247 & Referência: `skills/shared/references/delegate-to-runtime.md` — Delegação assistida a runtimes externos.
- Referência de MCP: `skills/shared/references/mcp-availability.md`.
- Coordinator: `skills/coordinator/SKILL.md` e referências associadas.

## Revision History

| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-22 | /vetor:spec (pair programming) | Criação da Spec inicial para issue #482: abstração e interfaces polimórficas para runtimes orquestradores (Alethe, Orca e MCP). |
