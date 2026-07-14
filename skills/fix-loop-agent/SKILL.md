---
name: fix-loop-agent
description: Loop autônomo de reproduce → fix → rebuild → test até CI verde (máximo 5 iterações). Opera apenas dentro de worktree. Não cria PR — isso é responsabilidade do worktree-ship.
license: MIT
compatibility: Claude Code
metadata:
  author: vitortavares
  version: "1.0.0"
---

Você é o agente de fix autônomo do Vetor. Sua missão é iterar sobre falhas de build/test até atingir verde, dentro de um worktree já criado.

---

## Sintaxe

```
/fix-loop <descrição>
```

- `<descrição>`: texto livre descrevendo o problema a reproduzir e corrigir (ex.: "cargo clippy warnings em embedding-service", "frontend build failing on import")

---

## Referências

**Delegação opcional ao Gemini.** Leia `$CLAUDE_PLUGIN_ROOT/skills/shared/references/delegate-to-gemini.md` — se `agy` estiver disponível, use-o para resumir a saída de erro dos testes. **A decisão e a aplicação do fix são sempre suas, nunca do Gemini.**

**Branch default e comandos de teste.** Leia `$CLAUDE_PLUGIN_ROOT/skills/shared/references/project-conventions.md` — resolva `$DEFAULT_BRANCH` e o `module-test-map` conforme descrito lá antes de prosseguir.

---

## Comportamento

### 0 — Guarda de contexto

```bash
bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" in-worktree
```

Se sair não-zero, **aborte**: `/fix-loop` deve rodar de dentro de um worktree.

### 1 — Detectar módulos

Analise os arquivos alterados e a `<descrição>` para determinar qual(is) módulo(s) testar:

```bash
git diff "$DEFAULT_BRANCH" --name-only
```

Mapeie ao módulo usando a tabela do module-test-map.

### 2 — Status file

Antes de cada iteração, atualize o status file. Path e formato (estados, blocos obrigatórios de
`BLOCKED_WAITING`): `$CLAUDE_PLUGIN_ROOT/skills/shared/references/agent-status.template.md`.
Se você foi despachado pelo `issue-coordinator`, use o path absoluto recebido no prompt; em uso
manual, derive-o: `<repo-root>/.claude/vetor/status/<branch com / trocada por ->.md`
(root via `git rev-parse --git-common-dir`).

Se bloqueado por permissão ou decisão técnica, mude `Status` para `BLOCKED_WAITING` preenchendo os
blocos `Blocked on` / `Options` / `Recommendation` do template — o coordinator escala ao usuário a
partir deles.

### 3 — Loop principal (máximo N=5 iterações)

Para cada iteração `i` de 1 a 5:

**3.a — Executar testes**

Execute o comando headless do módulo detectado.

**Regra sandbox de docker:**
- Na **primeira** tentativa, tente docker se aplicável
- Se bloqueado: troque para headless **permanentemente** nesta execução
- Nunca retente o path docker após bloqueio

**Regra de comando bloqueado por permissão (worker despachado em background):** se você é o
`issue-worker` despachado pelo `issue-coordinator` (não uma sessão manual/lead) e um comando —
instalação de dependência, teste, build ou qualquer coisa fora do já preparado pelo
`worktree-create` — fica pendente de confirmação de permissão, **não espere nem retente**: como
worker em background, ninguém está olhando o terminal para aprovar em tempo hábil. Trate isso como
bloqueio imediato — mude `Status` para `BLOCKED_WAITING` descrevendo o comando exato que precisa de
aprovação, para o `issue-coordinator` escalar via `AskUserQuestion` (§5.b). Instalação de dependências
já deveria ter sido resolvida na criação do worktree (`worktree-create` §4.b); se um comando de
instalação aparecer aqui mesmo assim, é sinal de dependência faltante não coberta por aquele passo —
reporte isso no `BLOCKED_WAITING`, não tente resolver com `rm`/reinstalação ampla por conta própria.

**Regra de instalação de dependências em worktrees:** as dependências já foram preparadas na criação
do worktree pelo hook `WorktreeCreate` (`scripts/prepare-worktree.ts`) — em Deno puro não há nada a
preparar, pois o cache `$DENO_DIR` é global. Só instale se o teste falhar por dependência ausente.

Nesse caso, **instale sempre dentro do diretório do módulo**, nunca a partir da raiz do monorepo com
flags de workspace (que tocam recursos compartilhados e podem ser bloqueadas por permissão):

```bash
# ✅ Correto — instala isoladamente no worktree, com o instalador do runtime do projeto
cd <módulo-alterado> && <deno install | npm ci | pnpm install>

# ❌ Evite — toca recursos compartilhados
npm ci --workspace=<módulo>  # (a partir da raiz)
```

O instalador correto vem do `runtime`/`packageManager` gravados em `.claude/vetor/config.json`.

**3.b — Avaliar resultado**

Se **verde** (todos os testes passaram):
```json
{"status": "green", "iterations": <i>, "module": "<módulo>"}
```
Atualize o status file com `Status: GREEN` e **pare**.

Se **vermelho**:
1. Leia a saída de erro. Opcional (economia de tokens): condense com `agy` — ver
   `delegate-to-gemini.md` §1.
2. **TDD**: se for a primeira iteração (`i=1`) e os testes ainda não falharem para o bug relatado,
   escreva um teste de reprodução simples que quebre. Só altere o código do produto após o teste
   estar vermelho.
3. **KISS/YAGNI**: aplique a menor alteração atômica que faz o teste passar — sem refatoração
   especulativa fora de escopo.
4. Commit: `fix: <descrição curta do fix>`
5. Atualize o status file
6. Continue para a próxima iteração

### 4 — Após N=5 falhas (Handover de Falha)

Se o loop esgotar sem atingir verde:

1. Atualize o status file com `Status: FAILED_MAX_ITERATIONS`.
2. **Criar Handover de Falha (`FAIL_ANALYSIS.md`)**: Crie um arquivo markdown chamado `FAIL_ANALYSIS.md` no root do worktree atual contendo o diagnóstico da falha para o desenvolvedor humano:

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
...

## Próximo Passo Sugerido (Humano)
<análise concisa da causa provável e recomendação de correção manual (ex: ajustar variáveis do ambiente, atualizar pacotes específicos, etc.)>
```

**Pare.** Não crie PR, não faça push — o worktree fica intacto para inspeção.


---

## O que este skill NÃO faz

- **Não cria worktree** — espera que o worktree já exista (via `worktree-create` ou manualmente)
- **Não faz push** — o código fica local no worktree
- **Não cria PR** — isso é responsabilidade do `worktree-ship`
- **Não resolve conflitos de merge** — se houver conflito com a branch default, reporte e pare

---

## Escalação ao coordinator

Quando invocado pelo `issue-coordinator`, o `fix-loop-agent` comunica-se via status file:
- `RUNNING`: iterando normalmente
- `GREEN`: sucesso — pronto para `worktree-ship`
- `BLOCKED_WAITING`: precisa de intervenção (permissão, decisão técnica)
- `FAILED_MAX_ITERATIONS`: esgotou tentativas

Iterações em status `BLOCKED_WAITING` **não contam** contra o hard cap de 5.
