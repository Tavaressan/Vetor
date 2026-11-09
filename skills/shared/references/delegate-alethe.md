# Delegação ao orquestrador MCP Alethe

> Lida só quando o Alethe é o runtime selecionado (`delegation.preferredRuntime: "alethe"` e
> `mcp__alethe__*` na sessão).
Paths relativos e `$SKILL_DIR` aqui resolvem a partir do diretório da skill que leu esta
> referência. Seleção, anuência (§2.1), fallback (§3) e guardrail (§5): `delegate-to-runtime.md`.

## 6. Contrato

A delegação síncrona por CLI (`delegate-to-runtime.md` §1-§3 e `delegate-tasks.md`) serve a tarefas pontuais de texto em pipe. Para **tarefas completas de
desenvolvimento, ondas de issues e geração de código com múltiplos arquivos**, o Alethe, um
orquestrador acessado por ferramentas MCP, é um tipo de runtime (`mcp`) ao lado dos CLIs. Ele
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
  outro runtime (`delegate-to-runtime.md` §2).
- **Escopo e anuência:** o acordo de escopo do §2.1 vale para o Alethe. As tarefas pipe de `delegate-tasks.md` não se
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
| 1 | **Uma chamada `alethe_delegate` por grupo.** O `cwd` vale para a chamada inteira e é o worktree do grupo: passe-o sempre. Sem `cwd`, o Alethe usa o próprio diretório e `isolate: true` falha com `isolate needs a git repository`. **`isolate`:** com `cwd` num worktree do Vetor, use `isolate: false`, e o job roda nesse diretório. Com `isolate: true` o Alethe cria `.alethe/worktrees/job-N` com a branch `alethe/agent-job-N`, que exige `git worktree remove` e `git branch -d` depois do `alethe_release`. Use `isolate: true` só em tarefa sem worktree próprio (ex.: rascunho de Spec). | `cwd` por chamada: spike #451 §3.1 (sessão de 2026-10-21). Falha sem `cwd`: observado na sonda de 2026-10-23 (job-67). `isolate`: observado em 2026-10-23 (`cwd` num worktree do coordinator: com `isolate: false` o job rodou nesse diretório; com `isolate: true` o Alethe criou `.alethe/worktrees/job-N` e a branch `alethe/agent-job-N`). A escolha de `false` com worktree do Vetor é do contrato (issue #504). |
| 2 | **Concorrência:** use o `concurrencyLimit` devolvido por `alethe_delegate`; não fixe um número. Despache até o limite e, atingido, aguarde uma vaga com `alethe_check` antes do próximo grupo, sem fila própria. | Valor 4 observado na sonda de 2026-10-23 (job-67); pode variar por sessão. A espera por vaga é escolha do contrato (Spec de 2026-10-23), sem fonte externa. |
| 3 | **Tarefa autocontida:** `tasks` leva o texto integral da issue (corpo e critérios de aceite), os comandos de teste do `module-test-map` e as proibições da regra 4. | Spike #451 §4.3 item 2 (2026-10-22); Spec do contrato (2026-10-23). |
| 4 | **Proibido no worker:** git que escreva (`checkout`, `add`, `commit`, `push`), `gh`, rede e editar o status file. | Spike #451 §3.1 (sessão de 2026-10-21); decisão do mantenedor de 2026-10-23. |
| 5 | **Suítes e testes empíricos rodam no host.** Relatórios de teste do worker são informativos. | O sandbox do Codex observado não roda git (`dubious ownership`); o worker relatou 35 falhas que não se repetiram no host (413 a 420 testes verdes), spike #451 §3.1 item 2 (sessão de 2026-10-21). |
| 6 | **`alethe_check` com `timeoutMs <= 50000`.** Guarde as entregas de outros jobs, que o `alethe_check` não repete. | Esperas de 90 s ou mais estouraram o timeout MCP e perderam entregas; com 50 s não houve falha (spike #451 §3.1 item 3, sessão de 2026-10-21). Entrega única: sonda de 2026-10-23. |
| 7 | **`alethe_release` antes de remover o worktree** (`safe-remove-worktree` ou `git worktree remove`). | Sem o release, `git worktree remove` falhou com `Permission denied` no Windows (observado em 2026-10-22); a sessão de 2026-10-21 registrou "Device or resource busy" (spike #451 §3.1 item 6). |
| 8 | **O diff é rascunho:** o coordinator o revisa e executa a varredura obrigatória `deno run -A "$SKILL_DIR/../../scripts/draft-scan.ts" --base <ref>` (ou `<arquivo...>`) antes de qualquer commit; sem `--base` a regra de JSDoc removido não roda, por não haver base. Execute-a de dentro do worktree do grupo, pois a CLI localiza o repositório pelo diretório atual: use `--base HEAD` quando o worker não commita e `--base $(git merge-base HEAD "$DEFAULT_BRANCH")` quando há commits. Saída 0 = limpo; 1 = achados, cada um como `arquivo:linha`; 2 = falha da varredura, que nunca vale como limpo. Descarte ou corrija o que falhar. | Defeitos observados na revisão da sessão de 2026-10-21 (spike #451 §3.1 item 4). `grep -P` no Git Bash falhou com `supports only unibyte and UTF-8 locales` e, com stderr redirecionado, pareceu limpo (observado em 2026-10-23): por isso a varredura é uma CLI própria, issue #483. |
| 9 | **Entrega vazia não é sucesso.** Quando o Codex atinge o limite de uso, o Alethe devolve `outcome: succeeded` com `text` vazio e `tokens: null`. Trate como falha e diagnostique com `codex exec` no host (`delegate-runtime-codex.md`). | Observado em 2026-10-23. |
| 10 | **Sem retry automático:** falha de dispatch ou de check, ou entrega vazia, é reportada ao coordinator; descarte o rascunho e siga nativo/inline (`delegate-to-runtime.md` §3). | Escolha do contrato (Spec de 2026-10-23), a mesma política de `delegate-to-runtime.md` §3. |

### 6.4. Fluxo

1. Detecte o namespace e selecione o runtime (§6.1); obtenha a anuência de escopo (`delegate-to-runtime.md` §2.1).
2. Para cada grupo, crie o worktree (`worktree-create`) e chame `alethe_delegate` uma vez, com o
   worktree como `cwd`.
3. Recolha os resultados com `alethe_check` (regras 2 e 6) até cada job entregar `worker_done`.
4. Revise o diff, execute a varredura `draft-scan.ts` e rode os testes mapeados no host (regras 5
   e 8). A varredura cobre bytes de controle fora de TAB, LF e CR, BOM, mojibake (U+00C3 seguido de
   continuação, U+00E2 U+20AC e U+FFFD), UTF-8 inválido, acento trocado por `?` no meio da palavra,
   a sequência `` `n `` em Markdown, `declare -A` em `.sh` e JSDoc removido em `.ts` em relação à
   base. Os blocos de JSDoc são comparados pelo símbolo documentado (a primeira linha de código depois
   do bloco): acusa o símbolo que a base documentava, que o rascunho ainda declara e não documenta.
   **Limitações conhecidas** (issue #504), a conferir no diff:
   - Apagar ou renomear o símbolo não acusa, porque o nome documentado na base deixa de ser
     declarado: renomear e descartar o JSDoc na mesma mudança passa despercebido.
   - Blocos de membros e cabeçalhos de módulo são comparados só por contagem, por não terem
     declaração nomeada para comparar; apagar um membro com o seu JSDoc acusa.
   - Um arquivo renomeado ou movido aparece como novo (`--no-renames`), sem comparação de JSDoc
     com o arquivo de origem.
   - Só vale para `.ts`, `.tsx`, `.js` e `.jsx`.

   O status file continua sendo mantido pelo coordinator.
5. Chame `alethe_release` para o job e só então remova o worktree (regra 7). `alethe_cancel`
   interrompe um job que não deve terminar.
