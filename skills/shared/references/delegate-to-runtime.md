# Delegação assistida a runtime externo (opcional, agnóstica de provedor)

Referência compartilhada para economizar tokens delegando tarefas (incluindo mudanças de código
e resolução de conflitos) a um CLI externo de IA. Padrão: **o runtime delegado rascunha, Claude valida.**

Consumida por `ship`, `fix`, `backlog`, `guardian` e
`coordinator`.

Generaliza o antigo acoplamento a um único CLI (`agy` — Google Antigravity/Gemini CLI): a
delegação agora suporta qualquer runtime candidato (Gemini/`agy`, OpenCode/`opencode`,
Codex/`codex`, ou outro CLI futuro), escolhido por disponibilidade no ambiente, preferência
configurada e, quando ambíguo, anuência explícita do usuário (issue #247). O orquestrador MCP
Alethe também é um tipo de runtime de delegação, sem binário no PATH (§6, issue #480).

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
| OpenCode | `opencode` | `opencode run --agent plan "<prompt>"` — mensagem como argumento posicional, não flag `-p` (`-p`/`--password` do OpenCode é autenticação HTTP, não prompt — não confundir com o `-p` do `agy`). Para tarefas via pipe, peça no prompt que a resposta venha somente pelo stdout. | **Confirmado empiricamente**: `echo "MARCADOR-XYZ-123" \| opencode run --model <free> "Repita exatamente o texto que você recebeu via stdin"` devolveu `MARCADOR-XYZ-123` — o conteúdo do pipe chega ao modelo mesmo sem flag dedicada |
| Codex | `codex` | `codex exec -s read-only "<prompt>"` — prompt como argumento posicional; documentado por `codex exec --help` do codex-cli 0.163.0. O help diz: “If stdin is piped and a prompt is also provided, stdin is appended as a `<stdin>` block”; também documenta `-s, --sandbox <read-only\|workspace-write\|danger-full-access>`. | **Confirmado empiricamente** (codex-cli 0.163.0, 2026-10-21): `echo "MARCADOR-VETOR-434-XQ7" \| codex exec -s read-only "Repita exatamente o marcador que você recebeu via stdin, sem mais nada"` devolveu `MARCADOR-VETOR-434-XQ7` no stdout, sem alterar a working tree |

**Limite do agente `plan` do OpenCode:** conforme a documentação de agentes consultada em
2026-10-21, ele recusa edições/escritas fora de `~/.opencode/plan/`, mas **não restringe comandos
shell**. Essa configuração reduz a possibilidade de o runtime escrever diretamente na working
tree, mas não é um sandbox para comandos shell; continue tratando toda saída como rascunho e
validando-a conforme §5. Verificado em 2026-10-21 (opencode 1.19.0): a tarefa do §4.8 com
`--agent plan` deixou `git status --porcelain` inalterado e o resumo chegou pelo stdout — sem o
`--agent plan`, o mesmo comando gravou o resultado num arquivo novo na raiz do repositório (#431).
A mesma documentação diz que os defaults do `plan` são aplicados **antes** da config `permission`
de topo do usuário: um `"edit": "allow"` (ou `"*": "allow"`) global anula essa restrição. Por isso,
compare `git status --porcelain` antes e depois de cada delegação ao OpenCode; se mudou, descarte o
resultado, desfaça o que o runtime gravou e siga inline (§3).

**Regra:** um runtime com consumo de stdin **não confirmado** nunca deve ser usado para as tarefas
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

(Exemplo mostra `opencode`; `codex` também tem stdin confirmado empiricamente para as tarefas de §4.
Se preferir `agy`, consulte a linha da tabela do §1 para limitações e alternativas.)

O valor `"alethe"` também é aceito em `delegation.preferredRuntime`: ele seleciona o orquestrador MCP
do §6, detectado pelo namespace `mcp__alethe__*` e não por `command -v`. O Alethe não consome pipe,
então as tarefas do §4 continuam nos CLIs.

Ausência do bloco `delegation` (ou do `config.json` inteiro) nunca é erro — mesmo contrato do
bloco `knowledge` (ver `skills/install/SKILL.md`).

## 2. Algoritmo de seleção

Com `available` (lista detectada) e `preferred` (config, pode ser `null`):

1. **`available` vazio** (e `preferred` não é um runtime MCP detectado, passo 2) → siga **inline**.
   Nunca falhe nem peça instalação — a delegação é
   puramente opcional.
2. **`preferred` configurado:**
   - Se `preferred` é um runtime MCP detectado na sessão (hoje `alethe`, §6.1) → delegue para ele,
     sem buscar binário no PATH. Runtimes MCP nunca entram na escolha sem preferência: não contam
     como candidatos nos passos 3 e 4.
   - Se `preferred` está em `available` → delegue para `preferred`.
   - Se `preferred` **não** está em `available` → siga **inline**. Nunca substitua
     silenciosamente por outro candidato disponível: o usuário consentiu com um runtime
     específico, não com "qualquer um" (issue #247 — "nenhum runtime é assumido como
     padrão/preferencial sem configuração ou anuência").
3. **Sem `preferred`, `available` com exatamente 1 candidato** → delegue para ele. Não há
   ambiguidade entre runtimes a resolver, então não é necessário perguntar (a anuência explícita
   só é exigida "quando houver mais de um runtime viável e nenhuma preferência registrada").
4. **Sem `preferred`, `available` com 2+ candidatos (ambíguo):**
   - **Sessão interativa** (há interlocutor, ex.: `coordinator` fora de `--headless`):
     pergunte ao usuário qual runtime usar (mecanismo de seleção interativa da skill, quando
     disponível). Ofereça salvar a escolha em `delegation.preferredRuntime` para não perguntar de
     novo.
   - **Sessão headless** (`fix`, `issue-worker`, `guardian`, `backlog` sem
     interlocutor): **critério de desempate documentado é sempre inline** — nunca escolha
     silenciosamente entre candidatos não consentidos. Isso é intencional mesmo que sacrifique
     uma oportunidade de economia de tokens: é o preço de não assumir uma preferência que
     ninguém configurou.

Lógica de referência (implementada e testada em `scripts/lib/delegation-runtime.ts`,
`scripts/tests/delegation-runtime_test.ts`):

```ts
selectDelegationRuntime({ available, mcpAvailable, preferred, interactive });
// => { action: "inline" | "delegate" | "ask", runtime?, reason }
```

`mcpAvailable` (opcional) lista os runtimes MCP que a skill detectou no namespace de ferramentas, por
exemplo `["alethe"]`. A função não procura binário para eles e só os escolhe quando coincidem com
`preferred`.

Skills que rodam em Deno podem importar a função diretamente; skills descritas só em markdown
devem seguir o mesmo algoritmo em prosa (passos 1-4 acima).

Antes de rodar o comando de delegação escolhido, **sempre imprima um log explícito no console**:
`echo "[Vetor:Delegação] Delegando tarefa a <runtime>: <breve descrição>"`.

### 2.1 Acordo de escopo e anuência prévia (novo passo antes de delegar)

A proibição categórica de delegar mudanças de código está aposentada (issue #415). Antes de disparar qualquer execução delegada para o runtime selecionado, o agente **deve propor ao desenvolvedor o escopo da delegação**:

1. **O que vai para o runtime:** qual tarefa, diff ou trecho de implementação o runtime externo irá produzir.
2. **O que fica com o agente:** controle do worktree, coordenação, garantia dos testes e decisão de commit/merge.
3. **Como o resultado será validado:** quais testes automatizados (do `module-test-map.md`) serão executados e qual inspeção de diff será feita antes de qualquer escrita.

**Regra de anuência:**
- **Sessão interativa:** o agente propõe o escopo e **só delega após anuência explícita do desenvolvedor**. Se o desenvolvedor rejeitar ou preferir não delegar, execute inline.
- **Sessão `--headless`:** na ausência de interlocutor para anuir o escopo proposto, **segue inline por padrão**. A delegação nunca é assumida tacitamente em modo não-supervisionado.

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
   `ship`).
3. **Prossiga sem atraso** — evita I/O desnecessário e mensagens de erro em sessões com
   auto-mode restritivo.

A delegação é **opcional e confortável para falhar**; a tarefa sempre tem um caminho inline
viável.

---

## 4. Exemplos de tarefas delegáveis (ilustrativos, não exaustivos)

A lista a seguir é **ilustrativa e aberta** (issue #415): com a aposentadoria da proibição categórica
de delegar mudanças de código, qualquer tarefa — de condensação de texto e logs a alterações de código
e conciliação de conflitos — pode ser delegada, desde que o escopo tenha anuência prévia do desenvolvedor
(§2.1), o resultado seja tratado como rascunho e validado pelo agente antes da escrita.

Mesmo contrato de saída independente do runtime escolhido: substitua `$DELEGATE` pelo comando de
invocação do runtime selecionado no passo 2 (tabela do §1). Para OpenCode, `$DELEGATE` é
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

O Claude **revisa e formata** a descrição antes de passá-la ao comando `gh pr create --body`.

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

---

## 5. Guardrail (invariante — não negociável, independe do runtime)

**NUNCA delegue a nenhum runtime externo:**
- Decisão de fazer (ou não) merge

A decisão de fazer (ou não) merge continua **sempre** com o agente e o desenvolvedor, nunca com o
runtime delegado. Toda saída delegada continua sendo tratada como **rascunho não confiável** e
**validada pelo agente antes de qualquer escrita** (commit, push, criação de PR ou merge). Em caso
de dúvida sobre a qualidade do rascunho ou falha na validação dos testes, descarte-o e faça inline.


---

## 6. Delegação ao Orquestrador MCP (Alethe)

A delegação síncrona (§1-§4) serve a tarefas pontuais de texto em pipe. Para **tarefas completas de
desenvolvimento, ondas de issues e geração de código com múltiplos arquivos**, o Alethe, um
orquestrador acessado por ferramentas MCP, é um tipo de runtime (`mcp`) ao lado dos CLIs do §1. Ele
não é um binário no PATH: a disponibilidade vem do namespace de ferramentas (issues #451, #480 e
#482; código em `scripts/lib/orchestrator/`).

**Fonte e validade dos fatos:** salvo indicação, o que segue vem da sonda real ao Alethe em
2026-10-23 (job-67) e do schema das ferramentas MCP naquela data. Cada limite traz a sua fonte e
data. Os fatos rotulados "observado" são empíricos: não são garantias universais do serviço e podem
mudar entre versões ou sessões.

### 6.1. Detecção e seleção

- **Sinal único:** existência de ferramenta `mcp__alethe__*` na lista de ferramentas da sessão
  (`mcp-availability.md`, seção "Orquestrador de agentes (Alethe)"); em código,
  `OrchestratorRegistry.detectAvailable({ tools })`. Zero I/O de shell ou rede.
- **Sem sinal fora do harness:** nenhuma variável de ambiente do Alethe foi observada num worker
  Codex do Alethe em 2026-10-23, então variáveis de ambiente não indicam presença do orquestrador e
  `scripts/now-probe.ts` não o detecta.
- **Preferência:** `alethe` é aceito em `delegation.preferredRuntime` de `.claude/vetor/config.json`:
  ```json
  { "delegation": { "preferredRuntime": "alethe" } }
  ```
  A skill informa `mcpAvailable: ["alethe"]` ao `selectDelegationRuntime` quando `mcp__alethe__*`
  está ativo. Sem a preferência, `selectDelegationRuntime` nunca escolhe o orquestrador em silêncio.
  Com a preferência e sem `mcp__alethe__*` na sessão, o fluxo segue inline: nunca se substitui por
  outro runtime (§2).
- **Escopo e anuência:** o acordo de escopo do §2.1 vale para o Alethe. As tarefas pipe do §4 não se
  aplicam a ele; continuam nos CLIs.

### 6.2. Ferramentas (schema observado em 2026-10-23, job-67)

| Ferramenta | Argumentos | Resposta |
|---|---|---|
| `alethe_delegate` | `{ tasks: string[], agent, cwd, isolate, label, askForApproval, timeoutSeconds, webSearch }` | `{ accepted, runId, runningInParallel, concurrencyLimit, isolated, timeoutSeconds, jobs: [{ id, spec, worktree }], next }` |
| `alethe_check` | `{ wait, timeoutMs, untilAllSettled }` | `{ deliveries: [{ seq, type: 'worker_done', jobId, outcome: 'succeeded', text }], workersStillBusy, note }` |
| `alethe_release` | `{ jobIds: string[] }` | `{ released: [ids] }` |
| `alethe_cancel` | `{ jobIds: string[] }` | não observada |

O id de cada job está em `jobs[].id`. O `alethe_check` é global à sessão e entrega cada resultado uma
única vez. O adaptador `AletheAdapter` (`scripts/lib/orchestrator/adapters/alethe.ts`) implementa
essas chamadas; as skills em markdown chamam as ferramentas MCP diretamente.

### 6.3. Contrato prático

| # | Regra | Fonte e data |
|---|---|---|
| 1 | **Uma chamada `alethe_delegate` por grupo.** O `cwd` vale para a chamada inteira e é o worktree do grupo: passe-o sempre. Sem `cwd`, o Alethe usa o próprio diretório e `isolate: true` falha com `isolate needs a git repository`. | `cwd` por chamada: spike #451 §3.1 (sessão de 2026-10-21). Falha sem `cwd`: observado na sonda de 2026-10-23 (job-67). |
| 2 | **Concorrência:** use o `concurrencyLimit` devolvido por `alethe_delegate`; não fixe um número. Despache até o limite e, atingido, aguarde uma vaga com `alethe_check` antes do próximo grupo, sem fila própria. | Valor 4 observado na sonda de 2026-10-23 (job-67); pode variar por sessão. A espera por vaga é escolha do contrato (Spec de 2026-10-23), sem fonte externa. |
| 3 | **Tarefa autocontida:** `tasks` leva o texto integral da issue (corpo e critérios de aceite), os comandos de teste do `module-test-map` e as proibições da regra 4. | Spike #451 §4.3 item 2 (2026-10-22); Spec do contrato (2026-10-23). |
| 4 | **Proibido no worker:** git que escreva (`checkout`, `add`, `commit`, `push`), `gh`, rede e editar o status file. | Spike #451 §3.1 (sessão de 2026-10-21); decisão do mantenedor de 2026-10-23. |
| 5 | **Suítes e testes empíricos rodam no host.** Relatórios de teste do worker são informativos. | O sandbox do Codex observado não roda git (`dubious ownership`); o worker relatou 35 falhas que não se repetiram no host (413 a 420 testes verdes), spike #451 §3.1 item 2 (sessão de 2026-10-21). |
| 6 | **`alethe_check` com `timeoutMs <= 50000`.** Guarde as entregas de outros jobs, que o `alethe_check` não repete. | Esperas de 90 s ou mais estouraram o timeout MCP e perderam entregas; com 50 s não houve falha (spike #451 §3.1 item 3, sessão de 2026-10-21). Entrega única: sonda de 2026-10-23. |
| 7 | **`alethe_release` antes de remover o worktree** (`safe-remove-worktree` ou `git worktree remove`). | Sem o release, `git worktree remove` falhou com `Permission denied` no Windows (observado em 2026-10-22); a sessão de 2026-10-21 registrou "Device or resource busy" (spike #451 §3.1 item 6). |
| 8 | **O diff é rascunho:** o coordinator o revisa e o escaneia antes de qualquer commit; descarte o que falhar. | Defeitos observados na revisão da sessão de 2026-10-21 (spike #451 §3.1 item 4). |
| 9 | **Entrega vazia não é sucesso.** Quando o Codex atinge o limite de uso, o Alethe devolve `outcome: succeeded` com `text` vazio e `tokens: null`. Trate como falha e diagnostique com `codex exec` no host (§1). | Observado em 2026-10-23. |
| 10 | **Sem retry automático:** falha de dispatch ou de check, ou entrega vazia, é reportada ao coordinator; descarte o rascunho e siga nativo/inline (§3). | Escolha do contrato (Spec de 2026-10-23), a mesma política do §3. |

### 6.4. Fluxo

1. Detecte o namespace e selecione o runtime (§6.1); obtenha a anuência de escopo (§2.1).
2. Para cada grupo, crie o worktree (`worktree-create`) e chame `alethe_delegate` uma vez, com o
   worktree como `cwd`.
3. Recolha os resultados com `alethe_check` (regras 2 e 6) até cada job entregar `worker_done`.
4. Revise o diff, escaneie o rascunho e rode os testes mapeados no host (regras 5 e 8). O status
   file continua sendo mantido pelo coordinator.
5. Chame `alethe_release` para o job e só então remova o worktree (regra 7). `alethe_cancel`
   interrompe um job que não deve terminar.
