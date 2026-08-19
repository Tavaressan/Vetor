# Hooks

Hooks disparam **dentro dos subagentes** (o payload traz `agent_id`/`agent_type`), então são o único
mecanismo que aplica uma política de fato — instrução em prompt o agente pode ignorar.

**⚠️ Cobertura por plataforma:** A tabela abaixo lista os hooks do **Claude Code**. A cobertura no Antigravity é reduzida e no Codex é estruturalmente equivalente mas não validada em produção (ver [Antigravity](Compatibilidade-Antigravity.md) e [OpenAI Codex](Compatibilidade-Codex.md)).

| Evento | Matcher | Script | O que faz |
|--------|---------|--------|-----------|
| `PreToolUse` | `Bash\|Edit\|Write` | `safety-check.ts` / `safety-check.sh` | Barra push para branch protegida; barra push/PR de worker não-GREEN; barra escrita fora do worktree (exceto o status file); em `Edit`/`Write`, correlaciona `agent_id` com o worktree resolvido para detectar cwd contaminado entre workers em paralelo (issue #63) |
| `PostToolUse` | `Edit\|Write` | `check-edit.ts` | Roda o typecheck no arquivo editado e injeta o erro no contexto do agente |
| `SubagentStop` | `vetor:issue-worker` | `check-status.ts` | Impede o worker de encerrar sem status file em estado terminal |
| `SessionStart` | — | `session-check.ts` | Avisa se o projeto ainda não rodou `/vetor` |
| `WorktreeCreate` | — | `prepare-worktree.ts` | Cria o worktree e prepara as dependências |

> ⚠️ O hook `Stop` (`stop-recovery.ts`) foi **aposentado** (issue #141) e o código foi para
> `legacy/stop-recovery/`, onde **não é carregado** pelo plugin. Ele comparava o transcript da
> sessão com o estado dos arquivos em disco e bloqueava o encerramento ao divergir. Não foi
> retirado por bug aberto — as correções das issues #136/#137 já haviam eliminado o falso
> positivo conhecido — mas por custo/benefício: a comparação transcript-versus-disco é frágil por
> natureza (qualquer formatador, linter ou hook de terceiro que toque o arquivo depois do `Write`
> produz divergência) e exigiu cinco remendos sucessivos (#87, #127, #128, #136, #137), cada um
> estreitando o alcance sem tornar o sinal confiável, para um alerta cujo modo de falha era
> bloquear a sessão.

O `check-edit.ts` existe para poupar iterações do fix-loop: sem ele, um erro de tipo ou import quebrado
só apareceria ao **rodar o teste**, e cada descoberta dessas queima uma das 5 iterações do worker.
Com ele, o erro volta junto com o resultado do próprio `Edit`. Só age em `.ts`/`.tsx`, tem timeout de
20s e **fica em silêncio quando não há erro**.

## Reutilizando a detecção de worktree em hooks externos ao plugin

`scripts/vetor-checks.sh in-worktree` é um **contrato estável** e pode ser chamado a partir de
qualquer hook/script de projeto que precise saber "estou num worktree linkado ou no repositório
principal?" — não é uso interno exclusivo das skills do Vetor.

- `exit 0`: o cwd é um worktree linkado.
- `exit 1`: o cwd é o repositório principal (root), ou não é um repositório git.
- Sem saída em stdout (mensagens de diagnóstico, se houver, vão para stderr).

A checagem compara `git rev-parse --git-dir` com `git rev-parse --git-common-dir` (ambos
normalizados via `cd ... && pwd`) — **não** compare `pwd` com a primeira linha de
`git worktree list`: no Windows com Git Bash os dois formatos de path nunca coincidem
(`/c/Projetos/...` vs `C:/Projetos/...`), o que faz essa comparação ingênua concluir "estou em
worktree" mesmo estando no root, disparando lógica destinada só a worktrees (ex.: auto-commit de
WIP) direto na branch principal (issue #129).

Exemplo de uso a partir de um hook `Stop` externo ao plugin:

```bash
#!/usr/bin/env bash
# hooks/stop-wip-snapshot.sh (exemplo hipotético de um projeto consumidor)
VETOR_CHECKS="$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh"

if bash "$VETOR_CHECKS" in-worktree; then
  # cwd é um worktree linkado — seguro fazer auto-snapshot de WIP aqui.
  git add -A && git commit -m "wip: auto-snapshot" --no-verify
else
  # cwd é o repositório principal — não commitar automaticamente.
  exit 0
fi
```

---

[← Wiki do Vetor](Home.md)
