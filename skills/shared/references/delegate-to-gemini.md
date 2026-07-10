# Delegação assistida ao Gemini (opcional)

Referência compartilhada para economizar tokens delegando **tarefas mecânicas e de baixo
risco** ao CLI `agy` (Google Antigravity/Gemini CLI). Padrão: **Gemini rascunha, Claude valida.**

Consumida por `worktree-ship`, `fix-loop-agent`, `backlog-ideator` e `guardian`.

---

## Detecção (zero dependência obrigatória)

No início da skill, detecte se o CLI está disponível:

```bash
command -v agy >/dev/null 2>&1 && GEMINI_AVAILABLE=1 || GEMINI_AVAILABLE=0
```

- Se `GEMINI_AVAILABLE=0`: faça a tarefa **inline** normalmente. Nunca falhe nem peça
  instalação — a delegação é puramente opcional.
- Se `GEMINI_AVAILABLE=1`: você **pode** delegar as tarefas listadas abaixo. **Sempre imprima um log explícito no console antes de rodar o comando agy**, no formato:

**Nota — cache próprio do `agy` fora do projeto:** o `agy` pode persistir uma cópia do rascunho em
`~/.gemini/antigravity-cli/brain/<uuid>/...` (fora do repositório e do controle de versão). Isso é
comportamento do CLI externo, não do Vetor — o Vetor consome apenas a saída via stdout (pipe) e não
depende nem gerencia esse cache. Não é necessário limpar esses arquivos manualmente.
  `echo "[Vetor:Gemini] Delegando tarefa: <breve descrição>"`

---

## Negação de Permissão pelo Classificador de Auto-Mode

Mesmo com o binário `agy` presente, a chamada pode ser **negada em runtime** pela camada de permissão/classificador de auto-mode do Claude Code — motivo típico é **exfiltração de dados** (envio de diff ou conteúdo de código confidencial para CLI externo não estabelecido como confiável).

**Esta não é uma falha transiente de rede; é uma política de segurança.** Não deve ser retentado.

Se a chamada ao `agy` com diff/conteúdo de código completo for negada:
1. **Não retente** — a negação é consistente enquanto a política do ambiente não mudar
2. **Use o fallback inline imediatamente** — monte a descrição, o resumo ou o rascunho manualmente usando o template padrão fornecido na skill (ex.: template de PR padrão em §6 do `worktree-ship`)
3. **Prossiga sem atraso** — evita I/O desnecessário e mensagens de erro em sessões com auto-mode restritivo

A delegação ao Gemini é **opcional e confortável para falhar**; a tarefa sempre tem um caminho inline viável.

---

## Tarefas delegáveis (baixo risco, alto volume)

### 1. Resumir logs de CI / build
Antes de diagnosticar uma falha, condense o log bruto para não despejar centenas de
linhas no contexto:

```bash
gh run view <run-id> --log-failed \
  | agy -p "Resuma a causa raiz das falhas neste log de CI em até 15 linhas, citando arquivo:linha quando houver. Não invente; se não houver causa clara, diga isso."
```

O Claude lê o resumo e **decide o fix**. Usado por `worktree-ship` (monitorar CI) e
`fix-loop-agent` (avaliar resultado dos testes).

### 2. Rascunhar texto de issues
Em `backlog-ideator`, gere a primeira versão do corpo da issue:

```bash
agy -p "Escreva o corpo de uma issue GitHub (descrição + critério de aceite verificável) para: <tema>. Conciso, em PT-BR."
```

O Claude **revisa e ancora** o rascunho na documentação do projeto antes de criar via
`gh issue create`.

### 3. Rascunhar mensagens de commit e relatórios
Mensagens de commit (`fix-loop-agent`, `worktree-ship`) e o relatório do `guardian`:

```bash
git diff --staged | agy -p "Escreva uma mensagem de commit conventional commits (uma linha de subject + corpo opcional) para este diff."
```

O Claude valida o rascunho antes de usar.

### 4. Rascunhar corpo/descrição de Pull Request
Em `worktree-ship`, gere a primeira versão da descrição do Pull Request com base no diff acumulado da branch em relação à branch default do projeto:

```bash
git diff "$DEFAULT_BRANCH"...HEAD | agy -p "Escreva uma descrição concisa e estruturada de Pull Request para este diff. Use markdown em PT-BR com seções: 'O que mudou' (tópicos curtos) e 'Como testar'."
```

O Claude **revisa e formata** a descrição antes de passá-la ao comando `gh pr create --body`.

### 5. Análise de afinidade e agrupamento de issues
Em `issue-coordinator`, delegue a varredura e o agrupamento preliminar de issues em lote:

```bash
gh issue list --label <label> --state open --json number,title,labels,body \
  | agy -p "Analise estas issues em formato JSON e sugira um agrupamento de afinidade. Retorne o resultado em formato markdown estruturado indicando para cada grupo a Lead Issue, as issues secundárias subsequentes do grupo, o slug sugerido e se o modelo ideal de execução deve ser haiku (ajustes simples/chore) ou sonnet (features complexas/refactor)."
```

O Claude **valida a afinidade**, resolve eventuais erros do rascunho e constrói a tabela final de dispatch.

### 6. Geração de Changelog de Sessão
No `issue-coordinator`, delegue a criação do changelog consolidado a partir do histórico de commits da sessão. **Sempre limite o range** (a regra de 100 linhas de `planning-conventions.md` §1.1 vale para histórico de git também) — `origin/main...HEAD` sozinho não é suficiente como limite: uma branch de longa duração e nunca rebaseada pode produzir um range enorme. Use um cap numérico fixo além do range:

```bash
git log origin/main...HEAD --oneline -200 | agy -p "Com base nestes commits, crie um Changelog em markdown em PT-BR organizado pelas seções: Melhorias (features), Correções (fixes) e Outros."
```

O Claude **valida o texto**, refina o formato e salva no arquivo `.claude/vetor/CHANGELOG.md`.

### 7. Validação de Migrations
No `guardian`, envie o dump de arquivos de migrations para verificar a integridade da sequência temporal:

```bash
ls "$MIGRATIONS_DIR" | agy -p "Examine esta listagem de arquivos de migrations e detecte se existem timestamps/versões fora de ordem, buracos na sequência cronológica de numeração ou desvios do padrão de nomenclatura V<N>__<descrição>.sql."
```

O Claude **avalia os findings apontados** pelo Gemini e os compila no relatório da auditoria.

### 8. Resumo Conceitual da Arquitetura
No `backlog-ideator`, envie arquivos longos de documentação para obter uma síntese executiva de apoio à ideação:

```bash
cat ARCHITECTURE.md docs/*.md | agy -p "Gere um resumo arquitetural consolidado deste projeto contendo os principais padrões de design e módulos, para que um agente possa compreender a estrutura do sistema rapidamente."
```

O Claude **usa este sumário como âncora conceitual** sem precisar ler dezenas de arquivos markdown na íntegra.

---

## Guardrail (invariante — não negociável)

**NUNCA delegue ao Gemini:**
- Aplicação de correções de código / geração de diffs (`fix-loop-agent`)
- Resolução de conflitos de merge
- Decisão de fazer (ou não) merge

Essas etapas ficam **sempre** com o Claude. Toda saída delegada é tratada como rascunho
não confiável e **validada pelo Claude antes de qualquer escrita** (commit, push, criação
de PR ou merge). Em caso de dúvida sobre a qualidade do rascunho, descarte-o e faça inline.
