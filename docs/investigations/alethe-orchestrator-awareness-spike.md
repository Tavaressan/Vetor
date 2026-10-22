# Spike #451: Awareness do MCP Orquestrador sob o qual o Harness roda (ex.: Alethe)

**Status:** Concluído (Spike de Investigação e Proposta Técnica)
**Data:** 2026-10-22
**Autor:** Issue Worker (#451)
**Issue de Referência:** #451 — `spike(delegation): awareness do MCP orquestrador sob o qual o harness roda (ex.: Alethe)`
**Decisão Proposta:** **APROVAR A INTEGRAÇÃO E O RECONHECIMENTO DE MCPs ORQUESTRADORES (Alethe)** como runtime de delegação de primeira classe no Vetor, estabelecendo contrato prático estrito de execução, polling seguro (`timeoutMs <= 50s`), validação de testes no host e checklist de sanitização de rascunhos.

---

## 1. Sumário Executivo

Historicamente, o Vetor foi concebido operando de forma autônoma ou sob harnesses de IA pontuais (Claude Code CLI, Google Antigravity/`agy`, OpenCode, Codex). Nesses cenários, a delegação de tarefas pesadas (para economia de contexto e tokens) foi modelada como chamadas a CLIs externos executados via subprocesso no PATH (`skills/shared/references/delegate-to-runtime.md`).

Entretanto, em sessões recentes (notadamente a sessão de dogfooding de **2026-10-21** no próprio repositório do Vetor), o harness Claude Code foi instanciado sob um **orquestrador multiplexador externo** (o **Alethe**). O Alethe injetou configurações MCP dinâmicas (`--mcp-config ...alethe-orchestrator-mcp-*.json`, `--mcp-config ...alethe-graphify-mcp-*.json` e `--settings ...alethe-agent-hooks-*.json`), expondo um conjunto de ferramentas MCP especializadas (`mcp__alethe__alethe_delegate`, `alethe_check`, `alethe_status`, `alethe_send`, `alethe_release`).

O Vetor operou completamente **cego ("unaware")** a essa infraestrutura circundante:
1. O comando `/vetor:now` não reportou o orquestrador ativo nem primou o agente para utilizá-lo;
2. O algoritmo de seleção de runtimes (`delegate-to-runtime.md`) apenas buscou binários estáticos no PATH (`agy`, `opencode`, `codex`), ignorando as capacidades MCP já conectadas;
3. A delegação só ocorreu após intervenção manual do usuário e exigiu contornos empíricos trabalhosos para evitar perda de dados, timeouts e falhas de concorrência.

Este relatório investiga e responde formalmente às **quatro perguntas essenciais do spike**, analisa as evidências empíricas colhidas na sessão de 2026-10-21, avalia as alternativas de desenho e apresenta um **plano detalhado com 4 issues derivadas** para tornar o Vetor consciente de orquestradores MCP com máxima segurança e estabilidade.

---

## 2. Pergunta 1: Sinais de Detecção Estáticos e Confiáveis

> **Pergunta:** *Quais são os sinais estáticos e confiáveis para detecção do orquestrador (segmento MCP `mcp__alethe__*`, argumentos de linha de comando do processo, variáveis de ambiente), mantendo conformidade com o princípio de `mcp-availability.md`?*

### 2.1 Evidências Analisadas

1. **Namespace de Ferramentas MCP (`mcp-availability.md` & `scripts/lib/mcp.ts`):**
   - O Vetor estabeleceu em `skills/shared/references/mcp-availability.md` e na Issue #336 que a verificação de ferramentas MCP é puramente **estática e baseada no namespace**: ferramentas de servidores MCP aparecem no formato `mcp__<server>__<tool>` ou empacotadas em plugins como `mcp__plugin_<plugin>_<server>__<tool>`.
   - Na sessão de 2026-10-21, as ferramentas injetadas pelo Alethe seguiram rigorosamente o padrão canônico standalone:
     - `mcp__alethe__alethe_delegate`
     - `mcp__alethe__alethe_check`
     - `mcp__alethe__alethe_status`
     - `mcp__alethe__alethe_send`
     - `mcp__alethe__alethe_release`
   - O utilitário `matchesMcpServer(tool, "alethe")` em `scripts/lib/mcp.ts` casa perfeitamente com `mcp__alethe__*` sem riscos de falso positivo por substring.
   - **Vantagem:** Totalmente desacoplado do sistema operacional, não gasta chamadas de comando shell, funciona identicamente em Windows, macOS e Linux, e não depende de permissões de processo.

2. **Argumentos de Inicialização do Processo (`--mcp-config`, `--settings`):**
   - Na sessão de 2026-10-21, o Claude Code foi iniciado pelo Alethe com argumentos de linha de comando:
     `--mcp-config ...alethe-orchestrator-mcp-*.json --mcp-config ...alethe-graphify-mcp-*.json --settings ...alethe-agent-hooks-*.json`.
   - Inspecionar a linha de comando do processo pai ou atual (via `Get-CimInstance Win32_Process` no Windows ou `ps aux` em POSIX) apresenta graves desvantagens:
     - Requer execução de comandos shell adicionais (desperdiçando turnos);
     - Sujeito a bloqueios de segurança do sandbox (como observado no sandbox do Codex que retornou `E_ACCESSDENIED`);
     - Arquivos apontados por essas flags são efêmeros e podem residir em diretórios temporários restritos.

3. **Variáveis de Ambiente (`ALETHE_*` ou `ORCHESTRATOR_*`):**
   - Orquestradores que instanciam o harness como subprocesso podem injetar variáveis de ambiente no processo-filho (ex.: `ALETHE_ORCHESTRATOR_ACTIVE=1`, `ALETHE_SESSION_ID=...`).
   - Leitura de variáveis de ambiente via `Deno.env.get()` é estática, instantânea (0ms), segura e compatível com scripts externos como `scripts/now-probe.ts`.
   - Contudo, variáveis de ambiente dependem da cooperação ativa do orquestrador e podem variar de versão para versão se não houver um padrão unificado.

### 2.2 Opções Avaliadas

| Opção | Custo de Turnos | Estabilidade / Sandbox | Alcance (In-Harness vs Script Externo) | Recomendado? |
|---|---|---|---|---|
| **A. Inspecionar Processos (`ps` / `wmic`)** | Alto (requer shell) | Frágil (bloqueios de permissão no sandbox) | Apenas scripts com acesso shell total | **Não** |
| **B. Apenas Variáveis de Ambiente** | Zero | Alta | Alto, mas dependente do orquestrador injetar env vars | **Apenas como suporte secundário** |
| **C. Segmento MCP no Namespace (`mcp-availability.md`)** | Zero | Absoluta (leitura estática da lista de tools) | Exclusivo in-harness (acessível pelo prompt e skills) | **Sim (Fonte Primária In-Harness)** |
| **D. Arquitetura em Duas Camadas (Tiered Detection)** | Zero | Absoluta | Cobre tanto o LLM in-harness quanto o `now-probe.ts` local | **Sim (Recomendação Final)** |

### 2.3 Recomendação para a Pergunta 1

Adotar a **Arquitetura em Duas Camadas (Tiered Detection)**:
1. **Camada Primária In-Harness (Canônica para Skills e Agentes):**
   - O sinal soberano e definitivo de presença do orquestrador é a existência da ferramenta `mcp__alethe__alethe_delegate` no namespace do agente (através de `mcp-availability.md` e `hasMcpServer(tools, "alethe")`).
   - Se a ferramenta estiver presente na lista de ferramentas (ativas ou diferidas), o orquestrador está disponível. Não requer execução de shell nem tentativa-e-erro em runtime.
2. **Camada Secundária Out-of-Harness (Para scripts locais como `now-probe.ts`):**
   - Como o `now-probe.ts` roda no terminal fora do contexto de ferramentas do Claude, ele verifica:
     1. Existência de variáveis de ambiente conhecidas (`ALETHE_ORCHESTRATOR`, `ALETHE_SESSION_ID`, `ORCHESTRATOR_TYPE`);
     2. Arquivo de configuração de projeto `.mcp.json` ou arquivo de perfil local.
   - Em seguida, a skill `skills/now/SKILL.md` (no passo 2) funde a sondagem do script com as ferramentas ativas da sessão do harness, reportando o Alethe com precisão total.

---

## 3. Pergunta 2: Capacidades e Limitações a Modelar

> **Pergunta:** *Quais capacidades e limitações do orquestrador devem ser modeladas (agentes disponíveis, cwd/isolate, aprovações, headroom por vendor/fitness, limites de timeout de espera)?*

### 3.1 Evidências Analisadas (Incidente de 2026-10-21)

A sessão de dogfooding de 2026-10-21 forneceu um conjunto valioso de dados empíricos sobre o comportamento real do orquestrador Alethe e de seus workers subjacentes:

1. **Escopo Global do `cwd` em `alethe_delegate`:**
   - Evidência: A chamada `alethe_delegate` aplica o parâmetro `cwd` a toda a invocação da delegação.
   - Impacto: Não é possível delegar múltiplos jobs com `cwd` distintos em uma única chamada. Se o coordinator despachar duas issues com worktrees diferentes em lote, ambas compartilhariam o mesmo diretório, quebrando o isolamento do `guard.ts` e contaminando as árvores git.
   - **Exigência:** É mandatório despachar **uma chamada por grupo/worktree**.

2. **Sandbox Restritivo do Codex (Bloqueio de Git e Bash):**
   - Evidência: Quando o Alethe direcionou tarefas para workers no Codex:
     - O git falhou repetidamente com erro `"fatal: detected dubious ownership in repository at ..."` (o usuário dentro do contêiner possui UID diferente do host Windows);
     - Comandos shell/bash falharam com `E_ACCESSDENIED`;
     - Os workers relataram até **35 falhas** na suíte de testes `deno task test`. No entanto, quando o coordinator executou a mesmíssima suíte fora do sandbox no host, **todos os 413 a 420 testes passaram limpos**.
     - Testes de flags do `worktree-create` (como `--carry-changes`) nunca puderam ser executados no sandbox.
   - **Exigência:** O código gerado por workers em sandbox deve ser tratado estritamente como **rascunho de código-fonte**. Workers não devem executar git/gh nem ter a responsabilidade final de homologar a suíte de testes.

3. **Timeout Crítico de Chamadas MCP (`timeoutMs` >= 90s vs 50s):**
   - Evidência: A ferramenta `alethe_check` com espera `>= 90s` estourou o timeout de transporte do cliente MCP do Claude Code. Duas entregas completas foram perdidas na conexão e tiveram que ser mineradas manualmente no dump bruto de `alethe_status` (~300.000 caracteres).
   - Quando o parâmetro de espera foi ajustado para **50s**, a comunicação ocorreu sem nenhuma falha de transporte.
   - **Exigência:** Polling no orquestrador deve impor um teto rígido de **50 segundos por chamada** (`timeoutMs <= 50000`).

4. **Defeitos Sintáticos e de Formatação Observados na Revisão:**
   - Evidência: O rascunho produzido pelo Codex exigiu correção de anomalias graves:
     - Bytes de controle crus inseridos no fluxo de texto;
     - Acentuação corrompida em português (falhas de conversão UTF-8);
     - Crase e quebras de linha literais emitidas como a sequência `` `n `` em arquivos Markdown;
     - Remoção indevida de documentação e blocos JSDoc pré-existentes;
     - Alucinações faktuais sobre a documentação da wiki do Cursor;
     - Introdução de `declare -A` (arrays associativos do Bash 4, incompatíveis com macOS e ambientes POSIX).

5. **Specs Geradas sem Frontmatter:**
   - Evidência: As especificações técnicas delegadas diretamente ao worker do orquestrador saíram sem o cabeçalho YAML obrigatório, violando as convenções do `scripts/lib/knowledge-docs.ts` e do `skills/spec/SKILL.md`.

6. **Bloqueio de Recursos ("Device or Resource Busy"):**
   - Evidência: O worktree `cli-node-runtime`, utilizado como `cwd` para jobs do Alethe, permaneceu travado com erro de sistema operacional "Device or resource busy" até o final da sessão.
   - Causa raiz: Processos em background do orquestrador mantiveram handles de arquivo abertos no worktree porque `alethe_release` não foi invocado antes da tentativa de deleção/cleanup do worktree.

### 3.2 Opções Avaliadas

- **Opção 1: Tratar o Orquestrador como um Subagente Claude Comum:**
  *Inviável.* O orquestrador não se comporta como um subagente nativo Claude: possui sandbox externo, timeouts específicos de transporte MCP e falhas de encoding peculiares ao Codex.
- **Opção 2: Bloquear Delegação para o Orquestrador devido aos Defeitos:**
  *Subótimo.* A economia de tokens do harness principal com delegação ao Alethe é expressiva. Descartar o recurso por causa de falhas contornáveis representaria perda de eficiência.
- **Opção 3: Modelar Capacidades com Guardrails e Sanitização Estrita:**
  *Recomendado.* Tratar o orquestrador como gerador de rascunhos assíncrono, impondo timeout de 50s, polling controlado, validação de suítes de teste no coordinator e checklist prévio de sanitização.

### 3.3 Recomendação para a Pergunta 2

Modelar explicitamente no Vetor as seguintes capacidades e restrições:
1. **Perfil de Runtimes/Agentes do Orquestrador:** Modelar se o destino é Codex (rápido, código isolado, sandbox agressivo) ou Claude (fiel a convenções e formatação de texto).
2. **Restrição de CWD Único por Chamada:** Proibir despacho de múltiplos worktrees em uma única chamada de `alethe_delegate`.
3. **Gerenciamento de Timeouts de Polling:** Teto estrito de `timeoutMs <= 50000` (50s) em `alethe_check`.
4. **Ciclo de Vida de Recursos:** Chamada obrigatória a `alethe_release(job_id)` antes de qualquer limpeza de worktree via `safe-remove-worktree`.
5. **Matriz de Capacidades do Worker Delegado:**
   - Git no worker: **Proibido** (dubious ownership no sandbox);
   - GitHub CLI no worker: **Proibido**;
   - Suíte de testes no worker: **Informativa/Opcional** (nunca bloqueante);
   - Validação da suíte de testes: **Exclusiva do Coordinator no Host**.

---

## 4. Pergunta 3: Encaixe no `delegate-to-runtime.md`

> **Pergunta:** *Como o orquestrador MCP se encaixa no `delegate-to-runtime.md` (como tipo de runtime no algoritmo de seleção §2) e qual é o seu contrato prático de execução?*

### 4.1 Evidências e Análise

Atualmente, `skills/shared/references/delegate-to-runtime.md` define:
- **Detecção §1:** `command -v agy`, `command -v opencode`, `command -v codex`;
- **Algoritmo de Seleção §2:** Avalia `available` (lista de CLIs no PATH) contra `preferred` (`delegation.preferredRuntime` de `.claude/vetor/config.json`);
- **Contrato §3 a §5:** Focado em comandos de pipe shell: `<producer> | $DELEGATE "<prompt>"`.

Esse desenho não acomoda nativamente um orquestrador MCP, que não é um binário de linha de comando no PATH, mas sim um conjunto de ferramentas MCP disponíveis em memória na sessão.

### 4.2 Opções Avaliadas

- **Opção A: Criar um wrapper CLI fictício `alethe` no PATH:**
  Exigiria criar um script shell ou binário para simular uma CLI. Frágil, desnecessário e polui o ambiente do usuário.
- **Opção B: Criar um documento de referência completamente separado (`delegate-to-orchestrator.md`):**
  Duplicaria as convenções de acordo de escopo (§2.1), fallback inline (§3) e validação de rascunhos. Fragmentaria a experiência.
- **Opção C: Generalizar `delegate-to-runtime.md` com Runtimes MCP de Primeira Classe:**
  *Recomendado.* O algoritmo de seleção §2 passa a suportar dois tipos de backend: `cli` (`agy`, `opencode`, `codex`) e `mcp` (`alethe`). Se `alethe` estiver ativo no namespace e configurado como preferido (ou se for o único mecanismo de delegação presente), é selecionado diretamente.

### 4.3 Recomendação para a Pergunta 3: O Contrato Prático de Delegação ao Orquestrador

Formalizar no `delegate-to-runtime.md` o **Contrato Prático de Delegação ao Orquestrador**, composto por 8 regras canônicas:

1. **Uma Chamada por Grupo (`one-call-per-group`):**
   O coordinator invoca `mcp__alethe__alethe_delegate` uma única vez para cada grupo de issues, fixando o parâmetro `cwd` no path absoluto do worktree específico do grupo. Nunca agrupe worktrees distintos em uma única requisição.

2. **Prompt Autocontido e Texto Integral (`self-contained-prompt`):**
   Como o worker remoto opera em sandbox isolado sem acesso ao terminal nem ao histórico da conversa, o prompt deve embutir o corpo completo da Lead Issue e Sequentials, critérios de aceite, comandos de teste extraídos do `module-test-map.md` e regras de integridade de código.

3. **Proibição Absoluta de Comandos Git e GitHub no Worker:**
   O prompt enviado ao worker deve proibir explicitamente comandos de gerenciamento de versão (`git checkout`, `git add`, `git commit`, `git push`, `gh pr create`). O worker deve atuar estritamente na edição e criação de arquivos no filesystem do seu worktree.

4. **Validação de Suíte de Testes no Host pelo Coordinator:**
   Relatórios de testes emitidos pelo worker do orquestrador não são confiáveis (sujeitos a falsos positivos por restrições de permissão ou falha de subprocessos no sandbox). O coordinator do Vetor no host principal é o único árbitro da qualidade: ele executa localmente a suíte de testes mapeada assim que o rascunho for entregue.

5. **Polling com Limite Rigoroso de Espera (`timeoutMs <= 50000`):**
   Ao monitorar a execução via `mcp__alethe__alethe_check`, nunca solicitar espera superior a 50 segundos. Se o job continuar em processamento, realize chamadas subsequentes em loop com pausas curtas, eliminando o risco de timeout de transporte da conexão MCP.

6. **Liberação Prévia de Recursos (`release-before-cleanup`):**
   Antes de executar a desmontagem ou deleção do worktree (`git worktree remove` ou `safe-remove-worktree`), o coordinator **deve obrigatoriamente** invocar `mcp__alethe__alethe_release(job_id)`. Isso libera handles de arquivos e locks no sistema operacional, prevenindo o erro "Device or resource busy".

7. **Checklist Rigoroso de Revisão e Sanitização de Rascunhos:**
   Antes de consolidar o código gerado pelo orquestrador em commits locais, o coordinator aplica uma inspeção focada nos defeitos empíricos conhecidos:
   - [ ] **Encoding e UTF-8:** Ausência de caracteres nulos, ANSI crus e acentuação corrompida em arquivos de texto e documentação;
   - [ ] **Formatação Markdown:** Ausência de crases literais `` `n `` ou escapes corrompidos;
   - [ ] **Preservação de Documentação:** Garantia de que comentários JSDoc e docstrings não foram removidos;
   - [ ] **Portabilidade de Shell:** Ausência de bashismos restritos como `declare -A` em scripts que exigem suporte a POSIX ou Bash 3.2;
   - [ ] **Veracidade de Fatos:** Conferência de que afirmações técnicas não foram alucinadas sem fontes do projeto ou Context7.

8. **Specs Geradas via `create-spec`:**
   Quando a tarefa delegada for a criação de uma especificação técnica (`/vetor:spec`), o worker não deve emitir Markdown solto. O coordinator deve fornecer a estrutura com o frontmatter YAML padronizado ou processar a saída via `scripts/lib/knowledge-docs.ts create-spec`.

---

## 5. Pergunta 4: Integração com `/vetor:now` e `/vetor:coordinator`

> **Pergunta:** *O que reportar e primar na skill `now` e como documentar e executar o dispatch da Fase 4 no `coordinator` quando sob o orquestrador?*

### 5.1 No `/vetor:now` (Probe, Sumário e Priming)

#### 5.1.1 Sondagem (`scripts/now-probe.ts`)
- Atualmente, o script lê apenas `.mcp.json` na raiz do repositório para preencher `mcps: string[]`, além de varrer binários no PATH (`agy`, `codex`, `opencode`).
- **Aprimoramento:**
  - Adicionar no retorno de `probeNow` um campo `orchestrators: Record<string, boolean>` que verifica a presença de variáveis de ambiente do orquestrador (ex.: `ALETHE_ORCHESTRATOR`, `ALETHE_SESSION_ID`).
  - Manter a execução do script leve e com zero dependências externas.

#### 5.1.2 Rotina da Skill (`skills/now/SKILL.md`)
- **Passo 2 (MCPs Ativos):**
  A skill complementa a saída do script com as ferramentas ativas na sessão via `mcp-availability.md`. Incluir verificação explícita:
  ```ts
  const hasAlethe = hasMcpServer(availableTools, "alethe");
  ```
- **Passo 3 (Sumário Executivo):**
  Se o orquestrador Alethe estiver ativo, exibir no sumário executivo:
  ```markdown
  - Orquestrador: Alethe detectado (ferramentas de delegação `mcp__alethe__*` ativas)
  ```
- **Passo 4 (Priming):**
  Condicionado à presença de `mcp__alethe__*`:
  > **Orquestrador Alethe disponível:** Delegação assíncrona de workers ativada via MCP conforme `../shared/references/delegate-to-runtime.md`. Despachos paralelos do coordinator podem utilizar o backend Alethe para conservação de contexto.

---

### 5.2 No `/vetor:coordinator` (Planejamento, Dispatch e Ciclo de Vida)

#### 5.2.1 Fase 2 — Apresentação do Plano de Dispatch
Na tabela do plano de dispatch da Fase 2, indicar quando a execução de uma onda ou grupo utilizará o orquestrador:

| Grupo / Lead Issue | Onda | Modelo / Backend | Ação |
|---|---|---|---|
| Grupo #451 (Spike Awareness) | O_1 | `Alethe (Codex)` | Despachar via Orquestrador |
| Grupo #452 (Backlog Labels) | O_1 | `Claude (Sonnet)` | Despachar Nativo |

#### 5.2.2 Fase 3 — Criação de Worktrees
- O coordinator provisiona o worktree normalmente via `/vetor:worktree-create` (lembrando que o Passo 5 `EnterWorktree` é omitido para o coordinator, que permanece operando a partir do root do repositório).
- O status file em `.claude/vetor/status/<branch>.md` é criado com `Status: RUNNING` e anotação do backend (`Backend: Alethe`).

#### 5.2.3 Fase 4 — Dispatch via Orquestrador
Em vez de invocar o subagente nativo `vetor:issue-worker` via Claude Code `Agent()`, o coordinator executa:

```typescript
// 1. Despacha o worker no worktree isolado
const delegateResult = await callTool("mcp__alethe__alethe_delegate", {
  prompt: buildSelfContainedPrompt(group, worktreePath),
  cwd: worktreePath,
  // opções adicionais de backend se aplicável
});

const jobId = delegateResult.job_id;
```

#### 5.2.4 Fase 5 — Monitoramento com Polling Seguro
No loop de monitoramento da Fase 5:

```typescript
// Loop de checagem com timeout seguro <= 50s
while (!jobFinished) {
  const checkResult = await callTool("mcp__alethe__alethe_check", {
    job_id: jobId,
    timeoutMs: 50000 // Teto estrito de 50s para evitar timeout do transporte MCP
  });

  if (checkResult.status === "completed") {
    jobFinished = true;
    break;
  }
  // Pausa breve entre checagens se timeoutMs retornou sem conclusão
}
```

#### 5.2.5 Fase 6 & 7 — Sanitização, Testes e Liberação de Recursos
1. **Inspeção de Rascunho:** Executa o checklist de sanitização (UTF-8, escapes, JSDoc, bashismos);
2. **Execução de Testes no Host:** O coordinator roda `deno test` ou a suíte correspondente no worktree;
3. **Liberação Obrigatória de Recursos:** Invoca `mcp__alethe__alethe_release({ job_id: jobId })`;
4. **Atualização de Status:** Marca `GREEN (ready for ship)` no status file.

---

## 6. Recomendação de Desenho Global

A arquitetura recomendada preserva integralmente o princípio de independência do Vetor:
- **Zero Lock-in:** O Vetor continua funcionando perfeitamente sem nenhum orquestrador MCP (usando subagentes nativos do Claude Code ou CLIs locais via PATH);
- **Transparência e Compatibilidade:** O reconhecimento do Alethe é adicionado como uma extensão natural de `mcp-availability.md` e `delegate-to-runtime.md`, sem quebrar a assinatura existente de nenhuma ferramenta;
- **Defesa em Profundidade:** A assunção de que todo código gerado por workers remotos é rascunho não confiável garante que limitações do sandbox do Codex nunca comprometam a estabilidade do repositório nem introduzam regressões.

---

## 7. Issues de Implementação Derivadas

Para transformar as recomendações deste spike em código e documentação funcionais no Vetor, detalham-se abaixo as 4 issues técnicas recomendadas:

### Issue 1: `feat(delegation): formalizar orquestradores MCP como runtime de primeira classe em delegate-to-runtime.md`
- **Tipo:** `enhancement` (documentação / arquitetura)
- **Módulos Afetados:** `skills/shared/references/delegate-to-runtime.md`, `skills/shared/references/mcp-availability.md`
- **Escopo do Trabalho:**
  1. Atualizar `skills/shared/references/mcp-availability.md` para incluir a seção `Orquestrador MCP (Alethe)`, documentando as ferramentas canônicas (`mcp__alethe__*`).
  2. Atualizar `skills/shared/references/delegate-to-runtime.md`:
     - Expandir §1 para documentar runtimes do tipo MCP Orchestrator em paridade com CLIs locais;
     - Atualizar o algoritmo de seleção §2 para aceitar `"alethe"` em `delegation.preferredRuntime`;
     - Incorporar a seção "Contrato Prático de Delegação ao Orquestrador" com as 8 regras canônicas (one-call-per-group, prompts autocontidos, proibir git/gh no sandbox, validação no host, timeoutMs <= 50s, liberação prévia com alethe_release, checklist de sanitização, Specs padronizadas).
- **Critérios de Aceite:**
  - [ ] Referências documentam explicitamente as ferramentas e restrições do Alethe.
  - [ ] Contrato de 8 regras registrado e linkável.
  - [ ] Testes de contrato existentes em `scripts/tests/delegate-to-runtime-contract_test.ts` atualizados e verdes.

### Issue 2: `feat(delegation): suporte a runtimes MCP no algoritmo de seleção e probe do now`
- **Tipo:** `enhancement` (código)
- **Módulos Afetados:** `scripts/lib/delegation-runtime.ts`, `scripts/now-probe.ts`, `skills/now/SKILL.md`, `scripts/tests/delegation-runtime_test.ts`, `scripts/tests/now-probe_test.ts`
- **Escopo do Trabalho:**
  1. Estender `selectDelegationRuntime` em `scripts/lib/delegation-runtime.ts` para suportar tipos de runtimes MCP sem exigir que residam no PATH.
  2. Adicionar detecção de variáveis de ambiente do orquestrador em `scripts/now-probe.ts`.
  3. Atualizar `skills/now/SKILL.md` para sondar `hasMcpServer(tools, "alethe")`, emitir o sumário com o orquestrador ativo e aplicar o priming de delegação.
  4. Cobrir com testes unitários em `delegation-runtime_test.ts` e `now-probe_test.ts`.
- **Critérios de Aceite:**
  - [ ] `selectDelegationRuntime` seleciona `"alethe"` quando disponível e configurado como preferido.
  - [ ] `now-probe.ts` e `/vetor:now` reportam orquestrador ativo.
  - [ ] Suíte de testes Deno passa 100% verde.

### Issue 3: `feat(coordinator): despacho e monitoramento de workers via MCP Orchestrator (Alethe)`
- **Tipo:** `enhancement` (skills / coordenação)
- **Módulos Afetados:** `skills/coordinator/SKILL.md`, `skills/shared/references/issue-coordinator-dispatch.md`, `skills/shared/references/issue-coordinator-monitoring.md`
- **Escopo do Trabalho:**
  1. Documentar na Fase 2 e Fase 4 do `coordinator` o fluxo de despacho via `mcp__alethe__alethe_delegate`.
  2. Impor a regra de uma chamada por grupo com `cwd` isolado no worktree correspondente.
  3. Formalizar na Fase 5 o loop de polling seguro com `timeoutMs <= 50000` (50s) via `mcp__alethe__alethe_check`.
  4. Garantir a chamada de `mcp__alethe__alethe_release` antes de invocar a limpeza de worktrees.
  5. Atualizar as instruções para que o coordinator execute a validação de testes no host após o retorno do rascunho.
- **Critérios de Aceite:**
  - [ ] `skills/coordinator/SKILL.md` e suas referências contêm o fluxo completo de delegação ao orquestrador.
  - [ ] Polling seguro de 50s documentado explicitamente.
  - [ ] Liberação obrigatória de jobs documentada antes do cleanup de worktrees.

### Issue 4: `feat(delegation): checklist automatizado e sanitizador de rascunhos de runtimes externos`
- **Tipo:** `enhancement` (tooling / qualidade)
- **Módulos Afetados:** `scripts/lib/draft-sanitizer.ts` (novo), `scripts/tests/draft-sanitizer_test.ts` (novo)
- **Escopo do Trabalho:**
  1. Implementar rotina de inspeção para escanear diffs e arquivos gerados por runtimes externos/sandboxed:
     - Detecção de caracteres de controle crus e corrupção UTF-8;
     - Detecção de crases literais `` `n ``;
     - Detecção de remoção de blocos JSDoc em arquivos typescript;
     - Detecção de `declare -A` em scripts de shell.
  2. Integrar a checagem no fluxo de validação pré-commit de workers delegados.
- **Critérios de Aceite:**
  - [ ] Utilitário detecta os 4 padrões empíricos de anomalia observados na sessão de 2026-10-21.
  - [ ] Testes unitários cobrindo casos positivos e negativos.

---

## 8. Conclusão

A investigação da Issue #451 demonstra que a falta de awareness do orquestrador MCP no Vetor resultava em desperdício de capacidades operacionais e risco de instabilidade decorrente de improvisações em tempo de execução. A modelagem do Alethe como um runtime MCP de primeira classe, associada a regras canônicas de isolamento de diretório, polling seguro de 50s, liberação estrita de recursos e verificação soberana no host, transforma um ponto de atrito em um canal robusto de economia de escala para o Vetor.
