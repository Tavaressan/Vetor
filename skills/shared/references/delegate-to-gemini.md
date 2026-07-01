# Delegação assistida ao Gemini (opcional)

Referência compartilhada para economizar tokens delegando **tarefas mecânicas e de baixo
risco** ao CLI `gemini` (Google Gemini CLI). Padrão: **Gemini rascunha, Claude valida.**

Consumida por `worktree-ship`, `fix-loop-agent`, `backlog-ideator` e `guardian`.

---

## Detecção (zero dependência obrigatória)

No início da skill, detecte se o CLI está disponível:

```bash
command -v gemini >/dev/null 2>&1 && GEMINI_AVAILABLE=1 || GEMINI_AVAILABLE=0
```

- Se `GEMINI_AVAILABLE=0`: faça a tarefa **inline** normalmente. Nunca falhe nem peça
  instalação — a delegação é puramente opcional.
- Se `GEMINI_AVAILABLE=1`: você **pode** delegar as tarefas listadas abaixo. **Sempre imprima um log explícito no console antes de rodar o comando gemini**, no formato:
  `echo "[Vetor:Gemini] Delegando tarefa: <breve descrição>"`

---

## Tarefas delegáveis (baixo risco, alto volume)

### 1. Resumir logs de CI / build
Antes de diagnosticar uma falha, condense o log bruto para não despejar centenas de
linhas no contexto:

```bash
gh run view <run-id> --log-failed \
  | gemini -p "Resuma a causa raiz das falhas neste log de CI em até 15 linhas, citando arquivo:linha quando houver. Não invente; se não houver causa clara, diga isso."
```

O Claude lê o resumo e **decide o fix**. Usado por `worktree-ship` (monitorar CI) e
`fix-loop-agent` (avaliar resultado dos testes).

### 2. Rascunhar texto de issues
Em `backlog-ideator`, gere a primeira versão do corpo da issue:

```bash
gemini -p "Escreva o corpo de uma issue GitHub (descrição + critério de aceite verificável) para: <tema>. Conciso, em PT-BR."
```

O Claude **revisa e ancora** o rascunho na documentação do projeto antes de criar via
`gh issue create`.

### 3. Rascunhar mensagens de commit e relatórios
Mensagens de commit (`fix-loop-agent`, `worktree-ship`) e o relatório do `guardian`:

```bash
git diff --staged | gemini -p "Escreva uma mensagem de commit conventional commits (uma linha de subject + corpo opcional) para este diff."
```

O Claude valida o rascunho antes de usar.

---

## Guardrail (invariante — não negociável)

**NUNCA delegue ao Gemini:**
- Aplicação de correções de código / geração de diffs (`fix-loop-agent`)
- Resolução de conflitos de merge
- Decisão de fazer (ou não) merge

Essas etapas ficam **sempre** com o Claude. Toda saída delegada é tratada como rascunho
não confiável e **validada pelo Claude antes de qualquer escrita** (commit, push, criação
de PR ou merge). Em caso de dúvida sobre a qualidade do rascunho, descarte-o e faça inline.
