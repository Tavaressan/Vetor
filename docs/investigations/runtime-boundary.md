# Investigação: fronteira entre núcleo, adapters, delegação a CLI e harness

**Issue:** #586 — spike(architecture): fronteira entre núcleo, adapters, delegação a CLI e harness
**Data:** 2026-11-09
**Base:** `master` em `f6ab98f`
**Contexto:** ADR-001 (`docs/adr/ADR-001-runtime-independence.md`), INV-001 (P0), §5, §6.4. A matriz de
capacidades é a da #568 (`skills/shared/references/harness-capabilities.md` e
`wiki/Contrato-de-Capacidades.md`), usada aqui sem redefinição.

**Rótulos:** **[Fato]** verificado na fonte citada ou em comando registrado · **[Inferência]** conclusão
derivada dos fatos · **[Opinião]** juízo técnico.

---

## 1. Pergunta

A ADR-001 separa quatro donos de responsabilidade: o **núcleo** do Vetor, os **adapters de
orquestrador**, a **delegação a CLIs** e o **harness** que carrega skills, hooks e ferramentas. O spike
responde:

1. Quais componentes de `scripts/` e `skills/` dependem do harness atual, e de qual capacidade?
2. Quais APIs de `scripts/lib/` já funcionam sozinhas, chamadas por `deno run`, sem harness?
3. Onde há responsabilidade duplicada entre o coordinator, `delegation-runtime.ts`, `orchestrator/` e
   os scripts de worktree?
4. O que falta para executar os fluxos suportados sem orquestrador externo, só com o núcleo
   obrigatório (ler, editar, rodar shell)?

## 2. Resumo

- **[Fato]** Os 15 pontos de entrada testados de `scripts/` rodam com `env -i PATH=… HOME=…`, sem nenhuma variável do
  harness (§3.2). O núcleo determinístico já é independente do harness.
- **[Fato]** O acoplamento ao harness está em três lugares: (a) o **formato do stdin** de cinco scripts
  de hook; (b) a **guarda de escrita por `agent_type`** do `safety-check.ts`, que só existe no Claude
  Code; (c) as **skills de orquestração** (`coordinator`, `ship`, e as referências de dispatch), que
  usam subagentes, isolamento e background, todos com fallback declarado na #568.
- **[Fato]** `OrchestratorRegistry`, `AletheAdapter` e `selectDelegationRuntime` **não têm nenhum
  consumidor em produção**: só os testes os importam (§3.3). O agente aplica a mesma lógica lendo o
  Markdown de `delegate-alethe.md` e `delegate-to-runtime.md`. O código é uma especificação executável,
  não um runtime.
- **[Fato]** O `ToolCaller` do `OrchestratorAdapter` chama ferramentas MCP, que só o harness alcança. Um
  `deno run` não consegue despachar para o Alethe. **MCP é uma capacidade do harness que não aparece na
  matriz da #568.**
- **[Fato]** Há três criadores de worktree com regras de branch diferentes (§3.4) e duas regras de
  seleção de orquestrador idênticas em módulos diferentes.
- **[Opinião]** A principal lacuna para execução standalone não é de código de núcleo, e sim a falta de
  um **executor de workers por processo do SO**. Hoje o fallback de subagentes é uma frase em
  `harness-capabilities.md` §2.1, sem script que lance, acompanhe e encerre os processos.

## 3. Evidências

### 3.1 Tabela de pertencimento

Legenda da coluna **Dono**: **Núcleo** (roda só com ler, editar e shell); **Adapter** (orquestrador
externo); **CLI** (delegação síncrona a um CLI de agente); **Harness** (só existe porque o harness
oferece a capacidade). **Capacidade do harness** usa os nomes da #568 (`subagents`, `hooks`,
`worktree-isolation`, `questions`, `background`, `scheduling`) mais `mcp`, que falta lá.

#### Scripts e bibliotecas

| Componente | Dono | Capacidade do harness | Fonte |
| --- | --- | --- | --- |
| `scripts/lib/*.ts` (exceto `orchestrator/` e `delegation-runtime.ts`) | Núcleo | nenhuma | nenhuma importação de API de harness; testes em `deno task test` |
| `scripts/lib/orchestrator/{dispatch-prompt,context-packet,micro-spec}.ts` | Núcleo | nenhuma | importados por `scripts/dispatch-prompt.ts:14-34` e `scripts/context-packet.ts:28-37`; montam o prompt também do dispatch nativo |
| `scripts/lib/orchestrator/{types,registry}.ts` | Adapter | `mcp` (pelo `ToolCaller`) | `types.ts:81` (`ToolCaller`), `types.ts:91` (`tools: string[]` do namespace MCP) |
| `scripts/lib/orchestrator/adapters/alethe.ts` | Adapter | `mcp` | chama `mcp__alethe__alethe_*` (`alethe.ts:71,104,145,155`) |
| `scripts/lib/delegation-runtime.ts` | CLI (e, pelo `mcpAvailable`, Adapter) | nenhuma para CLI; `mcp` para Alethe | `delegation-runtime.ts:20-24,43-48` |
| `scripts/safety-check.ts` | Núcleo (política) + Harness (entrada) | `hooks` (`PreToolUse` com `tool_input`, `agent_type`) | `safety-check.ts:49,166-197,222`; `hooks/hooks.json` |
| `scripts/safety-check-antigravity.ts` | Harness (tradutor) | `hooks` (`PreToolUse` de `run_command`) | cabeçalho do arquivo; reusa `lib/safety-policy.ts` |
| `opencode/plugin/vetor.ts` | Harness (tradutor) | `hooks` (plugin `tool.execute.*`) | cabeçalho do arquivo; reusa `safety-check.ts` e `check-edit.ts` |
| `scripts/check-edit.ts` | Núcleo (checagem) + Harness (entrada) | `hooks` (`PostToolUse`, stdin `tool_input`) | `hooks/hooks.json`; sem modo `--path` |
| `scripts/check-status.ts` | Harness | `hooks` (`SubagentStop`, matcher `vetor:issue-worker`) | `hooks/hooks.json`; equivalente portátil: `vetor-checks.sh verify-status` |
| `scripts/session-check.ts` / `.sh` | Harness | `hooks` (`SessionStart`, `hookSpecificOutput`) | `session-check.sh:9-23`; equivalente portátil: `/vetor:now` |
| `scripts/prepare-worktree.ts` (modo hook) | Harness | `hooks` (`WorktreeCreate`) + `worktree-isolation` | `prepare-worktree.ts:3-11,138-182` |
| `scripts/prepare-worktree.ts --path` | Núcleo | nenhuma | `prepare-worktree.ts:124-135`; medido em §3.2 |
| `scripts/prewarm-worktrees.ts` | Núcleo | nenhuma (o consumidor é o dispatch por subagente) | `prewarm-worktrees.ts:196-230` |
| `scripts/vetor-checks.sh`, `vetor-status.sh`, `vetor-merge.sh` | Núcleo | nenhuma | `bash`, `git`, `gh`; medidos em §3.2 |
| demais `scripts/*.ts` (`repo-map`, `disjoint-check`, `guardian-audit`, `spec-validate`, `now-probe`, `stalled-workers`, `detect-*`, `draft-scan`, `decision-inbox`, `knowledge-doc`, `skill-budget`…) | Núcleo | nenhuma | entrada por args (`Deno.args`); §3.2 |
| `cli/` (instalador `vetor`) | Núcleo (distribuição) | nenhuma; escreve config de cada harness | `cli/lib/installer/` |

#### Skills

O campo `compatibility` de cada `SKILL.md` já declara a dependência (#568). A tabela confere a
declaração contra o texto da skill e de suas referências, pela contagem das ferramentas citadas
(comando em §3.5).

| Skill | Dono | Capacidades citadas no texto | `compatibility` confere? |
| --- | --- | --- | --- |
| `backlog-ideator`, `design`, `fix-loop-agent`, `issue-coordinator`, `stack-practices`, `vetor`, `worktree-ship` | Núcleo | nenhuma | sim |
| `backlog`, `now`, `spec`, `install` | Núcleo | `questions` | sim |
| `fix` | Núcleo | `hooks` | sim |
| `guardian` | Núcleo | `questions`, `scheduling` (`CronCreate`) | sim |
| `architecture-review` | Núcleo | `subagents` (`Agent(`), `scheduling` (`CronCreate`) | **parcial**: declara subagentes e perguntas, não agendamento |
| `worktree-create` | Núcleo | `hooks`, `worktree-isolation` (citada para dizer que o coordinator não a usa) | sim |
| `ship` | Núcleo + Harness | `subagents`, `questions`, `background` (`Monitor`), `EnterWorktree` | sim |
| `coordinator` (+ `shared/references/issue-coordinator-*.md`, `worktree-prewarm.md`) | Núcleo + Harness | `subagents` (≥ 22 `Agent(`), `worktree-isolation`, `questions`, `background`, `SendMessage`, `EnterWorktree` | sim |
| `shared/references/delegate-alethe.md`, `external-dispatch.md` | Adapter | `mcp` | **não declarado** em nenhuma matriz |
| `shared/references/delegate-to-runtime.md`, `delegate-runtime-*.md`, `delegate-tasks.md` | CLI | nenhuma (shell) | sim |

### 3.2 Scripts sem harness (pergunta 2)

Cada script rodou em `env -i PATH="$PATH" HOME="$HOME"`, com stdin vazio, a partir deste worktree:

```text
[0] 112ms  deno run -A scripts/detect-project.ts
[0]   8ms  bash scripts/vetor-checks.sh repo-root
[0]  10ms  bash scripts/vetor-checks.sh in-worktree
[0]  25ms  deno run -A scripts/stalled-workers.ts
[0] 899ms  deno run -A scripts/now-probe.ts
[2]  39ms  deno run -A scripts/disjoint-check.ts            (uso: precisa de args)
[2]  19ms  deno run -A scripts/detect-infra-failure.ts      (uso: <run-id>)
[2]  28ms  deno run -A scripts/repo-map.ts --help           (uso impresso)
[2]  23ms  deno run -A scripts/guardian-audit.ts --help     (uso impresso)
[1]  21ms  deno run -A scripts/spec-validate.ts             (uso: <path>)
[0] 133ms  deno run -A scripts/skill-budget.ts
[0]  16ms  bash scripts/vetor-status.sh
[0]  30ms  deno run -A scripts/prepare-worktree.ts --path . --source .
[0]  22ms  deno run -A scripts/check-status.ts              (stdin vazio: sai sem agir)
[0]  22ms  deno run -A scripts/session-check.ts             (stdin vazio: sai sem agir)
```

**[Fato]** Nenhum script falhou por falta de variável do harness. Os que saíram com código 1 ou 2
imprimiram o uso por falta de argumento obrigatório. Os cinco scripts de hook (`check-edit`,
`check-status`, `safety-check`, `session-check`, `prepare-worktree` sem `--path`) leem o evento do
stdin. Sem payload, os três primeiros saem sem agir, então só fazem sentido como hook.

**[Fato]** O `${CLAUDE_PLUGIN_ROOT}` só aparece em `hooks/hooks.json`, e o `${PLUGIN_ROOT}` só em
`hooks/hooks-codex.json`. Nenhum script lê essas variáveis.

**[Fato]** O estado do Vetor fica em `.claude/vetor/` e `.claude/worktrees/` em todos os harnesses
(`grep` em §3.5). Isso é só um nome de diretório: nenhum harness lê esses caminhos.

### 3.3 Código de adapter sem consumidor em produção

```sh
grep -rn "selectDelegationRuntime\|AletheAdapter\|OrchestratorRegistry\|createDefaultOrchestratorRegistry" \
  scripts cli --include=*.ts --include=*.js | grep -v tests/ \
  | grep -v "^scripts/lib/orchestrator\|^scripts/lib/delegation-runtime"
# (saída vazia)
```

**[Fato]** Fora da própria definição, os três só aparecem nos testes (`delegation-runtime_test.ts`,
`orchestrator-adapters_test.ts`, `orchestrator-registry_test.ts`). As skills os citam como
"implementado e testado" (`delegate-to-runtime.md:70`, `delegate-alethe.md:25,33,50`), e o agente
reproduz a decisão a partir do texto.

**[Inferência]** É coerente com o desenho atual: o `ToolCaller` precisa chamar MCP, e só o agente
dentro do harness consegue. Um script Deno não tem como executar o `AletheAdapter`. Logo, o contrato
`OrchestratorAdapter` hoje define o protocolo, mas quem o executa é o modelo.

### 3.4 Duplicações (pergunta 3)

| # | Responsabilidade | Implementações | Diferença observada |
| --- | --- | --- | --- |
| D1 | Criar worktree | `prepare-worktree.ts` (hook, `:160-176`), `prewarm-worktrees.ts` (`:196-230`), skill `worktree-create` (`SKILL.md:98-152`, shell no Markdown) | Branch: o hook usa `branch = name` (sem tipo); o prewarm e a skill usam `<type>/<issue#>-<slug>`. Base: o hook usa a branch default **local** (`:160-165`); a skill faz `pull` e cai para `origin/<default>`; o prewarm resolve `base` por args. Só o prewarm e a skill recusam path ou branch existentes; o hook faz checkout da branch existente (`:166-171`). |
| D2 | Seleção de orquestrador por preferência (#504) | `OrchestratorRegistry.select` (`registry.ts:68-98`) e `selectDelegationRuntime` com `mcpAvailable` (`delegation-runtime.ts:38-60`) | Mesma regra (só com preferência, nunca em silêncio) escrita duas vezes, com nomes de config diferentes nos comentários (`delegation.preferredRuntime` em ambos, mas `OrchestratorConfig.preferred` em `types.ts:169`). |
| D3 | Detecção de disponibilidade do Alethe | `AletheAdapter.isAvailable` (`alethe.ts:51-55`), `mcp-availability.md:139`, `delegate-alethe.md:25-34` | O mesmo teste (`mcp__alethe__*`) descrito em código e em duas referências. |
| D4 | Guarda de segurança por harness | `safety-check.ts` (Claude Code/Codex), `safety-check-antigravity.ts`, `opencode/plugin/vetor.ts` | **Não é duplicação de lógica**: os três traduzem o payload e chamam `lib/safety-policy.ts`. Fica como referência do padrão certo. |
| D5 | Verificação de status terminal | `check-status.ts` (hook `SubagentStop`) e `vetor-checks.sh verify-status` | Dois pontos de entrada para a mesma regra. A #559 já fez do `verify-status` o último passo do worker. |
| D6 | Módulos de núcleo dentro de `orchestrator/` | `dispatch-prompt.ts`, `context-packet.ts`, `micro-spec.ts` | Servem ao dispatch nativo também. O diretório sugere que são do adapter. |

### 3.5 Comandos de coleta

```sh
# capacidades citadas por skill (inclui references/ da skill)
for s in skills/*/SKILL.md; do
  cat "$(dirname "$s")"/SKILL.md "$(dirname "$s")"/references/*.md 2>/dev/null \
    | grep -oE "Agent\(|AskUserQuestion|isolation: ?\"?worktree|run_in_background|Monitor|SendMessage|CronCreate|subagent_type|EnterWorktree" \
    | sort | uniq -c
done
# sinais de acoplamento por script
grep -oE "CLAUDE_[A-Z_]+|PLUGIN_ROOT|agent_type|tool_input|Deno\.stdin|\.claude/[a-z/_-]+" scripts/*.ts
# pontos de entrada
grep -c "import.meta.main\|Deno.stdin\|Deno.args" scripts/*.ts
```

## 4. Lacunas para execução standalone (pergunta 4), priorizadas

"Standalone" aqui é o fluxo `backlog → spec → worktree → fix → ship → merge` rodando só com ler,
editar e shell, num harness qualquer e sem orquestrador externo.

| Prioridade | Lacuna | Hoje | Impacto sem a capacidade |
| --- | --- | --- | --- |
| **P0** | Executor de workers por processo do SO | `harness-capabilities.md` §2.1 descreve `opencode run --dir <wt> … &` e "acompanhe pelo status file", mas nenhum script lança, registra PID, aplica timeout ou encerra workers | Sem subagentes, o coordinator serializa ou o agente improvisa o `&` no shell, sem limpeza nem teto. É o caso de uso concreto para a #582 (supervisão de processo em Deno). |
| **P0** | MCP fora da matriz de capacidades | `harness-capabilities.md` §2 tem 6 capacidades opcionais; o Alethe depende de uma sétima | A seleção de orquestrador supõe uma capacidade que nenhum documento de compatibilidade declara por harness |
| **P1** | Guarda de escrita fora do worktree sem `agent_type` | `safety-check.ts:166-197` só bloqueia com `agent_type` de `vetor:issue-worker` (Claude Code) ou `--strict-worktree-writes`; o Codex tem `--strict-worktree-writes` (`hooks-codex.json`); o Antigravity não tem guarda de escrita (`safety-check-antigravity.ts:11-12`) | No fallback, o isolamento depende só de instrução (`harness-capabilities.md` §2.3). Um `vetor-checks.sh in-worktree <path>` por arquivo, chamado antes de editar, daria verificação explícita. |
| **P1** | Regra única de criação de worktree | três implementações (D1) | Branch e base diferentes conforme o caminho; o hook do Claude Code cria branch sem tipo, o que interage com a #577 |
| **P2** | `check-edit.ts` sem modo CLI | só lê `tool_input` do stdin | Sem hook `PostToolUse`, não há como rodar a mesma checagem explicitamente; o fallback da #568 (§2.2) não lista equivalente para o `PostToolUse` |
| **P2** | Diretório de estado com nome de harness | `.claude/vetor/`, `.claude/worktrees/` | Só de nomenclatura; não bloqueia. Mudar custa migração de todo usuário existente. |
| **P3** | `compatibility` do `architecture-review` | cita `CronCreate` sem declarar `scheduling` | Só documental |

**[Fato]** Nenhuma lacuna de P0 ou P1 está no núcleo determinístico: os scripts de `scripts/lib/` já
rodam standalone (§3.2). As lacunas estão na **orquestração** (lançar e supervisionar workers) e nas
**guardas** que hoje só existem como hook.

## 5. Opções avaliadas

### Opção A: manter como está e só documentar

Documentar a tabela de §3.1 no wiki e encerrar.

- A favor: custo zero; o núcleo já é portátil.
- Contra: a lacuna P0 do executor continua, e o fallback de subagentes segue sendo instrução em prosa.

### Opção B: executor de workers em Deno, no núcleo

Um `scripts/worker-run.ts` (ou subcomando de `vetor-checks.sh`) que recebe o comando headless do
harness como argumento (`opencode run --dir …`, `codex exec …`, `claude -p …`), lança via
`Deno.Command` com o cwd do worktree, grava PID e início no status file, aplica timeout e encerra a
árvore no cancelamento. O Vetor não escolhe o harness: o comando vem da config ou da skill.

- A favor: fecha a lacuna P0 só com shell e Deno, sem capacidade exclusiva; dá o caso de uso que a
  ADR §8.3 exige antes de `SystemCapabilities`; serve de base para as métricas por worker da #583.
- Contra: supervisão de processo cross-platform (matar árvore no Windows) é justamente o que a #582
  tem que medir; não deve ser implementado antes dela.

### Opção C: executar o `OrchestratorAdapter` por script

Transformar o adapter em runtime chamável por `deno run`.

- Contra: impossível para o Alethe, porque MCP só existe dentro do harness (§3.3). Para o Orca, que é
  CLI (#588), seria possível. Só faz sentido depois da #587 decidir se o `ToolCaller` vira
  "MCP **ou** processo".

### Opção D: consolidar as duplicações

- D1: um módulo `scripts/lib/worktree-create.ts` com a regra de nome, base e recusa de existentes,
  usado pelo hook, pelo prewarm e pela skill (que passa a chamar o script em vez de repetir o shell).
- D2/D3: `selectDelegationRuntime` delega a parte MCP ao `OrchestratorRegistry.select` (ou o
  contrário), e as referências citam o código em vez de repetir a regra.
- D6: mover `dispatch-prompt`, `context-packet` e `micro-spec` para `scripts/lib/dispatch/`.

## 6. Recomendação

**[Opinião]**

1. **Adotar a tabela de §3.1 como mapa oficial da fronteira** e incluir **MCP** como capacidade
   opcional em `harness-capabilities.md` §2 e em `wiki/Contrato-de-Capacidades.md`, com o fallback
   "sem MCP, o orquestrador fica indisponível e o dispatch é nativo ou por processo".
2. **Opção B como próximo caso de uso concreto do núcleo**, condicionada à #582: a #582 mede se o
   `Deno.Command` basta para lançar, acompanhar e matar a árvore de um worker em Linux, macOS e
   Windows. Se bastar, o executor nasce em Deno, sem Rust.
3. **Opção D**, nesta ordem e com issues separadas:
   - **D1 (worktree)** primeiro, depois da #577, que decide se o hook `WorktreeCreate` fica. Qual
     implementação fica: **`prewarm-worktrees.ts`**, por já ser determinística, testada e recusar
     path/branch existentes. O hook e a skill passam a chamá-la.
   - **D2/D3 (seleção)**: fica o **`OrchestratorRegistry.select`**, porque é o ponto de integração
     que a ADR §3.2 preserva. O `selectDelegationRuntime` volta a tratar só CLIs, e a referência
     do Alethe aponta para o registry.
   - **D5**: fica o **`vetor-checks.sh verify-status`** como regra. O `check-status.ts` vira só a
     ponte de hook que o chama.
   - **D6**: só movimentação de arquivo, sem urgência.
4. **Opção C fica para a #587**: o contrato só deve ganhar um `ToolCaller` por processo se a revisão
   do contrato mostrar que o Orca precisa dele.
5. **Guarda de escrita (lacuna P1)**: expor `vetor-checks.sh in-worktree <path>` como verificação
   explícita por arquivo, para os harnesses sem `agent_type`. A guarda do Claude Code continua como
   otimização aditiva.

Nenhuma recomendação exige capacidade exclusiva de harness. Hooks, `agent_type`, `isolation` e MCP
aparecem só como otimização, e cada um tem o equivalente por shell indicado.

A decisão continua humana: este spike não altera skills nem cria issues de follow-up.
