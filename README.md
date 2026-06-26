# Vetor

Biblioteca de skills [Claude Code](https://docs.anthropic.com/en/docs/claude-code) para automação de workflow de desenvolvimento.

Cobre o ciclo completo: **ideação → backlog → worktree isolado → fix autônomo → ship → guarda**.

---

## Skills

| Skill | Comando | O que faz |
|-------|---------|----------|
| `worktree-session` | `/worktree-session [issue#]` | Sessão interativa completa — escolha root/worktree, criação de branch, trabalho incremental, PR, CI, merge e sync |
| `worktree-create` | `/worktree-create <type> <slug> [issue#]` | Primitivo headless — cria worktree sem prompts, todos os parâmetros via args |
| `worktree-ship` | `/worktree-ship [issue#]` | Pipeline headless: test local → push → PR draft → CI watch → merge → sync root → cleanup |
| `fix-loop-agent` | `/fix-loop <descrição>` | Loop autônomo reproduce → fix → rebuild → test (max 5 iterações) |
| `backlog-ideator` | `/backlog [tema]` | Ideação guiada ancorada em docs do projeto → batch de issues GitHub com aprovação humana |
| `guardian` | `/guardian [--cron]` | Audit + auto-fix de gaps que o pre-commit não cobre (JSON, Flyway, worktrees, Dependabot) |
| `issue-coordinator` | `/coordinator [label] [--dry-run]` | Despacho paralelo de issues para sub-agentes com escalação de permissões e merge serializado |

### Referência compartilhada

- **`shared/references/module-test-map.md`** — Tabela canônica de comandos de teste headless por módulo, regra sandbox de docker e exclusões obrigatórias. Consumida por `worktree-ship`, `fix-loop-agent` e `guardian`.

---

## Como usar

### 1. Copiar os skills para o seu projeto

Clone este repositório e copie os skills desejados para `.claude/skills/` do seu projeto:

```bash
git clone git@github.com:Tavaressan/Vetor.git

# Copiar todos os skills
cp -r Vetor/skills/* seu-projeto/.claude/skills/

# Ou copiar apenas os que precisa
cp -r Vetor/skills/worktree-create seu-projeto/.claude/skills/
cp -r Vetor/skills/fix-loop-agent seu-projeto/.claude/skills/
```

### 2. Adaptar o module-test-map

O arquivo `shared/references/module-test-map.md` contém comandos de teste específicos do projeto Alfabra Vector. **Você deve adaptá-lo** ao seu projeto:

```bash
cp -r Vetor/skills/shared seu-projeto/.claude/skills/
# Edite .claude/skills/shared/references/module-test-map.md
# com os comandos de teste do SEU projeto
```

A tabela deve mapear cada módulo do seu projeto ao comando headless de teste correspondente. Skills como `worktree-ship`, `fix-loop-agent` e `guardian` consultam esta tabela.

### 3. Registrar no CLAUDE.md

Adicione a tabela de skills ao `CLAUDE.md` do seu projeto para que o Claude Code saiba que eles existem:

```markdown
## Skills de Automação

| Skill | Ativação | Propósito |
|-------|----------|----------|
| `worktree-create` | `/worktree-create <type> <slug> [issue#]` | Cria worktree headless |
| `worktree-ship` | `/worktree-ship [issue#]` | Ship pipeline completo |
| `fix-loop-agent` | `/fix-loop <descrição>` | Loop de fix até CI verde |
| `backlog-ideator` | `/backlog [tema]` | Ideação → issues GitHub |
| `guardian` | `/guardian` | Audit + auto-fix |
| `issue-coordinator` | `/coordinator [label] [--dry-run]` | Despacho paralelo |

Referência compartilhada de testes: `.claude/skills/shared/references/module-test-map.md`
```

### 4. Permissões (opcional)

Se quiser evitar prompts de permissão repetitivos, crie `.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(gh issue create:*)",
      "Bash(gh issue list:*)",
      "Bash(gh pr create:*)",
      "Bash(gh pr merge:*)",
      "Bash(gh pr ready:*)",
      "Bash(gh pr checks:*)",
      "Bash(gh pr view:*)",
      "Bash(gh run view:*)",
      "Bash(git worktree add:*)",
      "Bash(git worktree remove:*)",
      "Bash(git worktree list:*)"
    ]
  }
}
```

---

## Arquitetura dos skills

Os skills são organizados em camadas — primitivos que podem ser compostos por skills de nível superior:

```
                    issue-coordinator
                   /        |        \
          worktree-create  fix-loop  worktree-ship
                   \        |        /
              shared/references/module-test-map.md

          backlog-ideator  (independente)
          guardian          (independente)
          worktree-session  (interativo, standalone)
```

### Fluxo completo automatizado

1. **`/backlog resiliência`** — gera e cria issues no GitHub com label `ai-generated`
2. **`/coordinator ai-generated`** — despacha cada issue para um sub-agente em worktree isolado
3. Cada sub-agente: implementa → `/fix-loop` → testes verdes
4. Coordinator: `/worktree-ship` sequencial → PR → CI → merge
5. **`/guardian`** — audita o estado pós-merge

### Fluxo manual (skill por skill)

1. **`/worktree-create fix auth-bug 42`** — cria worktree isolado
2. *(desenvolve normalmente)*
3. **`/fix-loop cargo test failing`** — itera até verde
4. **`/worktree-ship 42`** — PR + CI + merge

---

## Observabilidade

Quando o `issue-coordinator` despacha sub-agentes:

- **`AGENT_STATUS.md`** por worktree — cada agente atualiza seu status a cada iteração
- **Tabela de status** no chat — coordinator consolida via `gh pr list`
- **Escalação** — bloqueios de permissão e decisões técnicas são repassados ao usuário com opções:
  1. Permitir esta vez
  2. Permitir para este agente (blanket permission)
  3. Negar e continuar
  4. Parar agente

### Hard caps

| Limite | Valor |
|--------|-------|
| Iterações do fix-loop | 5 |
| Retentativas de CI no ship | 3 |
| Timeout global do coordinator | 90 min |

---

## Pré-requisitos

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- `gh` CLI autenticado (para issues, PRs, CI)
- Git com suporte a worktrees (`git worktree`)

---

## Estrutura do repositório

```
skills/
├── shared/
│   └── references/
│       └── module-test-map.md
├── backlog-ideator/
│   └── SKILL.md
├── fix-loop-agent/
│   └── SKILL.md
├── guardian/
│   └── SKILL.md
├── issue-coordinator/
│   └── SKILL.md
├── worktree-create/
│   └── SKILL.md
├── worktree-session/
│   └── SKILL.md
└── worktree-ship/
    └── SKILL.md
```

---

## Licença

MIT
