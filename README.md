# Vetor

Plugin de skills para automação de workflow de desenvolvimento. **Agnóstico a projeto** — instale uma vez e use em qualquer repositório.

Cobre o ciclo completo: **ideação → backlog → worktree isolado → fix autônomo → ship → guarda**.

---

## Pré-requisitos

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- [Deno](https://deno.com) no PATH — o Vetor roda seus scripts (safety hook, preparação de worktree, auto-detecção) com Deno, o que garante o mesmo comportamento em Windows, macOS e Linux
  - macOS/Linux: `curl -fsSL https://deno.land/install.sh | sh`
  - Windows: `winget install DenoLand.Deno`
- `gh` CLI autenticado (para issues, PRs, CI)
- Git com suporte a worktrees (`git worktree`)
- *(opcional)* Node/`npx` — necessário apenas para o MCP `chrome-devtools`
- *(opcional)* Docker com o plugin `docker mcp` — necessário apenas para o MCP `docker`
- *(opcional)* `agy` CLI no PATH para delegação de tarefas ao Gemini

---

## Instalação (no Claude Code)

```
/plugin marketplace add Tavaressan/Vetor
/plugin install vetor@vetor
```

Pronto. Os comandos ficam disponíveis com o prefixo `/vetor:`. Não é preciso copiar pastas nem editar o `CLAUDE.md` do projeto.

Depois, rode **`/vetor`** no projeto-alvo: ele detecta o runtime, gera o mapeamento de testes e grava a configuração em `.claude/vetor/`.

---

## MCPs incluídos

O plugin já traz três servidores MCP. O Claude Code usa *tool search* por padrão, então os schemas ficam diferidos e o custo de contexto é baixo.

| Servidor | Para quê | Requer |
|----------|----------|--------|
| `context7` | Documentação atualizada de bibliotecas, direto na sessão | Nada. A API key é opcional (só aumenta o rate limit) e é pedida na habilitação do plugin |
| `chrome-devtools` | Dirigir o Chrome: navegar, screenshot, rede, performance trace, Lighthouse | Node (`npx`) e Chrome |
| `docker` | O Docker CLI inteiro (`ps`, `logs`, `stats`, `compose`, `exec`) via o servidor **oficial da Docker Inc.** — uma única ferramenta | Docker + plugin `docker mcp` |

Sobre o servidor `docker`:

- Ele é o [servidor oficial](https://github.com/docker/mcp-registry) da Docker (Apache-2.0), mas **não faz parte do catálogo distribuído** (`mcp/docker-mcp-catalog:latest` só traz servidores do tipo `image`). Por isso o plugin embarca `mcp/docker-catalog.yaml` e passa `--catalog` ao gateway. Sem isso, `docker mcp gateway run --servers docker` sobe com *0 tools*.
- **Sem Docker Desktop recente:** o gateway roda em Docker Engine/CE — baixe o binário do [docker/mcp-gateway](https://github.com/docker/mcp-gateway) para `~/.docker/cli-plugins/` e, se necessário, exporte `DOCKER_MCP_IN_CONTAINER=1`.
- ⚠️ **Superfície de risco:** a ferramenta monta `/var/run/docker.sock` e executa o Docker CLI com o poder do daemon. É inerente a qualquer MCP de Docker. Remova o servidor do `.mcp.json` se não quiser essa superfície.

---

## Início rápido

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

## Skills

| Comando | O que faz |
|---------|----------|
| `/vetor [--force]` | Porta de entrada — inicializa e configura o ambiente do Vetor no projeto-alvo |
| `/vetor:worktree-create <type> <slug> [issue#]` | Primitivo headless — cria worktree isolado sem prompts, todos os parâmetros via args |
| `/vetor:worktree-ship [issue#]` | Pipeline headless: test local → push → PR draft → CI watch → merge → sync root → cleanup |
| `/vetor:fix-loop <descrição>` | Loop autônomo reproduce → fix → rebuild → test (máx. 5 iterações) |
| `/vetor:backlog [tema]` | Ideação guiada ancorada em docs do projeto → batch de issues GitHub com aprovação humana |
| `/vetor:guardian [--cron]` | Audit + auto-fix de gaps que o pre-commit não cobre (JSON, migrations, worktrees, Dependabot) |
| `/vetor:coordinator [label] [--dry-run]` | Despacho paralelo de issues para sub-agentes com escalação de permissões e merge serializado |
| `/vetor:retro` | Avalia o uso do Vetor na sessão e propõe issues de melhoria no repositório do próprio plugin (não do projeto) |

> ⚠️ A skill `worktree-session` foi **aposentada** (monolítica demais, perdia contexto). Use a composição `worktree-create` + `worktree-ship` (e `coordinator` para orquestração). O arquivo legado fica em `legacy/worktree-session/` só como referência histórica e **não é carregado** pelo plugin.

---

## Configuração (opcional)

### Testes por projeto

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

### Permissões

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

### Delegação ao Gemini

Para economizar tokens, as skills podem delegar tarefas mecânicas de baixo risco ao CLI `agy` (Google Antigravity/Gemini CLI), seguindo o padrão **Gemini rascunha, Claude valida**:

- Resumir logs de CI longos antes do diagnóstico (`worktree-ship`, `fix-loop`)
- Rascunhar corpos de issue (`backlog`)
- Rascunhar mensagens de commit e relatórios (`guardian`)

É **totalmente opcional**: se `agy` não estiver no PATH, as skills fazem tudo inline. Correção de código, resolução de conflito e decisão de merge **nunca** são delegadas — ficam sempre com o Claude. Detalhes em `skills/shared/references/delegate-to-gemini.md`.

---

## Como funciona

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

### Subagente nativo

**`agents/issue-worker.md`** — subagente nativo do plugin (não uma skill), despachado pelo `issue-coordinator` uma vez por issue. Tem `tools` restritos e nunca faz `git push`, `gh pr create/merge/ready` por instrução; pré-carrega a skill `fix-loop-agent` via campo `skills:`. O que é aplicado por hook, e não por instrução: push para branch protegida, push/PR de worker não-GREEN, escrita fora do worktree e encerramento sem status file (ver "Hooks").

### Hooks

Hooks disparam **dentro dos subagentes** (o payload traz `agent_id`/`agent_type`), então são o único
mecanismo que aplica uma política de fato — instrução em prompt o agente pode ignorar.

**⚠️ Cobertura por plataforma:** A tabela abaixo lista os hooks do **Claude Code**. A cobertura no Antigravity é reduzida (ver seção "Compatibilidade com Antigravity" abaixo).

| Evento | Matcher | Script | O que faz |
|--------|---------|--------|-----------|
| `PreToolUse` | `Bash\|Edit\|Write` | `safety-check.ts` / `safety-check.sh` | Barra push para branch protegida; barra push/PR de worker não-GREEN; barra escrita fora do worktree (exceto o status file) |
| `PostToolUse` | `Edit\|Write` | `check-edit.ts` | Roda o typecheck no arquivo editado e injeta o erro no contexto do agente |
| `SubagentStop` | `vetor:issue-worker` | `check-status.ts` | Impede o worker de encerrar sem status file em estado terminal |
| `SessionStart` | — | `session-check.ts` | Avisa se o projeto ainda não rodou `/vetor` |
| `WorktreeCreate` | — | `prepare-worktree.ts` | Cria o worktree e prepara as dependências |

O `check-edit.ts` existe para poupar iterações do fix-loop: sem ele, um erro de tipo ou import quebrado
só apareceria ao **rodar o teste**, e cada descoberta dessas queima uma das 5 iterações do worker.
Com ele, o erro volta junto com o resultado do próprio `Edit`. Só age em `.ts`/`.tsx`, tem timeout de
20s e **fica em silêncio quando não há erro**.

#### Compatibilidade com Antigravity

**Claude Code** (`hooks/hooks.json`):
- ✅ `PreToolUse`, `PostToolUse`, `SubagentStop`, `SessionStart`, `WorktreeCreate`
- **Proteção**: completa. Bloqueia escrita fora do worktree, obriga status file em estado terminal, injeta diagnostics de edição

**Antigravity** (`hooks.json` na raiz):
- ✅ `PreToolUse` (suportado e configurado)
- ⚠️ `PostToolUse` (evento existe no Antigravity, mas **não está configurado** no `hooks.json`)
- ❌ `SubagentStop` (não existe. Antigravity tem um evento `Stop` genérico, mas não específico a subagentes; não é equivalente)
- ❌ `SessionStart` (não suportado)
- ❌ `WorktreeCreate` (não suportado)
- **Proteção**: reduzida. Apenas prévia de push/escrita via `PreToolUse`; **sem** diagnostics de edição ou garantia de status file

Para usar o Vetor com Antigravity, a restrição crítica é que workers podem escrever fora do worktree (além do `status file`), encerrar sem preenchê-lo, e não recebem feedback de tipo. Recomenda-se manter a invocação manual (`/vetor:fix-loop`, `/vetor:worktree-ship`) e **não usar `/vetor:coordinator`** com dispatch em background até que Antigravity suporte os eventos faltantes.

### Convenções do projeto (`.claude/rules/vetor/`)

O `/vetor` gera rules com frontmatter `paths`, que o Claude Code carrega **apenas** quando lê um
arquivo casando com o glob — custo zero de contexto quando irrelevante. Cada linha corresponde a um
fato lido do repositório (`deno.json`, `package.json`, arquivos de config do formatador/linter);
o que não foi detectado não vira regra, porque uma convenção inventada faria o worker "consertar"
código correto.

Rules ficam no subdiretório `vetor/` para não pisar nas suas, e não são sobrescritas sem `--force`.
**Commite-as**: os workers rodam em worktrees, que só contêm arquivos rastreados pelo git.

### Arquivos de referência compartilhados

- **`skills/shared/references/module-test-map.template.md`** — template de comandos de teste headless por módulo (ver "Testes por projeto").
- **`skills/shared/references/delegate-to-gemini.md`** — padrão opcional de delegação ao Gemini CLI.
- **`skills/shared/references/project-conventions.md`** — detecção de branch default e resolução do `module-test-map`, compartilhada por `fix-loop-agent`, `worktree-ship` e `worktree-create` (evita duplicar a mesma lógica três vezes).

### Observabilidade

Quando o `coordinator` despacha sub-agentes:

- **`AGENT_STATUS.md`** por worktree — cada agente atualiza seu status a cada iteração.
- **Tabela de status** no chat — coordinator consolida via `gh pr list`.
- **Escalação** — bloqueios de permissão e decisões técnicas são repassados ao usuário com opções (permitir / permitir para o agente / negar / parar).

### Decisões de design

**Por que orquestração própria (não claude-squad ou vibe-kanban).** Ambos são ferramentas de **supervisão interativa** (claude-squad via TUI/tmux, vibe-kanban via board web) — pressupõem um humano observando cada sessão ou card. O `issue-coordinator` é **dispatch autônomo em background**, que só aciona o humano quando bloqueado. Nenhum dos dois cobre os cinco diferenciais do coordinator: dispatch em lote por label, resiliência a reinício via `AGENT_STATUS.md` (arquivo em disco, não estado em memória), escalação seletiva via `AskUserQuestion`, hard caps explícitos e merge serializado. Além disso, o `vibe-kanban` está congelado desde a saída da Bloop.

**Sobre Agent Teams.** O recurso experimental de "Agent Teams" (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) **não é usado no dispatch autônomo do coordinator** — teammates in-process não sobrevivem a `/resume`, o que quebraria a resiliência a reinício garantida via arquivo. É usado só em dois pontos, com o humano como lead da sessão:

- `backlog-ideator`, para gerar propostas de issue a partir de múltiplas perspectivas (opcional);
- `fix-loop-agent`, para investigar causa raiz incerta com hipóteses concorrentes — **só quando invocado manualmente**, nunca no caminho orquestrado (subagentes não podem abrir seu próprio time).

Para habilitar, adicione ao `.claude/settings.json` do projeto (ou exporte no shell):

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

---

## Referência

### Hard caps

| Limite | Valor |
|--------|-------|
| Iterações do fix-loop | 5 |
| Retentativas de CI no ship | 3 |
| Timeout global do coordinator | 90 min |
| Workers simultâneos por rodada do coordinator | 5 (`maxConcurrentWorkers` em `.claude/vetor/config.json`) |

### Custo de tokens

Alavancas para manter o custo baixo no dispatch paralelo:

- **Teto de workers simultâneos no `issue-coordinator`** (ver Hard caps) — cada subagente paralelo é uma instância Claude completa sem contexto compartilhado, então é a alavanca mais direta contra o custo agregado. Grupos além do teto ficam `QUEUED` e só são despachados quando um worker ativo libera vaga. É contabilidade do próprio coordinator, não um bloqueio de plataforma — o Claude Code não tem mecanismo real de limite de tokens por subagente (verificado na doc oficial em 2026-07-02).
- **`tools` restritos no `issue-worker`** — menos ferramentas carregadas por invocação. A restrição de "nunca push/PR/merge" é de instrução/prompt; só o push para branches protegidas (`main`/`master`/`production`) é bloqueado de fato, via hook `PreToolUse`.
- **`model: haiku` por padrão no `issue-worker`**, com escalação para `sonnet` decidida pelo coordinator conforme tipo/labels da issue (`chore`/`fix` pequenos → `haiku`; `feat`/`refactor` → `sonnet`). Se uma issue em `haiku` esgotar as iterações do fix-loop, o coordinator redespacha uma vez com `sonnet` antes de desistir.
- **Subagentes em vez de Agent Teams** sempre que não houver necessidade real de debate entre pares — um subagente comum retorna só um resumo ao chamador; cada teammate é uma instância Claude completa e mais cara.
- **Delegação ao Gemini** para resumir logs de CI grandes antes de qualquer subagente/skill processá-los.

### Estrutura do repositório

```
.claude-plugin/
├── plugin.json              # manifesto do plugin
└── marketplace.json         # listagem do marketplace
agents/
└── issue-worker.md          # subagente nativo — worker isolado despachado pelo coordinator
skills/
├── shared/references/
│   ├── module-test-map.template.md
│   ├── delegate-to-gemini.md
│   └── project-conventions.md
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

[MIT](LICENSE) © 2026 Vitor Tavares Chaves.
