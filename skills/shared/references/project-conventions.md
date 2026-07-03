# Convenções de projeto (branch default + comandos de teste)

Referência compartilhada para as duas resoluções que `fix-loop-agent`, `worktree-ship` e
`worktree-create` precisam fazer no início de sua execução. Consumida pelos três — nenhuma outra
skill precisa disso.

---

## Branch default

Nunca assuma `master`. Detecte em runtime:

```bash
DEFAULT_BRANCH=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH=$(git remote show origin 2>/dev/null | sed -n '/HEAD branch/s/.*: //p')
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH=master
```

Use `$DEFAULT_BRANCH` em todos os comandos subsequentes (`git diff`, `git pull`, `git push`,
`gh pr create --base`, etc.).

---

## Comandos de teste por módulo (`module-test-map`)

Resolva nesta ordem:

1. Verifique se `.claude/vetor/module-test-map.md` existe no projeto-alvo.
2. Se não existir, alerte o desenvolvedor que o ambiente não está inicializado e recomende rodar a skill `/vetor` para configurá-lo corretamente. Como fallback de execução automática, execute o script de auto-detecção:
   ```bash
   $CLAUDE_PLUGIN_ROOT/scripts/auto-detect.sh
   ```
   Imprima no console do desenvolvedor:
   `echo "[Vetor:AutoSetup] ATENÇÃO: Configuração não encontrada. Recomenda-se rodar o comando /vetor para inicializar. Gerado mapeamento temporário em .claude/vetor/module-test-map.md"`
3. Se a auto-detecção falhar, instrua o usuário a rodar o comando `/vetor` para preparar o ambiente.

Mapeie arquivos alterados (`git diff "$DEFAULT_BRANCH" --name-only`) aos módulos usando a tabela de
detecção do `module-test-map.md` resolvido.
