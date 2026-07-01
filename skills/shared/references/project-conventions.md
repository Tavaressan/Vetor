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

1. Leia `.claude/vetor/module-test-map.md` no projeto-alvo (cópia preenchida pelo usuário a partir do
   template).
2. Se não existir, auto-detecte os comandos a partir de `.github/workflows/*.yml`.
3. Se ainda assim não conseguir, avise o usuário para copiar o template:
   ```bash
   mkdir -p .claude/vetor
   cp "$CLAUDE_PLUGIN_ROOT/skills/shared/references/module-test-map.template.md" \
      .claude/vetor/module-test-map.md
   ```
   e preencher com os comandos headless do projeto.

Mapeie arquivos alterados (`git diff "$DEFAULT_BRANCH" --name-only`) aos módulos usando a tabela de
detecção do `module-test-map.md` resolvido.
