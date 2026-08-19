# Cache de arquivos tocados

Cache leve e efêmero, gravado pelo `fix-loop-agent` (§1) e consumido pelo `code-review`
(`agents/code-review.md`), para que este não tenha que re-derivar do zero a lista de arquivos
alterados e o mapeamento módulo → arquivos da mesma branch.

**Path:** `<repo-root>/.claude/vetor/status/<branch com / trocada por ->-touched-files.json`
(mesmo diretório e convenção de nome do status file; root via `git rev-parse --git-common-dir`).

**Formato:**

```json
{
  "branch": "<branch>",
  "head": "<git rev-parse HEAD>",
  "generated_at": "<ISO 8601>",
  "default_branch": "<DEFAULT_BRANCH>",
  "modules": {
    "<módulo>": ["<arquivo1>", "<arquivo2>"]
  },
  "files": ["<arquivo1>", "<arquivo2>", "..."]
}
```

**Regras de gravação:** sobrescreva sempre que os módulos forem (re)detectados — primeira execução e
qualquer iteração do loop em que novos arquivos tenham sido alterados. `head` deve refletir o
`git rev-parse HEAD` **no momento da gravação**, para que o consumidor consiga validar frescor.

**Ciclo de vida:** efêmero por branch/worktree. Descartado no cleanup do `worktree-ship` (passo 12);
nunca persiste entre PRs.
