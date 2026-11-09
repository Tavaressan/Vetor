# Delegação assistida a runtime externo (opcional, agnóstica de provedor)

Delegar tarefas (texto, logs, rascunhos de código ou de resolução de conflito) a um CLI externo de
IA para economizar tokens. Padrão: **o runtime delegado rascunha, o agente valida.** Runtimes
conhecidos: Gemini/`agy`, OpenCode/`opencode`, Codex/`codex` e o orquestrador MCP Alethe. Nenhum é
assumido como padrão sem configuração ou anuência (issue #247).

Este arquivo traz só detecção, seleção, anuência, fallback e guardrail. O resto é lido sob demanda:

- invocação e limites de cada CLI, só depois de selecioná-lo: `delegate-runtime-gemini.md`,
  `delegate-runtime-opencode.md`, `delegate-runtime-codex.md`;
- exemplos de tarefas delegáveis (§4.1 a §4.10), só ao delegar uma: `delegate-tasks.md`;
- o orquestrador Alethe (§6), só quando ele é o selecionado: `delegate-alethe.md`.

---

## 1. Detecção (estática, zero dependência obrigatória)

Olhe se o binário existe no PATH, nunca "tente a chamada para ver se funciona" (mesmo princípio de
`mcp-availability.md`). Detecte todos numa **única chamada em lote**:

```bash
command -v agy 2>/dev/null; command -v opencode 2>/dev/null; command -v codex 2>/dev/null
```

Monte a lista `available` com os que retornaram um path.

| Runtime | Binário | Stdin via pipe (pré-requisito das tarefas de `delegate-tasks.md`) |
|---|---|---|
| Gemini (Antigravity) | `agy` | não no modo padrão |
| OpenCode | `opencode` | confirmado |
| Codex | `codex` | confirmado |

**Regra do stdin:** um runtime com consumo de stdin **não confirmado** nunca é usado para as tarefas
via pipe. Um CLI que ignora o stdin ainda sai com 0 e uma resposta plausível, sobre um input que
nunca recebeu, e o §3 não detecta isso. Antes do primeiro uso de um runtime novo, rode o teste de
eco (`echo "<marcador>" | <cli> "repita o marcador"`) e só o considere confirmado se o marcador
voltar exato. Se o único candidato não tem stdin confirmado, siga inline.

**Preferência configurada:** bloco opcional `delegation` de `.claude/vetor/config.json`:

```json
{ "delegation": { "preferredRuntime": "opencode" } }
```

`"alethe"` também é aceito e seleciona o orquestrador MCP, detectado pelo namespace
`mcp__alethe__*` e não por `command -v`. Ausência do bloco `delegation` (ou do `config.json`) nunca é
erro.

## 2. Algoritmo de seleção

Com `available` (detectada) e `preferred` (config, pode ser `null`):

1. **`available` vazio** (e `preferred` não é um runtime MCP detectado) → siga **inline**. Nunca
   falhe nem peça instalação.
2. **`preferred` configurado:**
   - runtime MCP detectado na sessão (hoje `alethe`) → delegue para ele. Runtimes MCP nunca entram
     na escolha sem preferência.
   - em `available` → delegue para `preferred`.
   - fora de `available` → siga **inline**. Nunca troque em silêncio por outro candidato: o usuário
     consentiu com um runtime específico.
3. **Sem `preferred`, exatamente 1 candidato** → delegue para ele.
4. **Sem `preferred`, 2+ candidatos:**
   - **Sessão interativa:** pergunte qual usar e ofereça salvar em `delegation.preferredRuntime`.
     **Exceção:** no `coordinator`, a escolha de runtime não gera pergunta própria (a entrevista
     consolidada da Fase 2, issue #499, é o único turno antes do dispatch); siga inline e sugira
     salvar a preferência no relatório.
   - **Sessão headless:** sempre inline. Nunca escolha entre candidatos não consentidos.

Implementado e testado em `scripts/lib/delegation-runtime.ts`:
`selectDelegationRuntime({ available, mcpAvailable, preferred, interactive })` devolve
`{ action: "inline" | "delegate" | "ask", runtime?, reason }`. `mcpAvailable` lista os runtimes MCP
detectados (ex.: `["alethe"]`), que só são escolhidos quando coincidem com `preferred`. Skills em
markdown seguem os passos 1-4 em prosa.

Antes de delegar, imprima: `echo "[Vetor:Delegação] Delegando tarefa a <runtime>: <breve descrição>"`.

### 2.1 Acordo de escopo e anuência prévia

Antes de qualquer delegação, proponha ao desenvolvedor: o que vai para o runtime (tarefa, diff ou
trecho), o que fica com o agente (worktree, coordenação, testes, commit e merge) e como o resultado
será validado (testes do `module-test-map.md` e inspeção do diff antes de qualquer escrita).

- **Sessão interativa:** só delegue com anuência explícita; recusada, faça inline.
- **Sessão `--headless`:** sem interlocutor para anuir, siga inline. A delegação nunca é tácita.

## 3. Qualquer falha do CLI delegado = fallback inline imediato, sem retry

Vale para negação de permissão (ex.: o classificador do auto mode do Claude Code nega por
exfiltração de dados; é política, não falha transiente) e para falha genérica (exit ≠ 0, crash,
timeout, encoding, saída vazia ou corrompida):

1. **Não retente**, nem com o mesmo runtime nem trocando de candidato.
2. **Faça inline imediatamente**, com o template padrão da skill (ex.: corpo de PR do `ship`).
3. **Siga sem atraso.**

A delegação é opcional: a tarefa sempre tem um caminho inline viável.

## 5. Guardrail (invariante, independe do runtime)

**Nunca delegue a decisão de fazer (ou não) merge.** Ela fica sempre com o agente e o desenvolvedor.
Toda saída delegada é **rascunho não confiável**, validado pelo agente antes de qualquer escrita
(commit, push, PR ou merge). Na dúvida ou com testes falhando, descarte e faça inline.
