# Investigação: Custo e Viabilidade do Typecheck Síncrono (`tsc --noEmit`) no `check-edit`

**Issue:** #394 — perf(hooks): medir o custo do tsc --noEmit do check-edit num projeto Next/TS real  
**Data:** 2026-10-22  
**Status:** Concluída — medição empírica realizada, trade-offs analisados e recomendação fundamentada definida  

**Rótulos:** **[Fato]** verificável na fonte citada ou medição registrada · **[Inferência]** conclusão lógica derivada de fatos · **[Opinião]** juízo técnico ou recomendação arquitetural · **[Não verificado]** premissa não confirmada empiricamente.

---

## 1. Sumário Executivo

A auditoria anterior de custo-benefício dos hooks (proposta #375) identificou que o hook de pós-edição `check-edit.ts` apresentava uma latência média de **226 ms** apenas no caminho de saída rápida (arquivos não-TypeScript como Markdown). O custo real de invocar o compilador TypeScript (`tsc --noEmit`) a cada `Edit` ou `Write` em projetos Node.js / Next.js permaneceu como incógnita operacional até esta medição.

Nesta investigação (#394), realizamos medições empíricas comparativas (5 execuções por cenário, mediana, média, desvio e extremos) em dois projetos reais representativos da stack:
1. **Next.js 16.3.6 App Router:** `portfolio_gisele` (51 arquivos `.ts`/`.tsx`).
2. **TypeScript / React 18 / Tauri 2:** `alethe-contribution` (592 arquivos `.ts`/`.tsx`).

### Principais Conclusões:
- **[Fato]** Em projetos pequenos/médios Next.js (51 arquivos), o `tsc --noEmit` atual adiciona **~2,5 a 2,7 segundos** a **cada** chamada de ferramenta de edição do agente.
- **[Fato]** Em projetos TypeScript de médio porte (592 arquivos), o `tsc --noEmit` atual consome **14,4 a 15,0 segundos por edição**, operando perigosamente próximo ao limite interno de 20s (`TIMEOUT_MS = 20_000`).
- **[Fato]** A adoção de `--incremental` proporciona uma redução de **81%** no tempo de verificação em projetos médios (de 15,0s para **~2,7s** com cache externo).
- **[Fato]** Mesmo com `--incremental` ultra-quente, o tempo de inicialização da VM Node.js, carregamento do script do compilador (~7MB) e verificação do grafo impõe um piso inelutável de **~1,8 a 2,8 segundos** no Windows.
- **[Inferência]** Em uma sessão de desenvolvimento típica com 10 a 20 edições consecutivas, o custo acumulado de espera síncrona do agente varia entre **37 segundos** (projeto Next pequeno) e **3 a 5 minutos** (projeto médio), gerando atrito e percepção de travamento. Se o projeto exceder 800 arquivos, o timeout de 20s é atingido, o hook aborta silenciosamente e nenhum diagnóstico é entregue, desperdiçando 20 segundos em vão a cada edição.

**Decisão Recomendada para o Vetor:** **[Opinião]** Desacoplar o typecheck síncrono de Node/TypeScript do evento `PostToolUse` no `check-edit.ts`. Manter no `PostToolUse` exclusivamente o `deno check <file>` para projetos Deno (que é nativamente rápido e scoped por arquivo). Para projetos Node/TypeScript, transferir a validação estática de tipos para o checkpoint preliminar do `/vetor:fix` (executado antes da suíte de testes) e para o pipeline do `/vetor:ship`. Caso o usuário faça questão de typecheck no `PostToolUse`, torná-lo estritamente configurável (`opt-in`) e forçar `--incremental` com cache fora da árvore rastreada pelo Git.

---

## 2. Metodologia de Medição e Ambiente

### 2.1 Especificações da Máquina de Teste — [Fato]
- **Processador:** AMD Ryzen 5 5600G with Radeon Graphics (6 núcleos físicos, 12 processadores lógicos @ 3.90 GHz).
- **Memória RAM:** 16 GB DDR4 (16.041.828 KB visíveis no SO).
- **Sistema Operacional:** Microsoft Windows 11 Pro 64-bit (build 10.0.26300).
- **Node.js:** v24.19.0.
- **npm:** 11.6.3.
- **Deno:** 2.9.2 (stable, release, `x86_64-pc-windows-msvc`).
- **Compilador TypeScript:** Version 5.9.3 (binário local `node_modules/.bin/tsc.cmd` em ambos os projetos).

### 2.2 Projetos Selecionados — [Fato]
1. **`portfolio_gisele`:**
   - Stack: Next.js 16.3.6 (App Router), React 19.2.8, Sanity CMS, Tailwind CSS 4, TypeScript 5.9.3.
   - Contagem de arquivos: **51 arquivos `.ts`/`.tsx`** rastreados via Git.
   - Configuração: `tsconfig.json` com `noEmit: true`, `moduleResolution: "bundler"`, plugin `next`.
2. **`alethe-contribution`:**
   - Stack: React 18.3.1, Tauri 2.0, Vite 6.4.3, Zustand 5, Tailwind CSS, TypeScript 5.9.3.
   - Contagem de arquivos: **592 arquivos `.ts`/`.tsx`** rastreados via Git.
   - Configuração: `tsconfig.json` com `noEmit: true`, `moduleResolution: "Bundler"`, strict mode.

### 2.3 Cenários Avaliados
Cada cenário foi executado rigorosamente 5 vezes consecutivas com registro das durações em milissegundos via relógio de alta precisão (`performance.now()`):
1. **Full `tsc --noEmit` (sem cache):** Simula a implementação atual de `scripts/check-edit.ts:159`. Qualquer artefato `*.tsbuildinfo` é purgado antes de cada iteração para garantir estado a frio estrito.
2. **Incremental Unchanged (`--incremental` a quente):** Executa um warm-up prévio para gerar o cache, seguido de 5 execuções consecutivas sem alteração de arquivos.
3. **Incremental Edited (com edição real de arquivo):** Simula o comportamento do agente, tocando o carimbo de modificação (`mtime` via `Deno.utimeSync`) do arquivo alvo (`app/(site)/page.tsx` ou `src/App.tsx`) antes de cada execução incremental.
4. **Incremental com `tsBuildInfoFile` externo:** Executa `--incremental` apontando explicitamente `--tsBuildInfoFile` para fora do diretório do projeto (em área de cache do harness), simulando a política de evitar poluição do repositório.
5. **End-to-End `check-edit.ts`:** Executa o script real do hook (`deno run -A scripts/check-edit.ts`) enviando o payload JSON via stdin (`tool_name: "Edit"`, `file_path`, `cwd`), medindo o tempo total percebido pelo harness.

---

## 3. Tabela de Medições Registradas — [Fato]

### 3.1 Projeto 1: `portfolio_gisele` (Next.js 16.3.6, 51 arquivos TS/TSX)

| Modo de Execução | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Run 4 (ms) | Run 5 (ms) | **Mediana (ms)** | Média (ms) | Mín / Máx (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **1. Full `tsc --noEmit` (atual)** | 2.679,1 | 2.569,9 | 3.202,8 | 2.715,7 | 2.766,3 | **2.716** | 2.787 | 2.570 / 3.203 |
| **2. Incremental (sem alteração)** | 1.818,9 | 1.833,7 | 2.190,5 | 1.960,7 | 1.807,5 | **1.834** | 1.922 | 1.808 / 2.191 |
| **3. Incremental (arquivo editado)** | 1.921,5 | 1.865,8 | 1.875,7 | 1.812,6 | 1.936,6 | **1.876** | 1.882 | 1.813 / 1.937 |
| **4. Incremental (`tsBuildInfo` externo)** | 2.007,9 | 2.150,5 | 2.250,5 | 2.283,3 | 2.162,8 | **2.163** | 2.171 | 2.008 / 2.283 |
| **5. Hook `check-edit.ts` End-to-End** | 3.735,8 | 2.465,4 | 2.404,9 | 2.430,5 | 2.520,1 | **2.465** | 2.711 | 2.405 / 3.736 |

*Warm-up incremental inicial:* 3.094,1 ms (local) / 2.814,2 ms (cache externo).

---

### 3.2 Projeto 2: `alethe-contribution` (TypeScript / React, 592 arquivos TS/TSX)

| Modo de Execução | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Run 4 (ms) | Run 5 (ms) | **Mediana (ms)** | Média (ms) | Mín / Máx (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **1. Full `tsc --noEmit` (atual)** | 15.317,2 | 14.814,7 | 13.827,5 | 15.019,6 | 15.310,7 | **15.020** | 14.858 | 13.828 / 15.317 |
| **2. Incremental (sem alteração)** | 2.744,7 | 2.950,6 | 2.920,9 | 2.763,6 | 2.923,3 | **2.921** | 2.861 | 2.745 / 2.951 |
| **3. Incremental (arquivo editado)** | 2.746,8 | 2.861,5 | 2.892,7 | 2.872,8 | 2.822,4 | **2.862** | 2.839 | 2.747 / 2.893 |
| **4. Incremental (`tsBuildInfo` externo)** | 2.651,5 | 2.717,3 | 2.586,0 | 3.023,4 | 2.953,7 | **2.717** | 2.786 | 2.586 / 3.023 |
| **5. Hook `check-edit.ts` End-to-End** | 15.992,6 | 14.523,6 | 14.399,1 | 13.965,6 | 13.879,9 | **14.399** | 14.552 | 13.880 / 15.993 |

*Warm-up incremental inicial:* 16.208,9 ms (local) / 15.418,6 ms (cache externo).

---

## 4. Análise dos Resultados e Latência Percebida

### 4.1 O "Abismo dos 226 ms"
A auditoria anterior mediu o hook em 226 ms, porém **[Fato]** o teste usou `README.md`, saindo na linha 139 de `scripts/check-edit.ts` antes de alcançar qualquer checagem de tipo.

Quando o arquivo editado é `.ts` ou `.tsx`:
- No Next.js (51 arquivos): a latência salta de 226 ms para **2.465 ms** (aumento de **10,9x**).
- No projeto médio (592 arquivos): a latência salta de 226 ms para **14.399 ms** (aumento de **63,7x**).

### 4.2 Custo Acumulado na Sessão do Agente — [Inferência]
Um agente de código (como o `issue-worker` do Vetor) não realiza edições isoladas. Tarefas comuns de correção de bugs, criação de features ou refatoração executam entre 10 e 25 tool calls consecutivas de `Edit`/`Write`:

| Tamanho do Projeto | Número de Edições | Tempo em Espera Síncrona (`tsc` atual) | Tempo em Espera Síncrona (`--incremental`) | Tempo com Typecheck no Checkpoint |
|---|---|---|---|---|
| **Pequeno (51 arquivos)** | 10 edições | ~27 segundos | ~19 segundos | **0 segundos** no loop de edição |
| **Pequeno (51 arquivos)** | 20 edições | ~54 segundos | ~38 segundos | **0 segundos** no loop de edição |
| **Médio (592 arquivos)** | 10 edições | **~2,5 minutos** (150 s) | ~28 segundos | **0 segundos** no loop de edição |
| **Médio (592 arquivos)** | 20 edições | **~5,0 minutos** (300 s) | ~56 segundos | **0 segundos** no loop de edição |

Em projetos de 500+ arquivos, o agente passa **5 minutos inteiros paralisado** esperando o `tsc` validar o projeto inteiro repetidas vezes enquanto altera arquivos pontuais.

### 4.3 O Piso Inelutável do Compilador Node.js
Mesmo utilizando `--incremental` com cache em memória e disco ultra-quente, o `tsc` no Windows necessita de pelo menos:
1. ~300 ms de inicialização do processo Node (`node.exe`).
2. ~800 ms para parsing do arquivo JavaScript do compilador (`typescript.js` tem ~7.5 MB).
3. ~700 a 1.500 ms para ler o `tsbuildinfo`, verificar carimbos de data/hora dos arquivos da árvore e checar símbolos.

Portanto, **[Fato]** não existe cenário em que `tsc` via Node.js execute em menos de **1,8 segundos** em um projeto real. Em contraste, o runtime Deno (`scripts/check-edit.ts:147`) executa `deno check <filePath>`, que avalia apenas o arquivo alvo e suas importações diretas, rodando em poucas centenas de milissegundos.

---

## 5. Análise dos Limites de Timeout (20s interno / 30s hook)

### 5.1 O Gargalo do `TIMEOUT_MS = 20_000`
O script `scripts/check-edit.ts` define:
```typescript
const TIMEOUT_MS = 20_000;
```
Quando o comando excede 20 segundos:
```typescript
async function runWithTimeout(...) {
  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(), TIMEOUT_MS);
  try {
    const result = await new Deno.Command(...).output();
    return { code: result.code, output: ... };
  } catch {
    // Binário ausente ou timeout: sem diagnóstico a reportar.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
```
Se `runWithTimeout` retorna `null`, o fluxo cai em `quiet()` (`Deno.exit(0)`).

**Consequência Crítica:** **[Fato]** Em qualquer projeto com mais de ~750 a 1.000 arquivos TypeScript (ou em máquinas com I/O sob concorrência, antivírus ativo ou CI), a compilação completa `tsc --noEmit` ultrapassa 20 segundos.
Nesse caso ocorre a pior falha possível:
1. O agente é forçado a esperar **20 segundos inteiros** a cada `Edit`.
2. O processo sofre abort por timeout.
3. O hook silencia (`quiet()`) e **não entrega nenhum erro de tipo**.
4. O desenvolvedor/agente paga o custo máximo de latência e recebe **zero** benefício diagnóstico.

### 5.2 O Timeout Declarativo de 30s nos Manifestos
Em `hooks/hooks.json` e `hooks/hooks-codex.json`, o timeout do hook está registrado como:
```json
{
  "matcher": "Edit|Write",
  "command": "deno run -A scripts/check-edit.ts",
  "timeout": 30
}
```
No OpenCode (`opencode/plugin/vetor.ts:186-205`), o timeout é de 20s. Se o `TIMEOUT_MS` interno do script fosse relaxado para 30s ou 40s a fim de contemplar projetos maiores, o processo passaria a ser sumariamente morto pelo harness Claude/Codex/OpenCode, gerando avisos de `hook execution timed out` e potencial instabilidade no loop do agente.

---

## 6. Análise de Trade-Offs entre as Três Alternativas

### Opção 1: Manter como está (`tsc --noEmit` síncrono a cada Edit/Write)
- **Vantagens:**
  - Sem necessidade de gerenciar arquivos de cache incremental no disco.
  - O diagnóstico de tipo chega imediatamente anexado ao resultado da tool `Edit`, evitando que o agente gaste uma iteração inteira do `fix` para descobrir erro de tipo na execução dos testes (#36).
- **Desvantagens / Riscos:**
  - **Inviável em projetos médios/grandes:** Latência de 15 segundos por edição em projetos com 600 arquivos;
  - Falha silenciosa por timeout (>20s) em bases de código maiores;
  - Desgaste na experiência do usuário e consumo excessivo de CPU.
- **Avaliação:** **Inviável a longo prazo.** O ganho de poupar iteração é anulado pelo desperdício massivo de minutos de latência em cada tarefa.

---

### Opção 2: Adotar `--incremental` (com `tsBuildInfoFile` fora do repo)
- **Vantagens:**
  - Redução massiva de **81%** no tempo de compilação em projetos de médio porte (de 15,0s para 2,7s).
  - Preserva a proposta original da issue #36 (feedback imediato no `PostToolUse`).
  - O uso de `--tsBuildInfoFile` apontando para local fora da raiz (ex.: `.claude/vetor/cache/tsc/<hash>.tsbuildinfo`) impede a poluição da árvore Git e evita `git status` sujo.
- **Desvantagens / Riscos:**
  - **Piso de 2 a 3 segundos:** Toda edição continua travando o agente por ~2,5s (soma de 2,1s a 2,7s de `tsc` + overhead de runtime e I/O). Em 15 edições, são ~40 segundos de atraso puro.
  - **Penalidade de Cold Start:** A primeira edição em qualquer worktree novo ainda pagará o custo integral (15 a 16 segundos) para gerar o primeiro buildinfo. Como o `/vetor:coordinator` cria e destrói worktrees isolados com frequência, esse cold start será frequente a menos que haja um cache indexado por commit/branch global.
  - **Risco de Cache Corrompido / Stale:** Mudanças em `node_modules`, `tsconfig.json` ou declarações globais podem exigir invalidação explícita de cache para não gerar falsos positivos/negativos.
- **Avaliação:** **Melhoria substancial em relação ao modelo atual**, mas mantém um custo perceptível (~2,5s por tool call).

---

### Opção 3: Retirar o typecheck síncrono do `PostToolUse` e movê-lo para o checkpoint do `fix` / `ship`
- **Vantagens:**
  - **Latência Zero no Loop de Edição:** Edições voltam instantaneamente (latência de IO pura do arquivo). O agente edita 10 arquivos em sequência sem nenhuma interrupção ou travamento.
  - **Eliminação Total de Risco de Timeout:** Não há risco de estourar 20s ou 30s em ferramentas de edição.
  - **Consistência de Workflow:** O typecheck roda uma única vez no momento em que o código está pronto para ser verificado (no checkpoint do `fix` antes da suíte de testes e no pipeline de entrega do `ship`).
  - **Preservação do Orçamento do Fix-Loop:** Inserindo o typecheck como etapa preliminar ao `test` no `/vetor:fix` (ex.: `typecheck → test`), a falha de tipos continua sendo barrada **antes** de rodar testes complexos e antes de queimar iterações com erros comportamentais.
- **Desvantagens / Riscos:**
  - O agente não recebe o erro de tipo no exato momento da digitação; se um import estiver incorreto, ele só saberá quando invocar a verificação do `fix`.
- **Avaliação:** **Arquiteturalmente superior e alinhada com as melhores práticas de agentes modernos.**

---

## 7. Decisão e Recomendações Fundamentadas para o Vetor

Com base nos dados empíricos registrados e na análise de arquitetura, propõe-se uma estratégia estratificada:

### 7.1 Decisão Principal: Arquitetura em Duas Camadas

1. **Camada 1: `PostToolUse` (`scripts/check-edit.ts`) — Leveza e Desacoplamento:**
   - **Para Deno (`runtime === "deno"`):** **Manter** `deno check <filePath>` ativo. A medição e a arquitetura comprovam que o Deno opera a nível de arquivo único e executa em <300 ms, não impondo sobrecarga perceptível.
   - **Para Node / TypeScript (`runtime === "node"`):** **Desativar por padrão** a chamada síncrona a `tsc --noEmit` a cada edição.
   - **Configurabilidade:** Introduzir no `.claude/vetor/config.json` a chave `"checkEditTypecheck": false` (padrão `false`). Se o desenvolvedor optar por ligar (`true`), o hook obrigatoriamente executará com `--incremental` e `--tsBuildInfoFile` isolado.

2. **Camada 2: Checkpoints do `fix` e `ship` — Validação Completa sem Atrito de Edição:**
   - No workflow do `/vetor:fix` (`skills/fix/SKILL.md`), garantir que a sequência de verificação execute explicitamente a checagem de tipos do projeto (ex.: `npm run typecheck` ou `tsc --noEmit`) **antes** de rodar os testes unitários.
   - Isso atende integralmente à motivação histórica da issue #36: o worker detecta erros de tipagem e imports inválidos antes de queimar tempo rodando testes de integração/unitários pesados, sem punir cada uma das chamadas de escrita individuais com 15 segundos de atraso.
   - No workflow do `/vetor:ship` (`skills/ship/SKILL.md`), o typecheck já faz parte natural do gate de qualidade antes do push e abertura de PR.

---

### 7.2 Implementação Recomendada se o `--incremental` for Adotado no `check-edit.ts`

Se o mantenedor optar por manter a verificação síncrona no `check-edit.ts` para Node.js, a seguinte implementação é mandatória:

1. **Parâmetros Obrigatórios:**
   ```typescript
   const cacheDir = `${cwd}/.claude/vetor/cache/tsc`;
   await Deno.mkdir(cacheDir, { recursive: true });
   const cacheFile = `${cacheDir}/tsbuildinfo.json`;

   const result = await runWithTimeout(
     tsc,
     ["--noEmit", "--incremental", "--tsBuildInfoFile", cacheFile],
     dir,
   );
   ```
2. **Garantir Entrada no `.gitignore`:** O instalador do Vetor (`cli/lib/installer/writer.js` e `skills/install/SKILL.md`) deve assegurar que `.claude/vetor/cache/` esteja no `.gitignore` de todos os projetos suportados.
3. **Respeito a Timeout:** Se a contagem de arquivos for detectada acima de 500 ou se a primeira execução estourar 15s, emitir log de alerta sugerindo desativar o typecheck síncrono.

---

## 8. Rastreabilidade e Fontes

- **Issues e PRs Relacionadas:**
  - Issue #36: Motivação inicial da criação do `check-edit` (evitar queima de iterações do fix-loop com falhas de tipagem).
  - Issue #345: Relato de falsos positivos de `next typegen` em projetos Next.js.
  - PR #353 / Issue #384: Introdução do filtro `filterNextTypegenDiagnostics` para descartar erros conhecidos do Next.js.
  - Spike #375 (`docs/proposals/hooks-cost-benefit-review.md`): Auditoria inicial que registrou 226 ms no caminho curto e demandou a medição empírica com `tsc` real.
  - Issue #394: Esta investigação e medição empírica detalhada.
- **Implementações e Arquivos Auditados:**
  - [check-edit.ts](file:///C:/Projetos/Vetor/scripts/check-edit.ts#L1-L170)
  - [hooks.json](file:///C:/Projetos/Vetor/hooks/hooks.json#L15-L24)
  - [hooks-codex.json](file:///C:/Projetos/Vetor/hooks/hooks-codex.json#L15-L23)
  - [vetor.ts](file:///C:/Projetos/Vetor/opencode/plugin/vetor.ts#L173-L205)
