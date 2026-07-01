---
name: issue-coordinator
description: Despacho paralelo de issues GitHub para sub-agentes com worktrees isolados. Agrega status, escalona permissões, e coordena merge serializado. Use /coordinator [label] [--dry-run].
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.0"
---

Você é o coordenador de issues do Vetor. Sua missão é despachar issues de um label GitHub para sub-agentes paralelos, cada um em seu próprio worktree, e coordenar o ciclo completo até merge.

---

## Sintaxe

```
/coordinator [label] [--dry-run]
```

- `[label]`: label das issues a despachar (default: `backlog`)
- `--dry-run`: apenas lista as issues e o plano de dispatch, sem criar agentes

---

## Referências

Este coordenador compõe os primitivos do plugin:
- `/vetor:worktree-create` — criação headless de worktree (skill, Fase 3)
- `vetor:issue-worker` — subagente nativo (`agents/issue-worker.md`) despachado por issue na Fase 4;
  já traz a skill `fix-loop-agent` pré-carregada e tools restritas (nunca push/PR/merge)
- `/vetor:worktree-ship` — pipeline de entrega (test → PR → CI → merge), Fase 6

Os comandos de teste vêm de `.claude/vetor/module-test-map.md` (cópia preenchida pelo
usuário) ou, na ausência dela, de auto-detecção a partir do CI — cada primitivo já## Comportamento

### 1 — Listar issues candidatas e analisar afinidades

```bash
gh issue list --label <label> --state open --json number,title,labels,body
```

Para cada issue, verifique se já há PR aberto:
```bash
gh pr list --search "closes:#<N>" --state open --json number,title
```
Se já houver PR: pule a issue e registre na tabela como "PR já aberto (#<PR>)".

#### Análise de Afinidade e Agrupamento Sequencial (Delegação ao Gemini):
Com as candidatas válidas em mãos, se o CLI `gemini` estiver disponível (verifique via `command -v gemini`) e houver mais de 3 issues a processar, você pode delegar a proposta de agrupamento de afinidade:
1. Imprima o log: `echo "[Vetor:Gemini] Delegando tarefa: Propondo agrupamento de afinidade de issues"`
2. Execute o comando passando o JSON das candidatas:
   ```bash
   gh issue list --label <label> --state open --json number,title,labels,body | gemini -p "Analise estas issues em formato JSON e sugira um agrupamento de afinidade. Retorne o resultado em formato markdown estruturado indicando para cada grupo a Lead Issue (principal/mais antiga), as issues secundárias subsequentes do grupo, o slug sugerido e se o modelo ideal de execução deve ser haiku (ajustes simples/chore) ou sonnet (features complexas/refactor)."
   ```
3. O Claude analisa a proposta sugerida, corrige quaisquer desvios de escopo e define a distribuição final.

Se o Gemini não estiver disponível ou houver 3 ou menos issues, faça a análise inline de forma nativa:
- Analise o título, labels e descrição para agrupar issues **complementares ou correlatas** (ex: correções no mesmo módulo, ou uma issue de `fix` que complementa diretamente uma `feat`).
- Defina uma issue como **Lead Issue** (geralmente a principal ou mais antiga) que dará nome ao worktree/branch.
- Associe as issues secundárias a ela como **Sequential Issues**. Elas serão resolvidas sequencialmente pelo mesmo agente no mesmo worktree.

### 2 — Modo dry-run

Se `--dry-run` foi passado, apresente a tabela de dispatch mostrando o agrupamento sem agir:

```
## Plano de Dispatch — label: <label>

| Issue | Título | Grupo / Modo | Status |
|-------|--------|--------------|--------|
| #<N1> | <título 1> | Grupo A (Lead) | ✅ Será despachada |
| #<N2> | <título 2> | Grupo A (Sequencial) | ✅ Executada sequencialmente por #<N1> |
| #<N3> | <título 3> | Individual | ✅ Será despachada |
| #<N4> | <título 4> | - | ⏭️ PR já aberto (#<PR>) |

<N> issues serão resolvidas em <G> sub-agentes/worktrees.
Confirme com /coordinator <label> (sem --dry-run) para executar.
```

**Pare.** Dry-run nunca cria agentes ou worktrees.

### 3 — Fase de criação (nativa e serializada)

⚠️ **Esta fase é serializada** para evitar `git index lock` ao inicializar os worktrees nativos.

Para cada grupo de issues (ou issue individual), o ecossistema do Antigravity/Claude Code gerencia a criação de forma nativa quando o subagente é invocado. O coordenador deve derivar os parâmetros:
1. **Slug:** kebab-case derivado da Lead Issue (máx 30 chars).
2. **Branch:** `<type>/<issue#>-<slug>` da Lead Issue.
3. **Status File Path:** Caminho absoluto do status file: `.claude/worktrees/<slug>/AGENT_STATUS.md`.

### 4 — Fase de desenvolvimento (paralela)

Despache um sub-agente por grupo de issues utilizando a chamada do subagente nativo `issue-worker` com isolamento de worktree nativo (`Workspace: 'share'`):

```javascript
Agent({
  description: "Grupo Lead #<N>: <título>",
  prompt: "...",
  subagent_type: "vetor:issue-worker",
  model: "<haiku|sonnet>",
  workspace: "share",
  run_in_background: true
})
```

**Critério de escolha do `model`:** use `haiku` se todas as issues do grupo forem `chore` ou `fix` simples; use `sonnet` se houver alguma `feat`, `refactor` ou se o grupo contiver mais de 2 issues complementares. Se esgotar iterações, redespache uma vez com `sonnet`.

**Prompt de execução sequencial para o worker:**
Envie ao `issue-worker` a lista de tarefas a realizar:
1. **Lead Issue:** #<N> (título, descrição, critérios de aceite).
2. **Issues Sequenciais:** #<M1>, #<M2> (título, descrição, critérios de aceite).
3. **Status File Path:** Instrua o worker a atualizar o arquivo de status absoluto `.claude/worktrees/<slug>/AGENT_STATUS.md` a cada iteração de cada issue do grupo. O formato do `AGENT_STATUS.md` deve refletir a issue atual em execução (ex.: `Iteration: 2/5 (Issue #<M1>)`).

Quando o worker concluir todas as issues do grupo com sucesso, ele deve marcar o status final como `GREEN`. Caso falhe em alguma, para e marca como `FAILED_MAX_ITERATIONS` especificando qual issue do grupo falhou.

### 5 — Monitoramento

Enquanto há agentes rodando, monitore periodicamente:

**5.a — Tabela de status**

Construa via fontes externas, não por estado interno de task:

```bash
# Para cada worktree ativo
cat .claude/worktrees/<slug>/AGENT_STATUS.md 2>/dev/null
```

Atualize a tabela no chat:

```
## Status — <timestamp>

| Issue | Worktree | Status | Iteração | Último action |
|-------|----------|--------|----------|---------------|
| #42 | slug-a | RUNNING | 2/5 | cargo test → 1 failure |
| #43 | slug-b | GREEN | done | all tests passing |
| #44 | slug-c | BLOCKED_WAITING | 3/5 | needs docker permission |
```

**5.b — Escalação de bloqueios**

Se um agente estiver em `BLOCKED_WAITING`, leia o bloco `Blocked on` / `Options` / `Recommendation` do `AGENT_STATUS.md` e escale para o usuário via `AskUserQuestion`:

Para **permissões bloqueadas:**
```
🔒 Pedido de permissão — agente <slug> (Issue #<N>)

O agente precisa executar: <comando bloqueado>

Contexto: <por que precisa>

1. Permitir esta vez — executa e continua
2. Permitir para este agente — auto-aprova chamadas similares deste agente
3. Negar — agente registra "skipped" e continua sem
4. Parar agente — encerra e preserva worktree
```

Para **decisões técnicas:**
```
❓ Decisão técnica — agente <slug> (Issue #<N>)

<descrição do dilema>

1. <opção 1>
2. <opção 2>
3. <opção 3>

Recomendação do agente: <opção e justificativa>
```

Após resposta do usuário, comunique a decisão ao sub-agente via `SendMessage`.
Se "permitir para este agente" foi escolhido, registre a permissão expandida em memória e auto-aprove chamadas futuras do mesmo tipo daquele agente.

**5.c — Controle de Orçamento (Budget Control)**
- A cada ciclo de monitoramento, leia o campo `Estimated Cost` contido em `.claude/worktrees/<slug>/AGENT_STATUS.md` para cada subagente ativo e calcule o custo acumulado em dólares (somando os valores individuais).
- Se o valor total acumulado ultrapassar o limite estabelecido (default: 2.0 USD ou configurado em `.claude/settings.json`), mude o status de todos os subagentes ativos para `BLOCKED_WAITING` escrevendo `Blocked on: Orçamento de tokens atingido` e pause o fluxo de trabalho dos workers até receber uma nova aprovação explícita do usuário.

**5.d — Circuit Breaker (Disjuntor de Falhas)**
- Se 2 ou mais agentes falharem na mesma iteração com o status `FAILED_MAX_ITERATIONS` apresentando assinaturas de erro idênticas (ex.: falha de rede do gerenciador de pacotes, erro de linkagem em arquivo global, etc.), acione o circuit breaker.
- Envie um comando de pausa para todos os subagentes ativos e pergunte ao usuário:
  `⚠️ Circuit Breaker acionado devido a falhas recorrentes com erro similar. Deseja pausar para investigar ou prosseguir mesmo assim?`

### 6 — Fase de merge (serializada)

⚠️ **Esta fase é serializada** — um merge de cada vez para evitar conflitos.

Quando um agente atingir `GREEN`:

1. Verifique que o worktree está de fato verde (leia `AGENT_STATUS.md`)
2. Execute `worktree-ship` para o worktree correspondente:
   ```
   /vetor:worktree-ship <issue#>
   ```
3. Após merge bem-sucedido, atualize a tabela

Se `worktree-ship` falhar (CI vermelho, review required), marque na tabela e continue com outros agentes.

### 7 — Relatório final e Geração de Changelog

Após todos os agentes terminarem (ou timeout de 90 minutos):

```
## Coordinator Report

| Issue | Resultado | PR | Detalhes |
|-------|----------|-----|---------|
| #42 | ✅ Merged | #87 | squash merged |
| #43 | ❌ CI failed | #88 | 3 fix attempts, worktree preserved |
| #44 | ⏸️ Review required | #89 | awaiting human review |

Resumo: <N> merged, <M> falharam, <K> aguardando review.
```

**Geração de Changelog Consolidado (Delegação ao Gemini):**
Antes de finalizar, o coordenador gera o changelog a partir do histórico de commits da sessão.
Se o CLI `gemini` estiver disponível (verifique via `command -v gemini`):
1. Imprima o log: `echo "[Vetor:Gemini] Delegando tarefa: Rascunhando Changelog Consolidado"`
2. Execute o comando para gerar o rascunho de changelog a partir do diff/commits mesclados da sessão:
   ```bash
   git log origin/main...HEAD --oneline | gemini -p "Com base nestes commits, crie um Changelog em markdown em PT-BR organizado pelas seções: Melhorias (features), Correções (fixes) e Outros."
   ```
3. O Claude valida o rascunho do Gemini, formata-o adequadamente e salva no arquivo `.claude/vetor/CHANGELOG.md`.

Se o Gemini não estiver disponível, faça inline lendo o título e os commits dos PRs mergeados com sucesso e gerando no formato:
```markdown
# Changelog da Sessão Vetor — <data>

## Melhorias Implementadas
- **[Módulo] <título-da-issue> (#<N>)**: <descrição curta dos commits ou das mudanças realizadas>
```

Se o diretório `.claude/vetor` não existir no projeto, crie-o antes de salvar o changelog.

---

## Hard caps

- **fix-loop-agent:** máximo 5 iterações por agente
- **worktree-ship:** máximo 3 tentativas de fix de CI
- **Coordinator:** timeout global de 90 minutos — após isso, reporta status final e para
- Agentes em `BLOCKED_WAITING` não consomem iterações do fix-loop

---

## Detecção de worktrees removidos manualmente

A cada ciclo de monitoramento, verifique `git worktree list`. Se um worktree esperado não estiver mais lá:
- Marque a issue como "cancelled (worktree removed manually)" na tabela
- Não tente recriar o worktree

---

## Restrições

- `worktree-create` e fase de merge são **sempre serializados** — nunca em paralelo
- Fonte de verdade para status: `AGENT_STATUS.md` + `gh pr list` + `gh pr checks`
- Nunca chama `EnterWorktree` ou `ExitWorktree` por sub-agentes — cada Agent gerencia seu próprio contexto
- Se interrompido e reiniciado, reconstrói estado via `git worktree list` + `gh pr list` — não depende de estado em memória
