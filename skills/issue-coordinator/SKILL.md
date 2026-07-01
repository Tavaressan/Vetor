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
usuário) ou, na ausência dela, de auto-detecção a partir do CI — cada primitivo já resolve
isso internamente.

---

## Comportamento

### 1 — Listar issues candidatas

```bash
gh issue list --label <label> --state open --json number,title,labels
```

Para cada issue, verifique se já há PR aberto:

```bash
gh pr list --search "closes:#<N>" --state open --json number,title
```

Se já houver PR: pule a issue e registre na tabela como "PR já aberto (#<PR>)".

### 2 — Modo dry-run

Se `--dry-run` foi passado, apresente a tabela de dispatch sem agir:

```
## Plano de Dispatch — label: <label>

| Issue | Título | Status |
|-------|--------|--------|
| #<N1> | <título> | ✅ Será despachada |
| #<N2> | <título> | ⏭️ PR já aberto (#<PR>) |
| #<N3> | <título> | ✅ Será despachada |

<N> issues serão despachadas para sub-agentes.
Confirme com /coordinator <label> (sem --dry-run) para executar.
```

**Pare.** Dry-run nunca cria agentes ou worktrees.

### 3 — Fase de criação (serializada)

⚠️ **Esta fase é serializada** — um worktree de cada vez para evitar `git index lock`.

Para cada issue candidata, em sequência:

1. Derive um slug do título da issue (kebab-case, max 30 chars)
2. Determine o tipo (`feat`, `fix`, `chore`, `refactor`) pelos labels da issue
3. Invoque `worktree-create`:
   ```
   /vetor:worktree-create <type> <slug> <issue#>
   ```
4. Registre o worktree criado: `{"issue": N, "slug": "<slug>", "branch": "<branch>", "path": "<path>"}`

Se `worktree-create` falhar (ex.: slug já existe), tente com sufixo numérico (`<slug>-2`) uma vez. Se falhar novamente, marque a issue como "failed to create worktree" e continue.

### 4 — Fase de desenvolvimento (paralela)

Despache um sub-agente por issue usando o subagente nativo `issue-worker` do plugin (tools
restritas — nunca faz push/PR/merge por design, não só por instrução):

```
Agent({
  description: "Issue #<N>: <título>",
  prompt: "...",
  subagent_type: "vetor:issue-worker",
  model: "<haiku|sonnet>",
  run_in_background: true
})
```

**Critério de escolha do `model`** (otimização de custo de tokens): use `haiku` para issues com
labels `chore` ou `fix` de escopo pequeno (poucos arquivos, sem mudança de arquitetura); use `sonnet`
(ou omita o campo — vira o default da sessão) para `feat`/`refactor` ou qualquer issue cujo body
sugira complexidade maior. Se um worker em `haiku` esgotar as 5 iterações do fix-loop sem atingir
verde (`FAILED_MAX_ITERATIONS`), redespache a mesma issue uma vez com `model: "sonnet"` antes de
marcar como falha definitiva — o custo mais baixo do `haiku` pode custar iterações extras em issues
subestimadas, então essa é a rede de segurança.

> **Nota de implementação (a verificar):** o Agent tool também aceita `isolation: "worktree"` para
> criar o worktree automaticamente no próprio dispatch. Isso só deve substituir a Fase 3
> (`worktree-create` serializado) se o naming/path gerado for compatível com o que `worktree-ship`
> espera (`<type>/<issue#>-<slug>` em `.claude/worktrees/<slug>`). Enquanto isso não for confirmado,
> mantenha a Fase 3 como está.

O prompt de cada agente deve incluir apenas os dados da tarefa — o comportamento (implementar,
iterar até verde via `fix-loop-agent` pré-carregada, atualizar `AGENT_STATUS.md`, nunca fazer
push/PR) já vem do próprio subagente `issue-worker`:
- Número e título da issue
- Body da issue (obtido via `gh issue view <N> --json body`)
- Path do worktree: `.claude/worktrees/<slug>`
- Branch: `<branch>`

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

### 7 — Relatório final

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
