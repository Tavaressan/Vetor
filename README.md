# Vetor

Plugin [Claude Code](https://docs.anthropic.com/en/docs/claude-code) de skills para automação de workflow de desenvolvimento. **Agnóstico a projeto** — instale uma vez e use em qualquer repositório.

Cobre o ciclo completo: **ideação → backlog → worktree isolado → fix autônomo → ship → guarda**.

---

## Instalação

```
/plugin marketplace add Tavaressan/Vetor
/plugin install vetor@vetor
```

Pronto. Os comandos ficam disponíveis com o prefixo `/vetor:`. Não é preciso copiar pastas nem editar o `CLAUDE.md` do projeto.

---

## Skills

| Comando | O que faz |
|---------|----------|
| `/vetor:worktree-create <type> <slug> [issue#]` | Primitivo headless — cria worktree isolado sem prompts, todos os parâmetros via args |
| `/vetor:worktree-ship [issue#]` | Pipeline headless: test local → push → PR draft → CI watch → merge → sync root → cleanup |
| `/vetor:fix-loop <descrição>` | Loop autônomo reproduce → fix → rebuild → test (máx. 5 iterações) |
| `/vetor:backlog [tema]` | Ideação guiada ancorada em docs do projeto → batch de issues GitHub com aprovação humana |
| `/vetor:guardian [--cron]` | Audit + auto-fix de gaps que o pre-commit não cobre (JSON, migrations, worktrees, Dependabot) |
| `/vetor:coordinator [label] [--dry-run]` | Despacho paralelo de issues para sub-agentes com escalação de permissões e merge serializado |

### Referência compartilhada

- **`skills/shared/references/module-test-map.template.md`** — Template de comandos de teste headless por módulo. Veja "Configuração por projeto" abaixo.
- **`skills/shared/references/delegate-to-gemini.md`** — Padrão opcional de delegação ao Gemini CLI para economizar tokens. Veja "Delegação ao Gemini".

> ⚠️ A skill `worktree-session` foi **aposentada**. Era monolítica demais e perdia contexto. Use a composição `worktree-create` + `worktree-ship` (e `coordinator` para orquestração). O arquivo legado fica em `legacy/worktree-session/` apenas como referência histórica e **não é carregado** pelo plugin.

---

## Configuração por projeto (opcional)

As skills de teste (`worktree-ship`, `fix-loop`, `guardian`) precisam saber **como rodar os testes do seu projeto**. Elas resolvem isso nesta ordem:

1. Leem `.claude/vetor/module-test-map.md` se existir;
2. Senão, tentam **auto-detectar** os comandos a partir de `.github/workflows/*.yml`;
3. Senão, pedem que você crie o arquivo a partir do template.

Para o controle mais previsível, copie o template e preencha:

```bash
mkdir -p .claude/vetor
cp "$CLAUDE_PLUGIN_ROOT/skills/shared/references/module-test-map.template.md" \
   .claude/vetor/module-test-map.md
# edite com os comandos de teste headless do SEU projeto
```

A branch principal é **detectada automaticamente** (`main`, `master`, etc.) — não há nada a configurar.

### Frameworks de feature opcionais

Se o projeto usar um framework de docs/feature (ex.: um diretório `.reversa/` ou `_reversa_sdd/`), o `backlog-ideator` o detecta e usa como âncora. Se não houver, ele recorre a `docs/`, `ARCHITECTURE.md`, `README.md` e `CLAUDE.md`. Nada a configurar.

---

## Delegação ao Gemini (opcional)

Para economizar tokens, as skills podem delegar tarefas mecânicas de baixo risco ao CLI `gemini` (Google Gemini CLI), seguindo o padrão **Gemini rascunha, Claude valida**:

- Resumir logs de CI longos antes do diagnóstico (`worktree-ship`, `fix-loop`)
- Rascunhar corpos de issue (`backlog`)
- Rascunhar mensagens de commit e relatórios (`guardian`)

É **totalmente opcional**: se `gemini` não estiver no PATH, as skills fazem tudo inline. Correção de código, resolução de conflito e decisão de merge **nunca** são delegadas — ficam sempre com o Claude. Detalhes em `skills/shared/references/delegate-to-gemini.md`.

---

## Permissões (opcional)

Para evitar prompts repetitivos, adicione ao `.claude/settings.json` do projeto:

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

Primitivos compostos por skills de nível superior:

```
                    coordinator
                   /     |      \
       worktree-create  fix-loop  worktree-ship
                   \     |      /
              .claude/vetor/module-test-map.md  (config por projeto)

          backlog   (independente)
          guardian  (independente)
```

### Fluxo completo automatizado

1. **`/vetor:backlog resiliência`** — gera e cria issues no GitHub com label `ai-generated`
2. **`/vetor:coordinator ai-generated`** — despacha cada issue para um sub-agente em worktree isolado
3. Cada sub-agente: implementa → `/vetor:fix-loop` → testes verdes
4. Coordinator: `/vetor:worktree-ship` sequencial → PR → CI → merge
5. **`/vetor:guardian`** — audita o estado pós-merge

### Fluxo manual (skill por skill)

1. **`/vetor:worktree-create fix auth-bug 42`** — cria worktree isolado
2. *(desenvolve normalmente)*
3. **`/vetor:fix-loop testes falhando`** — itera até verde
4. **`/vetor:worktree-ship 42`** — PR + CI + merge

---

## Observabilidade

Quando o `coordinator` despacha sub-agentes:

- **`AGENT_STATUS.md`** por worktree — cada agente atualiza seu status a cada iteração
- **Tabela de status** no chat — coordinator consolida via `gh pr list`
- **Escalação** — bloqueios de permissão e decisões técnicas são repassados ao usuário com opções (permitir / permitir para o agente / negar / parar)

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
- *(opcional)* `gemini` CLI no PATH para delegação de tarefas

---

## Estrutura do repositório

```
.claude-plugin/
├── plugin.json              # manifesto do plugin
└── marketplace.json         # listagem do marketplace
skills/
├── shared/references/
│   ├── module-test-map.template.md
│   └── delegate-to-gemini.md
├── backlog-ideator/SKILL.md
├── fix-loop-agent/SKILL.md
├── guardian/SKILL.md
├── issue-coordinator/SKILL.md
├── worktree-create/SKILL.md
└── worktree-ship/SKILL.md
legacy/
└── worktree-session/SKILL.md   # aposentada — não carregada
```

---

## Licença

Copyright (c) 2026 Vitor Tavares Chaves. Todos os direitos reservados.
Este software é proprietário e de uso exclusivo do autor.
Distribuição, cópia ou uso não autorizado são proibidos.
