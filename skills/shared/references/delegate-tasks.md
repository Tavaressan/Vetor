# Delegação — exemplos de tarefas

> Lida só ao delegar uma tarefa, depois de o runtime ser escolhido em `delegate-to-runtime.md` §2.
Paths relativos e `$SKILL_DIR` aqui resolvem a partir do diretório da skill que leu esta
> referência. Seleção, anuência (§2.1), fallback (§3) e guardrail (§5): `delegate-to-runtime.md`.

## 4. Exemplos (ilustrativos, não exaustivos)

A lista a seguir é **ilustrativa e aberta** (issue #415): com a aposentadoria da proibição categórica
de delegar mudanças de código, qualquer tarefa — de condensação de texto e logs a alterações de código
e conciliação de conflitos — pode ser delegada, desde que o escopo tenha anuência prévia do desenvolvedor
(§2.1), o resultado seja tratado como rascunho e validado pelo agente antes da escrita.

Mesmo contrato de saída independente do runtime escolhido: substitua `$DELEGATE` pelo comando de
invocação do runtime selecionado (arquivo do runtime, citado em `delegate-to-runtime.md` §1). Para OpenCode, `$DELEGATE` é
`opencode run --agent plan`; para Codex, `codex exec -s read-only`. Em todas as tarefas via pipe,
instrua no prompt que a resposta venha somente pelo stdout; não use arquivos criados pelo runtime
como resultado.

### 4.1. Resumir logs de CI / build
Antes de diagnosticar uma falha, condense o log bruto para não despejar centenas de
linhas no contexto:

```bash
gh run view <run-id> --log-failed \
  | $DELEGATE "Resuma a causa raiz das falhas neste log de CI em até 15 linhas, citando arquivo:linha quando houver. Não invente; se não houver causa clara, diga isso."
```

O Claude lê o resumo e **decide o fix**. Usado por `ship` (monitorar CI) e
`fix` (avaliar resultado dos testes).

### 4.2. Rascunhar texto de issues
Em `backlog`, gere a primeira versão do corpo da issue:

```bash
$DELEGATE "Escreva o corpo de uma issue GitHub (descrição + critério de aceite verificável) para: <tema>. Conciso, em PT-BR."
```

O Claude **revisa e ancora** o rascunho na documentação do projeto antes de criar via
`gh issue create`.

### 4.3. Rascunhar mensagens de commit e relatórios
Mensagens de commit (`fix`, `ship`) e o relatório do `guardian`:

```bash
git diff --staged | $DELEGATE "Escreva uma mensagem de commit conventional commits (uma linha de subject + corpo opcional) para este diff."
```

O Claude valida o rascunho antes de usar.

### 4.4. Rascunhar corpo/descrição de Pull Request
Em `ship`, gere a primeira versão da descrição do Pull Request com base no diff acumulado da branch em relação à branch default do projeto:

```bash
git diff "$DEFAULT_BRANCH"...HEAD | $DELEGATE "Escreva uma descrição concisa e estruturada de Pull Request para este diff. Use markdown em PT-BR com seções: 'O que mudou' (tópicos curtos) e 'Como testar'."
```

O Claude **revisa e formata** a descrição antes de passá-la ao comando `gh pr create --body-file` (corpo gravado com a ferramenta Write).

### 4.5. Análise de afinidade e agrupamento de issues
Em `coordinator`, delegue a varredura e o agrupamento preliminar de issues em lote:

```bash
gh issue list --label <label> --state open --json number,title,labels,body \
  | $DELEGATE "Analise estas issues em formato JSON e sugira um agrupamento de afinidade. Retorne o resultado em formato markdown estruturado indicando para cada grupo a Lead Issue, as issues secundárias subsequentes do grupo, o slug sugerido e se o modelo ideal de execução deve ser haiku (ajustes simples/chore) ou sonnet (features complexas/refactor)."
```

O Claude **valida a afinidade**, resolve eventuais erros do rascunho e constrói a tabela final de dispatch.

### 4.6. Geração de Changelog de Sessão
No `coordinator`, delegue a criação do changelog consolidado a partir do histórico de commits da sessão. **Sempre limite o range** (a regra de 100 linhas de `planning-conventions.md` §1.1 vale para histórico de git também) — `origin/main...HEAD` sozinho não é suficiente como limite: uma branch de longa duração e nunca rebaseada pode produzir um range enorme. Use um cap numérico fixo além do range:

```bash
git log origin/main...HEAD --oneline -200 | $DELEGATE "Com base nestes commits, crie um Changelog em markdown em PT-BR organizado pelas seções: Melhorias (features), Correções (fixes) e Outros."
```

O Claude **valida o texto**, refina o formato e salva no arquivo `.claude/vetor/CHANGELOG.md`.

### 4.7. Validação de Migrations
No `guardian`, envie o dump de arquivos de migrations para verificar a integridade da sequência temporal:

```bash
ls "$MIGRATIONS_DIR" | $DELEGATE "Examine esta listagem de arquivos de migrations e detecte se existem timestamps/versões fora de ordem, buracos na sequência cronológica de numeração ou desvios do padrão de nomenclatura V<N>__<descrição>.sql."
```

O Claude **avalia os findings apontados** e os compila no relatório da auditoria.

### 4.8. Resumo Conceitual da Arquitetura
No `backlog`, envie arquivos longos de documentação para obter uma síntese executiva de apoio à ideação:

```bash
cat ARCHITECTURE.md docs/*.md | $DELEGATE "Gere um resumo arquitetural consolidado deste projeto contendo os principais padrões de design e módulos, para que um agente possa compreender a estrutura do sistema rapidamente."
```

O Claude **usa este sumário como âncora conceitual** sem precisar ler dezenas de arquivos markdown na íntegra.

---

### 4.9. Rascunhar correções e mudanças de código
Em `fix` ou tarefas de implementação, após propor e obter anuência do escopo (§2.1):

```bash
cat <arquivo-ou-contexto> | $DELEGATE "Proponha a implementação/correção para: <descrição>. Retorne o diff ou código rascunhado."
```

O runtime rascunha a mudança (em worktree próprio se via coordinator, ou retornando diff); o agente **valida via testes automatizados** e inspeciona o código antes de qualquer commit.

### 4.10. Rascunhar resolução de conflitos de merge
Durante a resolução de conflitos em rebase ou merge, após anuência do escopo (§2.1):

```bash
git diff --check | $DELEGATE "Analise os trechos conflitantes a seguir e sugira a conciliação do código preservando o propósito de ambos os lados: <diff-com-conflitos>"
```

O agente **revisa a conciliação sugerida**, executa a suíte de testes mapeada para os arquivos tocados e garante a integridade da branch antes de concluir o merge. A decisão de merge é sempre do agente e do desenvolvedor.
