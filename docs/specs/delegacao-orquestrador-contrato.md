---
id: spec:delegacao-orquestrador-contrato
type: spec
project: Vetor
status: draft
created: 2026-10-23
updated: 2026-10-23
---
# Contrato de delegação ao orquestrador MCP

## Summary

Completar o contrato de delegação externa do Vetor usando o Alethe MCP, corrigindo a documentação e seleção existentes e estabelecendo revisão automatizada de rascunhos. Esta Spec complementa `docs/specs/delegacao-runtimes-orquestradores.md` (issue #482, implementada no master) e cobre somente as lacunas restantes das issues #480, #481, #483 e #486.

## Context

- A Spec base já define a abstração geral de adapters e o ciclo dispatch/check/release em `docs/specs/delegacao-runtimes-orquestradores.md`; não se reespecificam aqui interfaces gerais nem runtimes CLI.
- A referência de delegação já possui a seção §6 com detecção por ferramentas e env, menções a Alethe, Orca e genérico, preferência e salvaguardas iniciais (`skills/shared/references/delegate-to-runtime.md:295-328`). Ela não documenta o contrato MCP real completo nem fontes por limite.
- A referência MCP lista orquestradores Alethe, Orca e custom sem evidência individual (`skills/shared/references/mcp-availability.md:127-130`), e lista namespaces inferidos na tabela (`skills/shared/references/mcp-availability.md:64`).
- A seleção atual aceita apenas candidatos detectados no PATH e testa preferência contra essa lista (`scripts/lib/delegation-runtime.ts:1-26`). O `/vetor:now` reporta dados de `orchestrators` baseados em variáveis de ambiente (`scripts/now-probe.ts:101-120`) e cita MCPs ativos, incluindo Orca/custom (`skills/now/SKILL.md:27-45`).
- O adapter Alethe já foi alinhado ao schema observado pelo coordenador (sonda real em 2026-10-23, job-67): `alethe_delegate` aceita `tasks`, `agent`, `cwd`, `isolate`, `label`, `askForApproval`, `timeoutSeconds`, `webSearch`; responde com `accepted`, `runId`, `runningInParallel`, `concurrencyLimit`, `isolated`, `timeoutSeconds`, `jobs` e `next`. `alethe_check` recebe `wait`, `timeoutMs`, `untilAllSettled`, é global à sessão e entrega cada resultado uma vez; `alethe_release`/`alethe_cancel` recebem `jobIds`.
- A sonda confirma limite observado de concorrência 4; sem `cwd`, usa o diretório do Alethe e `isolate: true` falha com `isolate needs a git repository` (sonda real em 2026-10-23, job-67). O `cwd` deve ser sempre passado.
- A biblioteca atual `scripts/lib/draft-sanitizer.ts:1-48` é sanitizador de texto, não scanner abrangente de diff/arquivos. A referência existente menciona bytes nulos, UTF-8, `` `n `` literal e `declare -A` (`skills/shared/references/delegate-to-runtime.md:321-328`).
- Variáveis do próprio processo observadas num worker Codex do Alethe em 2026-10-23: nenhum nome começando com `ALETHE` ou `ORCA`.
- Não foi confirmada fonte oficial nesta descoberta para um servidor Orca com ferramentas `task_dispatch`, `task_check`, `task_release`. O registro anterior de sua existência é insuficiente; requisitos que dependam dele permanecem abertos até confirmação oficial.

## Goals

- Documentar capacidades, detecção e limites reais do Alethe nas referências compartilhadas.
- Permitir que o chamador selecione Alethe como runtime MCP quando namespace estiver ativo e a preferência indicar Alethe.
- Fazer `/vetor:now` reportar o MCP detectado e preparar a delegação sem depender de sinais ambientais não verificados.
- Verificar rascunhos delegados com varredura confiável e reportável.
- Corrigir as afirmações sem fonte sobre Orca/env e registrar errata no spike sem reescrever seu histórico.

## Non-Goals

- Reimplementar a abstração geral de orquestradores descrita na Spec da issue #482.
- Alterar o adapter Alethe, já alinhado ao schema observado, salvo ajustes necessários descobertos ao satisfazer este contrato.
- Implementar detecção fora do harness baseada em variáveis sem evidência verificável.
- Dar suporte a Orca sem fonte oficial de servidor e schema.
- Fazer workers externos executarem testes, operações git/gh, rede ou alterações em arquivos de status.

## Users / Personas

- Mantenedor que usa Alethe MCP para delegar alterações em worktrees.
- Skills `/vetor:coordinator` e `/vetor:now`, que precisam instruções consistentes e observáveis.

## Functional Requirements

### RF-01 - Referências documentam o contrato Alethe

**Priority:** Must

**Description:** As referências de disponibilidade MCP e delegação documentam namespace, capacidades, schema e limites comprovados, separando detecção em sessão de sinais fora do harness.

**Acceptance Criteria:**

- [ ] `mcp-availability.md` e `delegate-to-runtime.md` descrevem detecção por `mcp__alethe__*` e apontam a disponibilidade estática por namespace.
- [ ] A referência de delegação descreve os argumentos e respostas de `alethe_delegate`, `alethe_check`, `alethe_release` e `alethe_cancel` conforme schema das ferramentas MCP/sonda real em 2026-10-23, job-67.
- [ ] Cada limite operacional documentado traz fonte e data: concorrência 4, `cwd` obrigatório, espera `timeoutMs <= 50000`, release antes de remoção e restrições do worker; fatos empíricos são rotulados como observados, não universais.
- [ ] Uma chamada `alethe_delegate` é feita por grupo/worktree; seu `cwd` é o worktree do grupo e é passado sempre. O texto da issue é incluído integralmente para produzir tarefa autocontida.
- [ ] Worker não executa git que escreva, `gh`, rede nem edita status file; testes e validação empírica rodam no host, pois sandbox Codex observado falha em git por `dubious ownership` (sonda/relato de 2026-10-21).
- [ ] A referência exige `alethe_release` antes de remover worktree (falha `Permission denied` observada no Windows em 2026-10-22) e trata a saída como rascunho sujeito a revisão e varredura de controles/mojibake.
- [ ] O contrato é coberto por `scripts/tests/delegate-to-runtime-contract_test.ts`.

### RF-02 - Seleção de runtime Alethe MCP

**Priority:** Must

**Description:** `selectDelegationRuntime` aceita runtime MCP fornecido pelo chamador, cuja disponibilidade foi detectada pela skill pelo namespace, sem exigir binário no PATH.

**Acceptance Criteria:**

- [ ] Com preferência `alethe` e disponibilidade MCP informada pelo chamador, a seleção retorna delegação para `alethe` sem busca de binário.
- [ ] Sem disponibilidade ou sem preferência aplicável, o comportamento não escolhe silenciosamente runtime externo não consentido.
- [ ] `scripts/tests/delegation-runtime_test.ts` cobre o caso Alethe disponível/preferido e os caminhos de indisponibilidade.

### RF-03 - Priming no `/vetor:now`

**Priority:** Must

**Description:** O passo de MCPs ativos reconhece o namespace Alethe e aplica as instruções de priming de delegação.

**Acceptance Criteria:**

- [ ] `skills/now/SKILL.md` cita Alethe quando `mcp__alethe__*` está ativo e orienta aplicar o contrato de delegação.
- [ ] O campo `orchestrators` de `now-probe.ts` não afirma detecção por env sem fonte verificável; a detecção in-harness pela skill continua baseada nas ferramentas MCP.
- [ ] Nenhum sinal verificável fora do harness foi encontrado: não se implementa sinal no probe até existir fonte citável.

### RF-04 - Varredura de rascunhos delegados

**Priority:** Must

**Description:** A revisão do diff do worker é apoiada por scanner que relata corrupções sem falhar silenciosamente. A solução pode estender `draft-sanitizer.ts` ou substituí-lo por ferramenta com interface de varredura; a escolha de produto/arquitetura está em Decisions/Open Questions.

**Acceptance Criteria:**

- [ ] A varredura cobre bytes de controle exceto TAB/LF/CR, BOM, mojibake (`Ã`, `â€`, U+FFFD), acento substituído por `?`, sequência literal `` `n ``, `declare -A` em `.sh` e remoção de bloco JSDoc em `.ts` comparada ao diff/base.
- [ ] Cada padrão tem caso positivo e negativo automatizado em `scripts/tests/`.
- [ ] Achados retornam código não-zero com arquivo e linha; resultado limpo retorna zero.
- [ ] Falha da ferramenta de locale/regra de busca nunca pode ser interpretada como scan limpo. Foi observado em 2026-10-23 que `LC_ALL=C grep -P` no Git Bash falhou com `supports only unibyte and UTF-8 locales` e, com stderr redirecionado, pareceu limpa.
- [ ] O contrato de delegação inclui a varredura como etapa obrigatória de revisão.

### RF-05 - Errata de evidência no spike

**Priority:** Must

**Description:** As cópias de investigação e proposta registram errata factual nas subseções §5.2.3–§5.2.5, sem reescrever o registro histórico.

**Acceptance Criteria:**

- [ ] Ambas as cópias indicam o schema real de Alethe, a observação de ausência de env no processo e que Orca permanece sem fonte oficial confirmada.
- [ ] A errata é aditiva e identifica explicitamente quais alegações anteriores eram hipótese, não fato verificado.

### RF-06 - Remoção de suporte Orca sem fonte

**Priority:** Must

**Description:** Não se mantém adapter, testes ou menções de Orca como capacidade suportada sem fonte oficial para servidor MCP e schema.

**Acceptance Criteria:**

- [ ] Se fonte oficial não for apresentada, remover `scripts/lib/orchestrator/adapters/orca.ts`, testes associados e menções de Orca em `skills/` e referências compartilhadas.
- [ ] Se fonte oficial for confirmada, manter cada adapter/variável que ficar acompanhado da fonte e data de confirmação.

### RF-07 - Decisão sobre Generic MCP

**Priority:** Should

**Description:** Resolver se o adapter genérico configurável permanece como extensão suportada.

**Acceptance Criteria:**

- [ ] Open Questions registra a decisão entre manter configuração via `delegation` em `.claude/vetor/config.json` ou remover `generic-mcp.ts`, testes e menções sem schema/configuração validada.

## Non-Functional Requirements

### RNF-01 - Evidência e falha explícita do scanner

**Priority:** Must

**Description:** Descoberta e varredura devem ser determinísticas e reportar falhas operacionais, sem falso resultado limpo por erro de locale ou supressão de stderr.

**Acceptance Criteria:**

- [ ] Testes comprovam saída zero apenas para arquivos limpos e saída não-zero para achados e falha interna; falhas incluem diagnóstico visível.
- [ ] Não há chamadas de rede nem execução de ferramenta MCP exploratória para determinar disponibilidade; usa-se namespace já fornecido pelo harness.

## Behavior / States

1. A skill identifica o MCP pelo namespace.
2. A seleção aplica `preferredRuntime: alethe` se disponível.
3. Cada grupo é despachado uma vez com worktree como `cwd`; resultados são recolhidos sem perder entregas globais de `alethe_check`.
4. O host revisa e escaneia os arquivos, roda testes e então libera job antes de limpar worktree.
5. Sem namespace Alethe, segue o fluxo nativo/inline existente.

## Data

- Preferência existente: `delegation.preferredRuntime` em `.claude/vetor/config.json`.
- Resultado do probe não deve ser tratado como fonte de presença do orquestrador sem sinal verificado.
- O adapter generic-mcp e o bloco `delegation.custom` saem (ver Decisions).

## Integrations / Dependencies

- `skills/shared/references/mcp-availability.md`, `skills/shared/references/delegate-to-runtime.md`.
- `scripts/lib/delegation-runtime.ts`, `scripts/now-probe.ts`, `skills/now/SKILL.md`.
- Alethe MCP e `scripts/lib/orchestrator/adapters/alethe.ts`.
- `scripts/lib/draft-sanitizer.ts` e testes em `scripts/tests/`.
- O scanner tem execução própria por CLI mínima; integração com `vetor-checks.sh` é opcional (ver Decisions).

## Edge Cases

- `cwd` ausente com isolamento: sempre deve ser passado o worktree; ausência pode fazer Alethe usar diretório próprio e falhar com `isolate needs a git repository` (observado em 2026-10-23).
- `alethe_check` consome entregas globalmente uma vez: adapter/coordenador deve preservar entrega destinada a outro job até seu tratamento.
- Limite de concorrência atingido: despachos respeitam `concurrencyLimit` observado 4 e aguardam vaga ou reportam saturação; estratégia de fila está ⚠️ ABERTO.
- Scanner falha por locale/encoding: resultado é erro explícito e bloqueia aprovação, nunca “limpo”.
- Namespace Alethe ausente e preferência Alethe configurada: não selecionar binário ou runtime diferente silenciosamente.

## Error Handling

- Erro de transporte ou rejeição de dispatch deve ser reportado ao coordenador, sem marcar rascunho como validado.
- Erro interno do scanner, encoding ilegível ou comparação de base indisponível produz diagnóstico não-zero e requer revisão manual.
- ⚠️ ABERTO: política de retry/fallback após falha de dispatch/check.

## Security / Privacy

- Workers recebem somente tarefa autocontida e contexto necessário do worktree; não recebem credenciais nem acesso de rede.
- Worker não executa git que escreva, `gh`, nem altera status file; host mantém controle de testes e operações de repositório.
- Resultados externos são conteúdo não confiável até revisão, varredura e validação no host.

## Rollout

⚠️ ABERTO: ordem e estratégia de rollout das mudanças documentais, seleção, scanner e errata.

## Open Questions

> Todas as perguntas abaixo foram decididas pelo mantenedor em 2026-10-23, seguindo a recomendação de cada uma; ver `## Decisions`.

1. Há fonte oficial verificável para Orca com servidor MCP e ferramentas `task_dispatch`, `task_check`, `task_release`? **Recomendação:** sem documentação oficial com schema, remover adapter/testes/menções.
2. `GenericMcpAdapter` deve permanecer configurável em `delegation` de `.claude/vetor/config.json` ou sair? Fato (2026-10-23): ele só é registrado a partir de `delegation.custom` (`scripts/lib/orchestrator/index.ts:28-36`) e nenhum config do repositório declara esse bloco. **Recomendação:** remover código, testes e menções, já que não há consumidor nem schema MCP validado.
3. O scanner deve estender `draft-sanitizer.ts` ou substituí-lo por CLI de diff? **Recomendação:** estender a biblioteca existente com entrada de arquivos/base diff e uma CLI mínima para evitar duplicar regras.
4. O que fazer quando `concurrencyLimit` varia por sessão apesar de valor observado 4? **Recomendação:** preferir o valor retornado pela ferramenta e tratar 4 apenas como observação datada.
5. A detecção por env deve ser removida de `now-probe.ts` e adapters até fonte do Alethe definir variáveis? **Recomendação:** sim; usar namespace MCP in-harness.

## Decisions

- A Spec da issue #482 é a base normativa; este documento trata somente deltas das issues #480, #481, #483 e #486.
- As variáveis ALETHE_ORCHESTRATOR e ALETHE_SESSION_ID e as variáveis ORCA_* do spike são hipóteses sem fonte verificável nesta descoberta. Observou-se zero nomes ALETHE/ORCA no processo worker Codex em 2026-10-23.
- Sem fonte oficial Orca, suporte permanece condicional e deve ser removido conforme RF-06.
- Recomenda-se estender `draft-sanitizer.ts` para scanner testável e explícito, sujeito à decisão de interface registrada acima.
- Os fatos do Alethe neste documento são observação da sonda real em 2026-10-23, job-67 ou schema das ferramentas MCP; não constituem garantias universais do serviço.

Decididas pelo mantenedor em 2026-10-23 (Open Questions):

- Orca: remover `scripts/lib/orchestrator/adapters/orca.ts`, os testes e as menções em `skills/` e nas referências, por falta de fonte oficial (pesquisa em 2026-10-23).
- Generic MCP: remover `generic-mcp.ts`, o registro via `delegation.custom` em `scripts/lib/orchestrator/index.ts`, os testes e as menções, por não haver consumidor nem schema validado.
- Varredura: estender `scripts/lib/draft-sanitizer.ts` e oferecer uma CLI mínima própria (arquivos ou base de diff), sem duplicar regras; integração com `vetor-checks.sh` é opcional.
- Concorrência: usar o `concurrencyLimit` retornado pelo `alethe_delegate`; o valor 4 é observação datada.
- Detecção: remover a detecção por variáveis de ambiente de `scripts/now-probe.ts` e de `AletheAdapter.isAvailable`; o Alethe é detectado só pelo namespace `mcp__alethe__*`.

## References

- `docs/specs/delegacao-runtimes-orquestradores.md` — Spec base da issue #482.
- `skills/shared/references/delegate-to-runtime.md` e `skills/shared/references/mcp-availability.md` — estado documental atual.
- `docs/investigations/alethe-orchestrator-awareness-spike.md` e `docs/proposals/alethe-orchestrator-awareness-spike.md` — histórico que requer errata.
- Evidência Alethe: sonda real em 2026-10-23, job-67; schema das ferramentas MCP.
- Observação de env: worker Codex do Alethe em 2026-10-23 (nenhum nome `ALETHE*` ou `ORCA*`).

## Revision History

| Data | Autor | Mudança |
|------|-------|---------|
| 2026-10-23 | Codex (via Alethe) | rascunho inicial gerado por /vetor:spec |
| 2026-10-23 | Claude Code (coordinator) | revisão: correções factuais e decisões do mantenedor nas Open Questions |

- Relacionado: specs/delegacao-runtimes-orquestradores.md
