# Convenções de projeto (branch default + comandos de teste)

Referência compartilhada para as duas resoluções que `fix-loop-agent`, `worktree-ship` e
`worktree-create` precisam fazer no início de sua execução. Consumida pelos três — nenhuma outra
skill precisa disso.

---

## Branch default

Nunca assuma `master`. Resolva em runtime via mecanismo compartilhado:

```bash
DEFAULT_BRANCH=$(bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" default-branch)
```

Use `$DEFAULT_BRANCH` em todos os comandos subsequentes (`git diff`, `git pull`, `git push`,
`gh pr create --base`, etc.).

---

## Comandos de teste por módulo (`module-test-map`)

**Mecanismo canônico de resolução (issue #160): sempre resolva via ROOT do repositório, nunca via
`cwd`.** Quando `fix-loop-agent`/`worktree-ship` rodam dentro de um worktree linkado, o worktree é
um checkout limpo — arquivos ignorados pelo `.gitignore` do projeto-alvo (ex.: uma entrada `.claude/`,
comum em setups que tratam config de assistente como local) nunca são materializados nele. Se
`.claude/vetor/module-test-map.md`/`config.json` só existirem no repositório principal, procurá-los
a partir do `cwd` do worktree falha silenciosamente — o agente ou inventa um comando de teste, ou
reporta erroneamente que não há suíte.

Resolva o root primeiro, sempre:

```bash
REPO_ROOT=$(bash "$CLAUDE_PLUGIN_ROOT/scripts/vetor-checks.sh" repo-root)
```

Esse subcomando usa `git rev-parse --git-common-dir`, que aponta para o `.git` compartilhado do
checkout principal mesmo quando executado de dentro de um worktree linkado — funciona tanto no root
quanto em qualquer worktree.

Em seguida, resolva nesta ordem, sempre a partir de `$REPO_ROOT` (nunca do `cwd`):

1. Verifique se `$REPO_ROOT/.claude/vetor/module-test-map.md` existe.
2. Se não existir, alerte o desenvolvedor que o ambiente não está inicializado e recomende rodar a skill `/vetor` para configurá-lo corretamente. Como fallback de execução automática, execute o script de auto-detecção:
   ```bash
   deno run -A "$CLAUDE_PLUGIN_ROOT/scripts/detect-project.ts"
   ```
   Imprima no console do desenvolvedor:
   `echo "[Vetor:AutoSetup] ATENÇÃO: Configuração não encontrada. Recomenda-se rodar o comando /vetor para inicializar. Gerado mapeamento temporário em .claude/vetor/module-test-map.md"`
3. Se a auto-detecção falhar, instrua o usuário a rodar o comando `/vetor` para preparar o ambiente.

O mesmo vale para `.claude/vetor/config.json` (que contém `testCommand`, `runtime`,
`packageManager`, etc.) — sempre leia via `$REPO_ROOT/.claude/vetor/config.json`, nunca via um path
relativo ao `cwd`.

Mapeie arquivos alterados (`git diff "$DEFAULT_BRANCH" --name-only`) aos módulos usando a tabela de
detecção do `module-test-map.md` resolvido.

**Nota (reforço redundante, opcional):** o `issue-coordinator`, ao detectar que `.claude/` está no
`.gitignore` do projeto-alvo (`git check-ignore -q .claude`), pode injetar os comandos de teste já
resolvidos diretamente no prompt de cada worker despachado, como reforço adicional — mas a fonte de
verdade permanece a resolução via `repo-root` acima, não essa injeção.
