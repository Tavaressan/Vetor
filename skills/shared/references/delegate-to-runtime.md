# Delegação assistida a runtime externo (opcional, agnóstica de provedor)

Referência compartilhada para economizar tokens delegando **tarefas mecânicas e de baixo
risco** a um CLI externo de IA. Padrão: **o runtime delegado rascunha, Claude valida.**

Consumida por `worktree-ship`, `fix-loop-agent`, `backlog-ideator`, `guardian` e
`issue-coordinator`.

Generaliza o antigo acoplamento a um único CLI (`agy` — Google Antigravity/Gemini CLI): a
delegação agora suporta qualquer runtime candidato (Gemini/`agy`, OpenCode/`opencode`,
Codex/`codex`, ou outro CLI futuro), escolhido por disponibilidade no ambiente, preferência
configurada e, quando ambíguo, anuência explícita do usuário (issue #247).

---

## 1. Detecção (zero dependência obrigatória, detecção estática)

Mesmo princípio já validado para MCPs em `mcp-availability.md`: **olhar se o binário existe no
PATH**, nunca "tentar a chamada para ver se funciona" (issue #247 reaproveita esse princípio para
CLIs externos, não só MCPs).

No início da skill, detecte todos os candidatos em **uma única chamada em lote** (não uma por
runtime, para não gastar turnos):

```bash
command -v agy 2>/dev/null; command -v opencode 2>/dev/null; command -v codex 2>/dev/null
```

Monte a lista `available` com os que retornaram um path. Runtimes candidatos conhecidos hoje:

| Runtime | Binário | Invocação não-interativa | Consome stdin via pipe (pré-requisito das tarefas §4)? |
|---------|---------|---|---|
| Gemini (Antigravity) | `agy` | `agy -p "<prompt>"` — `-p`/`--print` roda um prompt único e imprime a resposta | **Não funciona com modo padrão** — flag `--input-format` padrão é `text`, que ignora stdin (regressão de #111). Alternativa verificada: embutir conteúdo no argumento do prompt: `agy -p "... $conteudo"` (válido para conteúdo que cabe no limite de linha de comando); para conteúdo grande, use `opencode` (stdin confirmado empiricamente) em vez de `agy`. |
| OpenCode | `opencode` | `opencode run "<prompt>"` — mensagem como argumento posicional, não flag `-p` (`-p`/`--password` do OpenCode é autenticação HTTP, não prompt — não confundir com o `-p` do `agy`) | **Confirmado empiricamente**: `echo "MARCADOR-XYZ-123" \| opencode run --model <free> "Repita exatamente o texto que você recebeu via stdin"` devolveu `MARCADOR-XYZ-123` — o conteúdo do pipe chega ao modelo mesmo sem flag dedicada |
| Codex | `codex` | `codex exec "<prompt>"` (sintaxe **não verificada neste ambiente** — binário não estava instalado nem MCP de documentação disponível na sessão que escreveu esta referência) | **Não verificado** |

**Regra:** um runtime com consumo de stdin **não verificado** nunca deve ser usado para as tarefas
de §4 (todas dependem do pipe `<producer> | $DELEGATE "..."` carregar o conteúdo real). Um CLI que
ignora silenciosamente o stdin ainda retorna exit 0 e uma resposta plausível — não é uma falha que
o guardrail do §3 detecta, é uma alucinação sobre um input que o runtime nunca recebeu. Antes do
primeiro uso de um runtime novo em produção: rode o teste de eco acima (`echo "<marcador>" | <cli> "repita o marcador"`) e só marque a coluna acima como confirmada se o marcador voltar exato. Enquanto
não confirmado, trate esse runtime como **não viável para §4** (mesmo que detectado no PATH) — se
for o único candidato disponível, siga inline; use o CLI apenas via seu mecanismo documentado de
anexo de arquivo (ex.: `-f/--file` do `opencode`) se a tarefa permitir.

**Preferência configurada:** leia `.claude/vetor/config.json` → bloco opcional `delegation`:

```json
{
  "delegation": { "preferredRuntime": "opencode" }
}
```

(Exemplo mostra `opencode` como preferência recomendada: é o único com suporte comprovado a stdin
em todas as tarefas de §4. Se preferir `agy`, consulte a linha da tabela do §1 para limitações e alternativas.)

Ausência do bloco `delegation` (ou do `config.json` inteiro) nunca é erro — mesmo contrato do
bloco `knowledge` (ver `skills/vetor/SKILL.md`).

## 2. Algoritmo de seleção

Com `available` (lista detectada) e `preferred` (config, pode ser `null`):

1. **`available` vazio** → siga **inline**. Nunca falhe nem peça instalação — a delegação é
   puramente opcional.
2. **`preferred` configurado:**
   - Se `preferred` está em `available` → delegue para `preferred`.
   - Se `preferred` **não** está em `available` → siga **inline**. Nunca substitua
     silenciosamente por outro candidato disponível: o usuário consentiu com um runtime
     específico, não com "qualquer um" (issue #247 — "nenhum runtime é assumido como
     padrão/preferencial sem configuração ou anuência").
3. **Sem `preferred`, `available` com exatamente 1 candidato** → delegue para ele. Não há
   ambiguidade entre runtimes a resolver, então não é necessário perguntar (a anuência explícita
   só é exigida "quando houver mais de um runtime viável e nenhuma preferência registrada").
4. **Sem `preferred`, `available` com 2+ candidatos (ambíguo):**
   - **Sessão interativa** (há interlocutor, ex.: `issue-coordinator` fora de `--headless`):
     pergunte ao usuário qual runtime usar (mecanismo de seleção interativa da skill, quando
     disponível). Ofereça salvar a escolha em `delegation.preferredRuntime` para não perguntar de
     novo.
   - **Sessão headless** (`fix-loop-agent`, `issue-worker`, `guardian`, `backlog-ideator` sem
     interlocutor): **critério de desempate documentado é sempre inline** — nunca escolha
     silenciosamente entre candidatos não consentidos. Isso é intencional mesmo que sacrifique
     uma oportunidade de economia de tokens: é o preço de não assumir uma preferência que
     ninguém configurou.

Lógica de referência (implementada e testada em `scripts/lib/delegation-runtime.ts`,
`scripts/tests/delegation-runtime_test.ts`):

```ts
selectDelegationRuntime({ available, preferred, interactive });
// => { action: "inline" | "delegate" | "ask", runtime?, reason }
```

Skills que rodam em Deno podem importar a função diretamente; skills descritas só em markdown
devem seguir o mesmo algoritmo em prosa (passos 1-4 acima).

Antes de rodar o comando de delegação escolhido, **sempre imprima um log explícito no console**:
`echo "[Vetor:Delegação] Delegando tarefa a <runtime>: <breve descrição>"`.

**Nota — cache próprio de alguns runtimes fora do projeto:** o `agy`, por exemplo, pode persistir
uma cópia do rascunho em `~/.gemini/antigravity-cli/brain/<uuid>/...` (fora do repositório e do
controle de versão). Isso é comportamento do CLI externo, não do Vetor — o Vetor consome apenas a
saída via stdout (pipe) e não depende nem gerencia esse cache. Não é necessário limpar esses
arquivos manualmente.

---

## 3. Qualquer falha do CLI delegado = fallback inline imediato, sem retry

Duas categorias distintas de falha, **mesma resposta para ambas**:

### 3.a Negação de permissão pelo classificador de auto-mode

Mesmo com o binário presente, a chamada pode ser **negada em runtime** pela camada de
permissão/classificador de auto-mode do Claude Code — motivo típico é **exfiltração de dados**
(envio de diff ou conteúdo de código confidencial para CLI externo não estabelecido como
confiável).

**Esta não é uma falha transiente de rede; é uma política de segurança.** Não deve ser
retentada.

### 3.b Falha genérica do CLI (encoding, crash, timeout, exit code ≠ 0)

Já observado em produção: uma chamada ao `agy` pode falhar com um erro genérico de encoding
(`proto: field ... contains invalid UTF-8`) ao processar texto em português com acentuação. Isso
não é exclusivo do Gemini — qualquer CLI externo pode falhar de formas imprevisíveis
(encoding, crash, timeout, versão incompatível).

**Regra única para 3.a e 3.b:** qualquer falha do CLI de delegação (exit code ≠ 0, exceção,
negação de permissão, saída vazia/corrompida) — não só ausência do binário — é motivo de
**fallback inline imediato**:

1. **Não retente** — nem o mesmo runtime, nem trocar para outro candidato disponível. A
   simplicidade do "sem retry" evita loops de tentativa em CLIs com falhas erráticas.
2. **Use o fallback inline imediatamente** — monte a descrição, o resumo ou o rascunho
   manualmente usando o template padrão fornecido na skill (ex.: template de PR padrão em §6 do
   `worktree-ship`).
3. **Prossiga sem atraso** — evita I/O desnecessário e mensagens de erro em sessões com
   auto-mode restritivo.

A delegação é **opcional e confortável para falhar**; a tarefa sempre tem um caminho inline
viável.

---

## 4. Tarefas delegáveis (baixo risco, alto volume)

Mesmo contrato de saída independente do runtime escolhido: substitua `$DELEGATE` pelo comando de
invocação do runtime selecionado no passo 2 (tabela do §1).

### 4.1. Resumir logs de CI / build
Antes de diagnosticar uma falha, condense o log bruto para não despejar centenas de
linhas no contexto:

```bash
gh run view <run-id> --log-failed \
  | $DELEGATE "Resuma a causa raiz das falhas neste log de CI em até 15 linhas, citando arquivo:linha quando houver. Não invente; se não houver causa clara, diga isso."
```

O Claude lê o resumo e **decide o fix**. Usado por `worktree-ship` (monitorar CI) e
`fix-loop-agent` (avaliar resultado dos testes).

### 4.2. Rascunhar texto de issues
Em `backlog-ideator`, gere a primeira versão do corpo da issue:

```bash
$DELEGATE "Escreva o corpo de uma issue GitHub (descrição + critério de aceite verificável) para: <tema>. Conciso, em PT-BR."
```

O Claude **revisa e ancora** o rascunho na documentação do projeto antes de criar via
`gh issue create`.

### 4.3. Rascunhar mensagens de commit e relatórios
Mensagens de commit (`fix-loop-agent`, `worktree-ship`) e o relatório do `guardian`:

```bash
git diff --staged | $DELEGATE "Escreva uma mensagem de commit conventional commits (uma linha de subject + corpo opcional) para este diff."
```

O Claude valida o rascunho antes de usar.

### 4.4. Rascunhar corpo/descrição de Pull Request
Em `worktree-ship`, gere a primeira versão da descrição do Pull Request com base no diff acumulado da branch em relação à branch default do projeto:

```bash
git diff "$DEFAULT_BRANCH"...HEAD | $DELEGATE "Escreva uma descrição concisa e estruturada de Pull Request para este diff. Use markdown em PT-BR com seções: 'O que mudou' (tópicos curtos) e 'Como testar'."
```

O Claude **revisa e formata** a descrição antes de passá-la ao comando `gh pr create --body`.

### 4.5. Análise de afinidade e agrupamento de issues
Em `issue-coordinator`, delegue a varredura e o agrupamento preliminar de issues em lote:

```bash
gh issue list --label <label> --state open --json number,title,labels,body \
  | $DELEGATE "Analise estas issues em formato JSON e sugira um agrupamento de afinidade. Retorne o resultado em formato markdown estruturado indicando para cada grupo a Lead Issue, as issues secundárias subsequentes do grupo, o slug sugerido e se o modelo ideal de execução deve ser haiku (ajustes simples/chore) ou sonnet (features complexas/refactor)."
```

O Claude **valida a afinidade**, resolve eventuais erros do rascunho e constrói a tabela final de dispatch.

### 4.6. Geração de Changelog de Sessão
No `issue-coordinator`, delegue a criação do changelog consolidado a partir do histórico de commits da sessão. **Sempre limite o range** (a regra de 100 linhas de `planning-conventions.md` §1.1 vale para histórico de git também) — `origin/main...HEAD` sozinho não é suficiente como limite: uma branch de longa duração e nunca rebaseada pode produzir um range enorme. Use um cap numérico fixo além do range:

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
No `backlog-ideator`, envie arquivos longos de documentação para obter uma síntese executiva de apoio à ideação:

```bash
cat ARCHITECTURE.md docs/*.md | $DELEGATE "Gere um resumo arquitetural consolidado deste projeto contendo os principais padrões de design e módulos, para que um agente possa compreender a estrutura do sistema rapidamente."
```

O Claude **usa este sumário como âncora conceitual** sem precisar ler dezenas de arquivos markdown na íntegra.

---

## 5. Guardrail (invariante — não negociável, independe do runtime)

**NUNCA delegue a nenhum runtime externo:**
- Aplicação de correções de código / geração de diffs (`fix-loop-agent`)
- Resolução de conflitos de merge
- Decisão de fazer (ou não) merge

Essas etapas ficam **sempre** com o Claude. Toda saída delegada é tratada como rascunho
não confiável e **validada pelo Claude antes de qualquer escrita** (commit, push, criação
de PR ou merge). Em caso de dúvida sobre a qualidade do rascunho, descarte-o e faça inline.
