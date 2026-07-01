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
2. Se não existir, execute de forma transparente o script de auto-detecção:
   ```bash
   $CLAUDE_PLUGIN_ROOT/scripts/auto-detect.sh
   ```
   Isso criará automaticamente `.claude/vetor/module-test-map.md` com a estrutura padrão detectada. Imprima o log no console para o desenvolvedor:
   `echo "[Vetor:AutoSetup] Gerado mapeamento de testes padrão em .claude/vetor/module-test-map.md"`
3. Se a auto-detecção falhar, avise o usuário para criar manualmente a partir do template:
   ```bash
   mkdir -p .claude/vetor
   cp "$CLAUDE_PLUGIN_ROOT/skills/shared/references/module-test-map.template.md" \
      .claude/vetor/module-test-map.md
   ```
   e preencher com os comandos headless do projeto.

Mapeie arquivos alterados (`git diff "$DEFAULT_BRANCH" --name-only`) aos módulos usando a tabela de
detecção do `module-test-map.md` resolvido.
