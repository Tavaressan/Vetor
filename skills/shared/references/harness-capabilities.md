# Capacidades do harness: contrato mínimo e fallbacks

> Fonte única dos fallbacks de capacidade (issue #568). As skills citam a seção daqui em vez de
> repetir o fallback. A matriz por harness, com fontes, fica em `wiki/Contrato-de-Capacidades.md`.

## 1. Núcleo obrigatório

O núcleo do Vetor (skills em Markdown e `scripts/`) assume só três capacidades do harness:

1. **Ler arquivos** do repositório e das referências da skill.
2. **Editar arquivos** (criar, alterar, apagar).
3. **Rodar shell** (`bash`; no Windows, Git Bash), com `git`, `gh` e `deno` no `PATH`.

Todo fluxo suportado precisa funcionar só com isso. Uma capacidade da seção 2 entra como otimização
aditiva: quando existe, a skill pode usá-la; quando falta, vale o fallback daqui, sem perda de
correção (só de conforto ou de paralelismo).

**Como detectar:** use a capacidade quando a ferramenta correspondente estiver na sua lista de
ferramentas desta sessão. Nunca a chame só para sondar, e nunca suponha que outro harness a tenha
porque o Claude Code tem.

## 2. Capacidades opcionais

### 2.1 Subagentes (`subagents`)

Delegar uma tarefa a outro agente com contexto próprio (no Claude Code, `Agent()`).

**Fallback:** execute a tarefa inline, na própria sessão, uma por vez. Para paralelismo real,
dispare um processo do SO por tarefa com o CLI headless do harness (ex.: `opencode run --dir
<worktree> --agent issue-worker "<prompt>" &`) e acompanhe pelo status file de cada uma, nunca pela
resposta do processo. Sem CLI headless, serialize. Mensagens a um subagente em execução
(`SendMessage`) não têm fallback: o canal é o status file, e uma decisão nova vira redespacho no
mesmo worktree.

### 2.2 Hooks (`hooks`)

Scripts que o harness roda em eventos (antes de um comando, ao fim de um subagente, ao criar um
worktree).

**Fallback:** a regra vira verificação explícita por script, rodada pelo próprio fluxo antes da ação
que ela protege. Os equivalentes:

| Hook do Claude Code | Verificação explícita |
| --- | --- |
| `PreToolUse` (git destrutivo, push protegido, push de worker não-GREEN) | nunca rodar esses comandos; `vetor-checks.sh prepare` só faz push com `GREEN` |
| `PreToolUse` (escrita fora do worktree) | `vetor-checks.sh in-worktree` antes de editar; editar só caminhos dentro do worktree |
| `SubagentStop` (status terminal) | `vetor-checks.sh verify-status` como último passo do worker |
| `WorktreeCreate` (dependências) | `deno run -A scripts/prepare-worktree.ts` depois do `git worktree add` |
| `SessionStart` (aviso de instalação) | `/vetor:now` no início da sessão |

### 2.3 Isolamento de worktree (`worktree-isolation`)

O harness cria o worktree e prende o agente nele (no Claude Code, `isolation: worktree`).

**Fallback:** crie o worktree com a skill `worktree-create` (`git worktree add`), passe o caminho
absoluto no prompt e comece o trabalho com `cd <worktree>` e `vetor-checks.sh in-worktree` (exit 0).
O isolamento passa a depender da instrução, então todo caminho escrito deve ficar sob o worktree.

### 2.4 Ferramenta de perguntas (`questions`)

Pergunta estruturada com opções (no Claude Code, `AskUserQuestion`; no Antigravity, o artefato
`implementation_plan.md` com `request_feedback: true` serve para aprovação de plano).

**Fallback:** escreva as perguntas numeradas no chat, cada uma com as opções numeradas e a
`(Recommended)` primeiro, e termine com "responda `sim` para aceitar as opções `(Recommended)`, ou diga
quais itens mudar". Pare até a resposta. Vale a regra das 3 perguntas
(`planning-conventions.md` §3). Para aprovação de plano, `planning-conventions.md` §2.2.

### 2.5 Execução em background (`background`)

Rodar um comando ou subagente sem bloquear e ser avisado ao fim (no Claude Code,
`run_in_background` e `Monitor`).

**Fallback:** rode em primeiro plano. Para vários comandos longos e independentes, use o shell:
`cmd1 & cmd2 & wait`, com a saída de cada um num arquivo. Um watchdog vira checagem a cada ciclo de
monitoramento (ex.: `vetor-checks.sh stalled-workers`), nunca uma espera bloqueante sem prazo.

### 2.6 Agendamento (`scheduling`)

Rodar uma skill numa hora ou recorrência (no Claude Code, `CronCreate` e rotinas).

**Fallback:** não agende de dentro da sessão. Entregue o comando headless equivalente (o modo
`--cron`/`--headless` da skill, que roda sem perguntas) e indique onde o usuário pode agendá-lo: cron
ou timer do systemd, Agendador de Tarefas do Windows, ou um workflow de CI.
