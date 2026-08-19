# Arquitetura

Primitivos compostos por skills de nível superior. A Fase 4 do coordinator despacha um subagente nativo (`issue-worker`, não uma skill genérica) por issue:

```
                    coordinator
                   /     |          \
       worktree-create  issue-worker  worktree-ship
                        (subagente,
                        pré-carrega
                        fix-loop-agent)
                   \     |          /
              .claude/vetor/module-test-map.md  (config por projeto)

          backlog   (independente)
          guardian  (independente)
```

## Subagente nativo

**`agents/issue-worker.md`** — subagente nativo do plugin (não uma skill), despachado pelo `issue-coordinator` uma vez por issue. Tem `tools` restritos e nunca faz `git push`, `gh pr create/merge/ready` por instrução; pré-carrega a skill `fix-loop-agent` via campo `skills:`. O que é aplicado por hook, e não por instrução: push para branch protegida, push/PR de worker não-GREEN, escrita fora do worktree e encerramento sem status file (ver [Hooks](Hooks.md)).

**`agents/code-review.md`** — subagente nativo de revisão de código, despachado pelo `worktree-ship` (passo 8.5) depois do CI verde e antes da checagem de review humano. Substitui o antigo GitHub Action `code-review@claude-code-plugins` (desativado por cobrar por execução independente do risco/tamanho da PR). Tools restritos a leitura (`Bash`/`Read`/`Grep`/`Glob`, sem `Write`/`Edit`); publica achados como comentário na PR via `gh pr comment` e **nunca bloqueia o merge** — a decisão de agir sobre um achado é sempre humana. Só roda quando o diff tocou algum módulo real (mesmo filtro do passo 3 do `worktree-ship`), então PRs só de docs/lockfile/config não pagam o custo da revisão.

## Convenções do projeto (`.claude/rules/vetor/`)

O `/vetor` gera rules com frontmatter `paths`, que o Claude Code carrega **apenas** quando lê um
arquivo casando com o glob — custo zero de contexto quando irrelevante. Cada linha corresponde a um
fato lido do repositório (`deno.json`, `package.json`, arquivos de config do formatador/linter);
o que não foi detectado não vira regra, porque uma convenção inventada faria o worker "consertar"
código correto.

Rules ficam no subdiretório `vetor/` para não pisar nas suas, e não são sobrescritas sem `--force`.
**Commite-as**: os workers rodam em worktrees, que só contêm arquivos rastreados pelo git.

## Arquivos de referência compartilhados

- **`skills/shared/references/module-test-map.template.md`** — template de comandos de teste headless por módulo (ver [Configuração › Testes por projeto](Configuracao.md#testes-por-projeto)).
- **`skills/shared/references/delegate-to-gemini.md`** — padrão opcional de delegação ao Gemini CLI.
- **`skills/shared/references/project-conventions.md`** — detecção de branch default e resolução do `module-test-map`, compartilhada por `fix-loop-agent`, `worktree-ship` e `worktree-create` (evita duplicar a mesma lógica três vezes).

## Observabilidade

Quando o `coordinator` despacha sub-agentes:

- **`AGENT_STATUS.md`** por worktree — cada agente atualiza seu status a cada iteração.
- **Tabela de status** no chat — coordinator consolida via `gh pr list`.
- **Escalação** — bloqueios de permissão e decisões técnicas são repassados ao usuário com opções (permitir / permitir para o agente / negar / parar).

## Skill aposentada: `worktree-session`

A skill `worktree-session` foi aposentada (monolítica demais, perdia contexto). Use a composição `worktree-create` + `worktree-ship` (e `coordinator` para orquestração). O arquivo legado fica em `legacy/worktree-session/` só como referência histórica e **não é carregado** pelo plugin.

---

[← Wiki do Vetor](Home.md)
