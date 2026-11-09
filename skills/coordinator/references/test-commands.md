# Coordinator — comandos de teste nos workers

> Lida sob demanda pelo `SKILL.md` do `coordinator` (na Fase 4, quando `.claude/` é ignorado ou o module-test-map não está versionado). Paths relativos
> (`../shared/references/...`) e `$SKILL_DIR` aqui resolvem a partir do diretório da skill
> `coordinator`, não deste arquivo.

Os comandos de teste vêm de `.claude/vetor/module-test-map.md` ou, na ausência dela, de
auto-detecção a partir do CI — cada primitivo já consome essa referência, sempre resolvendo o
arquivo a partir do root do repositório (`vetor-checks.sh repo-root`), nunca do `cwd` do worktree
(issue #160), pois arquivos ignorados pelo `.gitignore` do projeto-alvo (ex.: uma entrada
`.claude/`) ou arquivos untracked (não versionados) não são materializados em worktrees linkados.
Se `git check-ignore -q .claude` indicar que `.claude/` está ignorado no projeto-alvo, ou se
`git ls-files --error-unmatch .claude/vetor/module-test-map.md` indicar que o arquivo não está
rastreado no git (issue #327), injete os comandos de teste já resolvidos diretamente no prompt de
cada worker despachado, como reforço redundante — a fonte de verdade continua sendo a resolução
via root em `project-conventions.md`.
