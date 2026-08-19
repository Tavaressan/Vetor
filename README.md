# Vetor

Plugin de skills para automação de workflow de desenvolvimento no Claude Code. **Agnóstico a projeto** — instale uma vez e use em qualquer repositório.

Cobre o ciclo completo: **ideação → backlog → worktree isolado → fix autônomo → ship → guarda**.

## Instalação

```
/plugin marketplace add Tavaressan/Vetor
/plugin install vetor@vetor
```

Depois, rode **`/vetor`** no projeto-alvo: ele detecta o runtime, gera o mapeamento de testes e grava a configuração em `.claude/vetor/`.

**Pré-requisitos:** [Deno](https://deno.com) e `gh` CLI autenticado no PATH, e Git com suporte a `git worktree`. *(Opcionais: `npx` para o MCP `chrome-devtools`, Docker com plugin `docker mcp` para o MCP `docker`, `agy` para delegação ao Gemini.)*

## Skills

| Comando | O que faz |
|---------|----------|
| `/vetor [--force]` | Porta de entrada — inicializa e configura o Vetor no projeto-alvo |
| `/vetor:backlog [tema]` | Ideação guiada por docs do projeto → batch de issues GitHub com aprovação humana |
| `/vetor:coordinator [label] [--headless]` | Despacho paralelo de issues para sub-agentes isolados, com merge serializado |
| `/vetor:worktree-create <type> <slug> [issue#]` | Cria worktree isolado, headless |
| `/vetor:fix-loop <descrição>` | Loop autônomo reproduce → fix → rebuild → test (máx. 5 iterações) |
| `/vetor:worktree-ship [issue#]` | Pipeline: test → push → PR draft → CI → code review → merge → cleanup |
| `/vetor:guardian [--cron]` | Audit + auto-fix de gaps que o pre-commit não cobre |
| `/vetor:retro` | Avalia o uso do Vetor na sessão e propõe melhorias no próprio plugin |

## Início rápido

**Automatizado** — do backlog ao merge:

```
/vetor:backlog resiliência       # cria issues com label ai-generated
/vetor:coordinator ai-generated  # despacha, implementa, testa, faz PR e merge
/vetor:guardian                  # audita o estado pós-merge
```

**Manual** — uma issue por vez:

```
/vetor:worktree-create fix auth-bug 42
# (desenvolve normalmente)
/vetor:fix-loop testes falhando
/vetor:worktree-ship 42
```

> Para rodar o `coordinator` com dispatch em background é preciso o modo de permissões autônomo — ver [Configuração › Permissões](wiki/Configuracao.md#permissões).

## Documentação

A [**wiki**](wiki/Home.md) tem o detalhe:

| Página | Conteúdo |
|--------|----------|
| [Configuração](wiki/Configuracao.md) | Testes por projeto, permissões, delegação ao Gemini |
| [MCPs](wiki/MCPs.md) | `context7`, `chrome-devtools` e `docker` embarcados |
| [Arquitetura](wiki/Arquitetura.md) | Composição das skills, subagentes nativos, observabilidade |
| [Hooks](wiki/Hooks.md) | O que é aplicado por hook, não por prompt |
| [Decisões de design](wiki/Decisoes-de-Design.md) | Trade-offs e limitações conhecidas |
| [Referência](wiki/Referencia.md) | Hard caps, custo de tokens, estrutura do repositório |
| [Compatibilidade](wiki/Home.md#compatibilidade-com-outros-runtimes) | Antigravity, OpenAI Codex, OpenCode |

## Licença

[MIT](LICENSE) © 2026 Vitor Tavares Chaves.
