# Configuração

Tudo aqui é opcional — o Vetor funciona sem nenhuma dessas etapas, mas elas removem prompts repetitivos e ajustam o plugin ao stack do projeto.

## Pré-requisitos completos

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- [Deno](https://deno.com) no PATH — o Vetor roda seus scripts (safety hook, preparação de worktree, auto-detecção) com Deno, o que garante o mesmo comportamento em Windows, macOS e Linux
  - macOS/Linux: `curl -fsSL https://deno.land/install.sh | sh`
  - Windows: `winget install DenoLand.Deno`
- `gh` CLI autenticado (para issues, PRs, CI)
- Git com suporte a worktrees (`git worktree`)
- *(opcional)* Node/`npx` — necessário apenas para o MCP `chrome-devtools`
- *(opcional)* Docker com o plugin `docker mcp` — necessário apenas para o MCP `docker`
- *(opcional)* `agy` CLI no PATH para delegação de tarefas ao Gemini

## Testes por projeto

As skills de teste (`worktree-ship`, `fix-loop`, `guardian`) precisam saber **como rodar os testes do seu projeto**. Elas resolvem isso nesta ordem:

1. Leem `.claude/vetor/module-test-map.md` se existir;
2. Senão, tentam **auto-detectar** os comandos a partir de `.github/workflows/*.yml`;
3. Senão, pedem que você inicialize as configurações do plugin.

Para inicializar a pasta e gerar as configurações padrão, execute a porta de entrada:

```bash
/vetor
```

Isso cria o diretório `.claude/vetor`, gera o `module-test-map.md` (via scripts de auto-detecção) e o `config.json`. Depois, edite `.claude/vetor/module-test-map.md` para ajustar os comandos de teste do seu repositório.

A branch principal é **detectada automaticamente** (`main`, `master`, etc.) — não há nada a configurar.

Se o projeto usar um framework de docs/feature (ex.: um diretório `.reversa/` ou `_reversa_sdd/`), o `backlog-ideator` o detecta e usa como âncora. Se não houver, ele recorre a `docs/`, `ARCHITECTURE.md`, `README.md` e `CLAUDE.md`. Nada a configurar.

## Permissões

Para evitar prompts repetitivos, configure `.claude/settings.json` na raiz do projeto. Escolha um caminho conforme seu modelo de ameaça e uso de dependências de terceiros:

**Opção A — Modo Seguro (privilégio mínimo, recomendado).** Auto-aprova leitura do GitHub e gerenciamento de worktrees locais, mas **mantém a confirmação visual** para execução de testes, builds, pushes e merges.

> ⚠️ **Incompatível com dispatch em background do `issue-coordinator`.** Workers em `run_in_background: true` não têm ninguém observando o terminal para confirmar prompts — um teste ou build pendente trava o worker indefinidamente (o comando fica pendente antes mesmo de o agente marcar `BLOCKED_WAITING`). Use este modo só para invocação manual e interativa (`/vetor:fix-loop`, `/vetor:guardian` sem `--cron`). Para `/vetor:coordinator`, use a Opção B.

<details>
<summary><code>.claude/settings.json</code> — Opção A</summary>

```json
{
  "permissions": {
    "allow": [
      "Bash(git worktree list:*)",
      "Bash(git worktree add:*)",
      "Bash(git worktree remove:*)",
      "Bash(gh issue list:*)",
      "Bash(gh pr list:*)",
      "Bash(gh pr view:*)",
      "Bash(gh run view:*)"
    ]
  }
}
```
</details>

**Opção B — Modo Alta Eficiência (autônomo).** Para projetos 100% privados de sua autoria exclusiva, com dependências rigidamente controladas, rodando tudo em background sem interrupções — é o modo **exigido pelo `issue-coordinator`** (dispatch em background). **Adapte a lista de teste/build/install aos comandos reais do seu `module-test-map`** — o Vetor é agnóstico a projeto e não pode adivinhar seu stack; se um comando que o `fix-loop-agent` roda a cada iteração não estiver na lista, o worker trava igual ao Modo Seguro.

<details>
<summary><code>.claude/settings.json</code> — Opção B (ajuste o stack)</summary>

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
      "Bash(git worktree list:*)",
      "Bash(agy:*)",
      "Bash(deno run:*)",
      "Bash(deno task:*)",
      "Bash(deno test:*)",
      "Bash(deno install:*)",
      "Bash(npm ci:*)",
      "Bash(npm test:*)",
      "Bash(npm run *:*)",
      "Bash(pnpm install:*)",
      "Bash(pnpm test:*)",
      "Bash(pnpm run *:*)",
      "Bash(yarn install:*)",
      "Bash(yarn test:*)",
      "Bash(poetry install:*)",
      "Bash(poetry run *:*)",
      "Bash(cargo test:*)",
      "Bash(cargo build:*)"
    ]
  }
}
```
</details>

## Delegação ao Gemini

Para economizar tokens, as skills podem delegar tarefas mecânicas de baixo risco ao CLI `agy` (Google Antigravity/Gemini CLI), seguindo o padrão **Gemini rascunha, Claude valida**:

- Resumir logs de CI longos antes do diagnóstico (`worktree-ship`, `fix-loop`)
- Rascunhar corpos de issue (`backlog`)
- Rascunhar mensagens de commit e relatórios (`guardian`)

É **totalmente opcional**: se `agy` não estiver no PATH, as skills fazem tudo inline. Correção de código, resolução de conflito e decisão de merge **nunca** são delegadas — ficam sempre com o Claude. Detalhes em `skills/shared/references/delegate-to-gemini.md`.

---

[← Wiki do Vetor](Home.md)
