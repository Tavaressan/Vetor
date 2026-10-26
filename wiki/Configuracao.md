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
- *(opcional)* `agy`/`opencode`/`codex` CLI no PATH para delegação agnóstica de runtime

## Testes por projeto

As skills de teste (`ship`, `fix-loop`, `guardian`) precisam saber **como rodar os testes do seu projeto**. Elas resolvem isso nesta ordem:

1. Leem `.claude/vetor/module-test-map.md` se existir;
2. Senão, tentam **auto-detectar** os comandos a partir de `.github/workflows/*.yml`;
3. Senão, pedem que você inicialize as configurações do plugin.

Para inicializar a pasta e gerar as configurações padrão, execute a porta de entrada:

```bash
/vetor:install
```

Isso cria o diretório `.claude/vetor`, gera o `module-test-map.md` (via scripts de auto-detecção) e o `config.json`. Depois, edite `.claude/vetor/module-test-map.md` para ajustar os comandos de teste do seu repositório.

A branch principal é **detectada automaticamente** (`main`, `master`, etc.) — não há nada a configurar.

Se o projeto usar um framework de docs/feature (ex.: um diretório `.reversa/` ou `_reversa_sdd/`), o `backlog` o detecta e usa como âncora. Se não houver, ele recorre a `docs/`, `ARCHITECTURE.md`, `README.md` e `CLAUDE.md`. Nada a configurar.

## Permissões

Para evitar prompts repetitivos, configure `.claude/settings.json` na raiz do projeto. Escolha um caminho conforme seu modelo de ameaça e uso de dependências de terceiros:

**Opção A — Modo Seguro (privilégio mínimo, recomendado).** Auto-aprova leitura do GitHub e gerenciamento de worktrees locais, mas **mantém a confirmação visual** para execução de testes, builds, pushes e merges.

> ⚠️ **Incompatível com dispatch em background do `coordinator`.** Workers em `run_in_background: true` não têm ninguém observando o terminal para confirmar prompts — um teste ou build pendente trava o worker indefinidamente (o comando fica pendente antes mesmo de o agente marcar `BLOCKED_WAITING`). Use este modo só para invocação manual e interativa (`/vetor:install:fix-loop`, `/vetor:install:guardian` sem `--cron`). Para `/vetor:install:coordinator`, use a Opção B.

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

**Opção B — Modo Alta Eficiência (autônomo).** Para projetos 100% privados de sua autoria exclusiva, com dependências rigidamente controladas, rodando tudo em background sem interrupções — é o modo **exigido pelo `coordinator`** (dispatch em background). **Adapte a lista de teste/build/install aos comandos reais do seu `module-test-map`** — o Vetor é agnóstico a projeto e não pode adivinhar seu stack; se um comando que o `fix` roda a cada iteração não estiver na lista, o worker trava igual ao Modo Seguro.

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
      "Bash(opencode:*)",
      "Bash(codex:*)",
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

## Typecheck a cada edição em projetos Node/TypeScript

O hook `PostToolUse` (`check-edit.ts`) roda `deno check` no arquivo editado em projetos Deno — sem custo perceptível. Em projetos **Node/TypeScript** o `tsc --noEmit` é do projeto inteiro e custou de 2,5 s (Next.js, 51 arquivos) a 14,4 s (592 arquivos) **a cada `Edit`/`Write`** na medição da [spike #394](https://github.com/Tavaressan/Vetor/issues/394), então ele vem **desligado por padrão** (issue #514). O erro de tipo continua sendo pego: o `/vetor:fix` roda o typecheck do projeto antes dos testes.

Para recuperar o diagnóstico imediato a cada edição, ligue o opt-in por uma das vias:

```jsonc
// .claude/vetor/config.json (na raiz do projeto; em monorepo, a raiz vale para todos os pacotes)
{
  "hooks": { "typecheckOnEdit": true }
}
```

ou `VETOR_TYPECHECK_ON_EDIT=true` no ambiente (vale para qualquer sessão, mesmo sem `config.json`).

Ligado, o hook roda `tsc --noEmit --incremental --tsBuildInfoFile .claude/vetor/cache/tsc.tsbuildinfo`: a primeira edição paga o custo a frio e as seguintes reaproveitam o cache (um arquivo por pacote em monorepo, `tsc-<pacote>.tsbuildinfo`). O diretório `.claude/vetor/cache/` se auto-ignora (cria um `.gitignore` com `*`) e nunca é versionado. Só age com `tsconfig.json` e `node_modules/.bin/tsc` presentes. A chave é uma só, `hooks.typecheckOnEdit`, no mesmo formato de bloco por tema dos demais (`knowledge`, `delegation`, `specValidate`); o `/vetor:install` preserva o bloco `hooks` ao regerar o `config.json`.

## Delegação de tarefas a um runtime externo (agnóstica de provedor)

Para economizar tokens, as skills podem delegar tarefas mecânicas de baixo risco a um CLI externo de IA disponível (Gemini/`agy`, OpenCode/`opencode`, Codex/`codex`), seguindo o padrão **o runtime delegado rascunha, Claude valida**. A escolha do runtime é dinâmica: disponibilidade no PATH × preferência configurada em `.claude/vetor/config.json` (`delegation.preferredRuntime`) × anuência explícita do usuário quando houver 2+ candidatos disponíveis e nenhuma preferência registrada.

- Resumir logs de CI longos antes do diagnóstico (`ship`, `fix-loop`)
- Rascunhar corpos de issue (`backlog`)
- Rascunhar mensagens de commit e relatórios (`guardian`)

É **totalmente opcional**: se nenhum dos CLIs estiver no PATH, as skills fazem tudo inline. Qualquer falha do CLI delegado (não só ausência do binário) também cai para o caminho inline, sem retry. A decisão de merge **nunca** é delegada — fica sempre com o Claude. Mudanças de código e resolução de conflitos podem ser delegadas como rascunho mediante proposta prévia de escopo ao desenvolvedor e validação pelos testes. Detalhes em `skills/shared/references/delegate-to-runtime.md`.

---

[← Wiki do Vetor](Home.md)
