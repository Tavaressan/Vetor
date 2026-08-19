---
name: fix-loop-agent
description: Loop autônomo de reproduce → fix → rebuild → test até CI verde (máximo 5 iterações). Opera apenas dentro de worktree. Não cria PR — isso é responsabilidade do worktree-ship.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.1"
---

Você é o agente de fix autônomo do Vetor. Sua missão é iterar sobre falhas de build/test até atingir verde, dentro de um worktree já criado.

🚫 **NUNCA entre em plan mode (`EnterPlanMode`).** Este skill roda tipicamente em agentes headless
despachados em background (`issue-worker`), sem interlocutor disponível para aprovar a saída via
`ExitPlanMode` — entrar em plan mode aqui trava a sessão sem recuperação. Independente de a tarefa
parecer "não-trivial" pela heurística padrão do Claude Code, vá **direto** para reproduce → fix
(passo 3), nunca produza um plano para aprovação antes de agir.

⚠️ **IMPORTANTE — Fluidez síncrona obrigatória:** Você NUNCA deve invocar ou esperar por padrões de
"monitor em background" (ex.: "I'll wait for this background monitor to notify me"). Seu próprio
fluxo de execução é **síncrono** — execute cada passo até o final, sem pausar para aguardar
notificação externa. Se encontrar algo que pareça monitoramento assíncrono, ignore-o e prossiga.
Parar antes de atingir um estado terminal é uma falha silenciosa que o coordinator não detecta.

**Ação obrigatória inaugural:** Antes de qualquer passo (antes do `vetor-checks.sh`, antes de
detectar módulos, antes de qualquer coisa), grave o status file com `Status: RUNNING`. Isso torna
a ausência total do arquivo um sinal detectável de falha anômala.

---

## Sintaxe

```
/fix-loop <descrição>
```

- `<descrição>`: texto livre descrevendo o problema a reproduzir e corrigir (ex.: "cargo clippy warnings em embedding-service", "frontend build failing on import")

---

## Referências

- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/project-conventions.md` — resolva `$DEFAULT_BRANCH`
  e o `module-test-map` antes de prosseguir.
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/agent-status.template.md` — path, estados e blocos
  obrigatórios do status file.
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/touched-files-cache.md` — formato do cache gravado no §1.
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/delegate-to-gemini.md` — resumo opcional da saída de
  erro dos testes com `agy`. **A decisão e a aplicação do fix são sempre suas, nunca do Gemini.**
- `$CLAUDE_PLUGIN_ROOT/skills/shared/references/mcp-availability.md` — se a `<descrição>` indicar bug
  visual/frontend e o MCP de browser estiver disponível, use-o antes do §3.a para reproduzir o bug e
  capturar evidência.

---

## Comportamento

### 0 — Status file inaugural + Guarda de contexto

**Primeira ação (antes de tudo):** grave o status file com `Status: RUNNING`. Derive o path conforme
§2 (ou use o path absoluto recebido do `issue-coordinator`).

```bash
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" in-worktree
```

Se sair não-zero, **aborte**: `/fix-loop` deve rodar de dentro de um worktree.

### 1 — Detectar módulos

```bash
git diff "$DEFAULT_BRANCH" --name-only
```

Mapeie ao módulo usando a tabela do module-test-map. Módulos cujo comando é `sem suíte de testes`
não entram no loop: registre `skipped (no test suite)` e não os trate como falha.

Depois de resolver os módulos, grave o cache de arquivos tocados conforme
`touched-files-cache.md` — ele é consumido pelo `code-review` na mesma branch.

### 2 — Status file

Antes de cada iteração, atualize o status file (path e formato em `agent-status.template.md`). Se
você foi despachado pelo `issue-coordinator`, use o path absoluto recebido no prompt; em uso manual,
derive-o: `<repo-root>/.claude/vetor/status/<branch com / trocada por ->.md` (root via
`git rev-parse --git-common-dir`).

Se bloqueado por permissão ou decisão técnica, mude `Status` para `BLOCKED_WAITING` preenchendo os
blocos `Blocked on` / `Options` / `Recommendation` — o coordinator escala ao usuário a partir deles.
Iterações em `BLOCKED_WAITING` **não contam** contra o hard cap de 5.

### 3 — Loop principal (máximo N=5 iterações)

Para cada iteração `i` de 1 a 5:

**3.a — Executar testes**

Execute o comando headless do módulo detectado. Se for `sem suíte de testes`, pule o módulo sem
consumir uma iteração.

**Docker:** tente o path docker apenas na **primeira** tentativa, se aplicável. Se bloqueado, troque
para headless **permanentemente** nesta execução e nunca retente docker.

**Comando bloqueado por permissão:** se você é o `issue-worker` despachado pelo `issue-coordinator`
(não uma sessão manual) e qualquer comando fica pendente de confirmação, **não espere nem retente**
— ninguém está olhando o terminal. Mude `Status` para `BLOCKED_WAITING` descrevendo o comando exato
que precisa de aprovação, para o coordinator escalar (§5.b dele).

**Instalação de dependências:** já preparadas na criação do worktree pelo hook `WorktreeCreate`
(`scripts/prepare-worktree.ts`). Só instale se o teste falhar por dependência ausente — e nesse caso
**sempre dentro do diretório do módulo**, nunca da raiz com flags de workspace (tocam recursos
compartilhados e podem ser bloqueadas por permissão):

```bash
# ✅ Correto
cd <módulo-alterado> && <deno install | npm ci | pnpm install>

# ❌ Evite
npm ci --workspace=<módulo>  # (a partir da raiz)
```

O instalador correto vem do `runtime`/`packageManager` de `.claude/vetor/config.json`. Se um comando
de instalação for necessário aqui, reporte isso no `BLOCKED_WAITING` — não tente resolver com
`rm`/reinstalação ampla por conta própria.

**3.b — Avaliar resultado**

Se **verde** (todos os testes passaram):
```json
{"status": "green", "iterations": <i>, "module": "<módulo>"}
```
Atualize o status file com `Status: GREEN` e **pare**.

Se **vermelho**:
1. Leia a saída de erro (opcionalmente condensada com `agy` — ver `delegate-to-gemini.md` §1).
2. **TDD**: se for a primeira iteração (`i=1`) e os testes ainda não falharem para o bug relatado,
   escreva um teste de reprodução simples que quebre. Só altere o código do produto após o teste
   estar vermelho.
3. **KISS/YAGNI**: aplique a menor alteração atômica que faz o teste passar — sem refatoração
   especulativa fora de escopo.
4. Commit: `fix: <descrição curta do fix>`
5. Atualize o status file
6. Continue para a próxima iteração

### 4 — Após N=5 falhas (Handover de Falha)

1. Atualize o status file com `Status: FAILED_MAX_ITERATIONS`.
2. Crie `FAIL_ANALYSIS.md` no root do worktree:

```markdown
# Handover de Falha — Vetor

O agente de correção automática falhou após 5 iterações.

## Detalhes
* **Módulo**: <módulo>
* **Comando de Teste**: `<comando-de-teste>`

## Último Erro de Teste
```
<erro bruto ou resumo do erro obtido na última iteração>
```

## Fixes Tentados (Commits locais)
1. <fix commit 1>
2. <fix commit 2>

## Próximo Passo Sugerido (Humano)
<análise concisa da causa provável e recomendação de correção manual>
```

**Pare.** Não crie PR, não faça push — o worktree fica intacto para inspeção.

---

## O que este skill NÃO faz

- **Não cria worktree** — espera que ele já exista (via `worktree-create` ou manualmente)
- **Não faz push** — o código fica local no worktree
- **Não cria PR** — isso é responsabilidade do `worktree-ship`
- **Não resolve conflitos de merge** — se houver conflito com a branch default, reporte e pare
