# Compatibilidade — Cursor

Investigação feita em 2026-09-21 contra a **documentação oficial** (`cursor.com/docs/rules`,
`/docs/skills`, `/docs/subagents`, `/docs/hooks`, `/docs/plugins`, `/docs/reference/plugins`,
`/docs/cli/*`) e o **script real de instalação do CLI** (`curl -fsS https://cursor.com/install`,
baixado e inspecionado nesta investigação — build `2026.09.18-9a7762b`). Sem CLI `cursor`/`agent`
instalado nesta máquina para validar comportamento observado, ao contrário do que foi feito para o
OpenCode; todo o conteúdo abaixo é **confirmado contra a doc oficial e/ou o script de instalação**,
não inferido a partir de heurística de terceiros. Onde a confiança é menor, isso é sinalizado
explicitamente.

**Nota sobre a âncora original da issue:** a premissa de partida (`.cursorrules`/`.cursor/`) estava
parcialmente desatualizada — `.cursorrules` na raiz do projeto é confirmado como **legado, em vias
de descontinuação** (`cursor.com/help/customization/rules#how-do-i-migrate-from-cursorrules`: "The
`.cursorrules` file in your project root is legacy and will be deprecated"). O formato atual é
`.cursor/rules/*.mdc`.

## Rules

Rules vivem em `.cursor/rules/*.mdc` (extensão obrigatória — um `.md` solto em `.cursor/rules` é
**ignorado** pelo sistema de rules por não ter o frontmatter YAML esperado). Cada rule é markdown
com frontmatter controlando quando ela é aplicada:

| `alwaysApply` | `description` | `globs` | Comportamento |
| --- | --- | --- | --- |
| `true` | — | — | Sempre incluída |
| `false` | — | presente | Auto-anexada quando um arquivo do glob está em contexto |
| `false` | presente | ausente | Agent decide incluir com base na `description` |
| `false` | ausente | ausente | Só incluída com `@rule-name` explícito no chat |

Alternativa mais simples: `AGENTS.md` na raiz (ou subdiretórios) — markdown puro sem frontmatter,
**a mesma âncora já usada para detectar Codex** neste repositório (`detector.js`). Ou seja: um
projeto com só `AGENTS.md` detecta como Codex, não como Cursor — sobreposição real, não um bug.

## Skills — compatível sem tradução (achado de maior confiança desta investigação)

Confirmado em `cursor.com/docs/skills#skill-directories`: Cursor descobre `SKILL.md` (mesmo formato
de frontmatter `name`/`description` do Claude Code — campos extras são ignorados) em:

- `.cursor/skills/`, `.agents/skills/` (projeto)
- `~/.cursor/skills/`, `~/.agents/skills/` (usuário)
- **Para compatibilidade, também em `.claude/skills/` e `.codex/skills/`** (projeto e usuário)

Consequência prática direta: como as `SKILL.md` deste repositório já são agnósticas de engine desde
a issue #251 (sem `$CLAUDE_PLUGIN_ROOT` no corpo do texto), **um projeto que já instalou o Vetor para
Claude Code (`.claude/skills/`) ganha as skills no Cursor sem nenhum trabalho adicional** — o Cursor
lê o mesmo diretório nativamente. A entrada `cursor` deste writer só passa a importar para quem quer
Cursor como alvo *exclusivo* (sem `.claude/` no projeto).

## Subagentes (Custom Subagents)

Confirmado em `cursor.com/docs/subagents#file-locations`: arquivo markdown com frontmatter YAML em

| Escopo | Localização | Observação |
| --- | --- | --- |
| Projeto | `.cursor/agents/` | Precedência mais alta em conflito de nome |
| Projeto (compat) | `.claude/agents/` | |
| Projeto (compat) | `.codex/agents/` | |
| Usuário | `~/.cursor/agents/`, `~/.claude/agents/`, `~/.codex/agents/` | |

Campos de frontmatter (`cursor.com/docs/subagents#configuration-fields`): `name`, `description`,
`model` (`inherit` por padrão), `readonly` (bool), `is_background` (bool). **Gaps confirmados** em
relação ao Claude Code:

- **Sem `tools:` allowlist por agente.** O único controle de permissão é o campo binário
  `readonly` (bloqueia edição de arquivo e comandos que mudam estado) — não há granularidade por
  ferramenta como no Claude Code.
- **Sem `isolation: worktree` declarativo no frontmatter.** Isolamento de worktree existe
  (`cursor.com/docs/subagents#isolated-project-copies`: "Ask for isolation and each subagent runs
  in its own copy of the project" — worktree Git separado), mas é acionado por **instrução em
  linguagem natural no prompt** ("run this in an isolated copy"), não por uma propriedade
  configurável do arquivo do subagente. Mesma classe de risco documentada para Codex e OpenCode:
  sem um hook que force isolamento, depende de o prompt do agente pedir explicitamente — igual ao
  padrão já usado em `agents/issue-worker.md` (instrução no prompt, reforçada por hook nos outros
  engines onde hook existe).

Os `agents/*.md` deste repositório (ex.: `agents/issue-worker.md`, `agents/code-review.md`) usam
frontmatter Claude Code (`name`, `description`, `tools`, `model`, `isolation`). Campos que o Cursor
não reconhece (`tools`, `isolation`) são adicionais ao schema documentado — o comportamento exato do
parser do Cursor diante de campos desconhecidos **não foi verificado contra uma instância real**
(inferido por analogia ao padrão "campos extras ignorados" confirmado para skills, não confirmado
para agents especificamente).

## Hooks — traduzidos em tempo de instalação para o schema e caminho reais do Cursor (issue #284)

Confirmado diretamente em `cursor.com/docs/hooks.md` e
`cursor.com/docs/reference/third-party-hooks.md` (buscados via `curl` nesta investigação — as
duas páginas servem Markdown limpo no sufixo `.md`, ao contrário do que a investigação da issue
#256 presumiu ao concluir "sem acesso à internet nesta máquina"; ambiente de execução, não
limitação de rede real).

**Schema confirmado** (`cursor.com/docs/hooks#configuration`):

```json
{
  "version": 1,
  "hooks": {
    "<eventoCamelCase>": [
      { "command": "<script>", "matcher": "<regex opcional>", "timeout": 30 }
    ]
  }
}
```

`version` é obrigatório (inteiro, hoje sempre `1`). Cada entrada de evento é um **array plano**
de `{command, matcher?, timeout?, type?, loop_limit?, failClosed?}` — diferente do Claude Code,
que aninha `hooks[].hooks[]` (um nível de `matcher` por fora, um array de `{type,command}` por
dentro). Nomes de evento em **camelCase**: `preToolUse`, `postToolUse`, `postToolUseFailure`,
`beforeShellExecution`, `afterShellExecution`, `beforeMCPExecution`, `afterMCPExecution`,
`beforeReadFile`, `afterFileEdit`, `subagentStart`, `subagentStop`, `beforeSubmitPrompt`,
`preCompact`, `stop`, `sessionStart`, `sessionEnd`, `afterAgentResponse`, `afterAgentThought`,
`beforeTabFileRead`, `afterTabFileEdit`, `workspaceOpen`.

**Caminho de destino, confirmado**: hooks de projeto carregam de
`<project-root>/.cursor/hooks.json` — um **arquivo único na raiz de `.cursor/`**, nunca
`.cursor/hooks/hooks.json` (diretório).

**Mapeamento de terceiros confirmado em `docs/reference/third-party-hooks.md`** (o Cursor até
consegue carregar `.claude/settings.json` nativamente como import de terceiros, mas essa rota lê
`.claude/settings.json`/`.claude/settings.local.json` — nunca o `.claude/hooks/hooks.json` que
`vetor install` gera para a engine Claude Code, então não se aplica ao instalador deste
repositório). A tabela "Hook Step Mapping" dessa página é a fonte usada pelo tradutor:

| Claude Code | Cursor |
| --- | --- |
| `PreToolUse` | `preToolUse` |
| `PostToolUse` | `postToolUse` |
| `UserPromptSubmit` | `beforeSubmitPrompt` |
| `Stop` | `stop` |
| `SubagentStop` | `subagentStop` |
| `SessionStart` | `sessionStart` |
| `SessionEnd` | `sessionEnd` |
| `PreCompact` | `preCompact` |

E a tabela "Tool Name Mapping" (usada para traduzir o `matcher` de `PreToolUse`/`PostToolUse`,
que no Cursor filtra pelo vocabulário de tool do Cursor, não do Claude Code): `Bash` → `Shell`,
`Read` → `Read`, `Write` → `Write`, `Edit` → `Write` (o Cursor não distingue edição de escrita
nova), `Grep` → `Grep`, `Task` → `Task`.

### Implementação

`cli/lib/installer/cursor-hooks.js` exporta `translateHooksForCursor(sourceHooksJson)`: lê
`hooks/hooks.json` (fonte agnóstica), traduz nomes de evento e achata `matcher`/`hooks[]`
aninhado no formato plano do Cursor, incluindo a tradução do `matcher` de tool via
`TOOL_NAME_MAP` (com dedupe — `Bash|Edit|Write` vira `Shell|Write`, não `Shell|Write|Write`).
`validateCursorHooksSchema(hooksJson)` valida o resultado contra os nomes de evento documentados
e a obrigatoriedade de `command`/tipos de `timeout`/`matcher` — sem depender de lib externa (este
pacote não tem dependências de runtime).

`cli/lib/installer/writer.js` (`installCursorHooks`) chama essa tradução para a engine `cursor`
em vez do loop genérico de cópia byte-a-byte, e grava o resultado em `.cursor/hooks.json`
(arquivo único). `ENGINE_EXCLUDED_SOURCE_DIRS.cursor` foi removido — a exclusão só existia
porque a cópia bruta anterior era inerte, e isso deixou de ser verdade. O manifesto de
idempotência (`.vetor/install-manifest.json`) guarda o hash do **conteúdo traduzido**, não da
fonte, para que a segunda `vetor install` continue reconhecendo o arquivo como gerenciado por
este instalador (uma comparação contra o hash da fonte nunca bateria, gerando falso
`user-modified` para sempre).

### Gaps confirmados, mantidos conscientemente (não silenciados)

- **`WorktreeCreate` sem equivalente no Cursor** (mesma classe de gap já documentada para o
  Codex, `wiki/Compatibilidade-Codex.md`): não existe evento de hook de "worktree acabou de ser
  criado" na doc do Cursor. `translateHooksForCursor` descarta o evento e reporta em `dropped`
  (`{event: "WorktreeCreate", reason: "no-cursor-equivalent"}`) — não é copiado, não aparece no
  `.cursor/hooks.json` gerado.
- **Matcher de `SubagentStop` não é traduzível com fidelidade semântica.** No Claude Code, o
  matcher `vetor:issue-worker` filtra por *nome* de subagente (definido em
  `agents/issue-worker.md`). No Cursor, o matcher de `subagentStop` filtra por
  **`subagent_type`**, um enum fixo (`generalPurpose`, `explore`, `shell`, ...) sem conceito de
  nome customizado — não há como expressar "só para o subagente issue-worker" no schema nativo do
  Cursor. `translateHooksForCursor` mantém o hook (`check-status.ts` continua rodando), mas
  **remove o matcher**, reportando o gap (`{event: "SubagentStop", reason:
  "matcher-not-translatable"}`). Consequência prática: no Cursor, `check-status.ts` roda para
  **qualquer** término de subagente, não só issue-worker — aceitável porque o próprio script
  resolve o worktree pelo `cwd`/`agent_id` do payload e não bloqueia quando não há
  correspondência (`scripts/lib/status.ts`), mas é uma diferença de comportamento real, não só de
  nomenclatura.
- **`${CLAUDE_PLUGIN_ROOT}` não é substituído.** Os comandos traduzidos preservam a variável
  literal (`deno run -A "${CLAUDE_PLUGIN_ROOT}/scripts/safety-check.ts"`), mas o Cursor **não
  define** essa variável — só `CURSOR_PROJECT_DIR`/`CLAUDE_PROJECT_DIR` (raiz do projeto, "Claude
  compatibility") e outras variáveis de sessão (`cursor.com/docs/hooks#environment-variables`).
  Isso não é um gap novo desta tradução: `SOURCE_DIRS` em `writer.js` (`['skills', 'agents',
  'hooks']`) nunca copiou `scripts/` para o projeto-alvo, para **nenhuma** engine — o hook
  traduzido para o Cursor tem o mesmo problema de resolução de path que o `.claude/hooks.json`
  gerado para a própria engine Claude Code via `vetor install` já tinha antes desta issue.
  Resolver a distribuição de `scripts/` para o projeto-alvo é trabalho futuro, fora do escopo de
  #284 (não é um gap específico do Cursor).
- **Rota "Cursor Plugin" (`.cursor-plugin/plugin.json`) continua sem `hooks`.** A tradução acima
  serve só à rota `vetor install` (cópia direta de arquivo). Quando empacotado como *Cursor
  Plugin* (`cursor.com/docs/reference/plugins`, descoberta padrão de hooks em `hooks/hooks.json`
  relativo à raiz do plugin — formato bruto do Claude Code, não o nativo do Cursor), o manifesto
  de referência deste repositório (`.cursor-plugin/plugin.json`) segue incluindo só `skills`;
  adicionar `hooks` a essa rota exigiria descobrir se o carregador de plugin do Cursor também
  espera o schema nativo ali (não verificado) — fora do escopo desta issue.

## CLI e detecção

Confirmado via `cursor.com/docs/cli/installation` **e o próprio script de instalação**
(`curl -fsS https://cursor.com/install`, baixado nesta investigação): o instalador cria dois
symlinks apontando para o mesmo executável —

```
ln -s .../cursor-agent ~/.local/bin/agent
ln -s .../cursor-agent ~/.local/bin/cursor-agent
```

`agent` é o nome "primary" hoje na doc (`agent --version`, `agent update`, `agent resume`), mas
**`cursor-agent` é mantido como alias "legacy" pelo instalador atual** (build `2026.09.18`, 3 dias
antes desta investigação) — não é um nome abandonado. Decisão de detecção: usar `cursor-agent` como
sinal de comando no PATH, **não** `agent`. `agent` é um nome genérico de alta probabilidade de colisão
com binários não relacionados ao Cursor (ex.: outros agentes de observabilidade/orquestração que
também instalam um `agent` no PATH do usuário) — usar `commandExists('agent', env)` inflaria falsos
positivos em `detectEngines()`. `cursor-agent` carrega o mesmo sinal com risco de colisão muito
menor, ao custo de depender de uma instalação que já tenha passado pelo script atual (instalações
antigas sem o symlink `cursor-agent` não seriam pegas por esse sinal específico — mas o anexo de
diretório `.cursor/` cobre esse caso de qualquer forma).

## Detecção implementada (`cli/lib/installer/detector.js`)

```js
{
  id: 'cursor',
  name: 'Cursor',
  detect: (root, env) =>
    isDirectory(path.join(root, '.cursor')) || commandExists('cursor-agent', env),
}
```

## Destino de instalação (`cli/lib/installer/writer.js`)

`ENGINE_DEST_DIR.cursor = '.cursor'`. `skills/` e `agents/` copiados por `installFiles()` funcionam
**sem tradução** (`.cursor/skills/...`, `.cursor/agents/...` — ambos confirmados como caminhos de
descoberta nativa). `hooks/hooks.json` é **traduzido** (não copiado bruto) para
`.cursor/hooks.json` via `installCursorHooks`/`translateHooksForCursor` — ver seção Hooks acima
para o schema, o mapeamento de eventos/tools e os gaps conhecidos (issue #284).

## Resumo da confiança por componente

| Componente | Confiança | Fonte |
| --- | --- | --- |
| `.cursor/rules/*.mdc`, `AGENTS.md` | Confirmado via docs oficiais | `cursor.com/docs/rules` |
| `.cursorrules` legado/deprecado | Confirmado via docs oficiais | `cursor.com/help/customization/rules` |
| Skills em `.cursor/skills/` + compat `.claude/skills/`/`.codex/skills/` | Confirmado via docs oficiais | `cursor.com/docs/skills` |
| Subagentes em `.cursor/agents/` + compat `.claude/agents/`/`.codex/agents/` | Confirmado via docs oficiais | `cursor.com/docs/subagents` |
| Schema de `.cursor/hooks.json` (`version`, array plano `{command,matcher,timeout}` por evento) | Confirmado via docs oficiais, buscadas via `curl` | `cursor.com/docs/hooks#configuration` |
| Caminho `.cursor/hooks.json` (arquivo único, não diretório) | Confirmado via docs oficiais | `cursor.com/docs/hooks#configuration` |
| Mapeamento de nomes de evento e de tool (Claude Code → Cursor) usado por `translateHooksForCursor` | Confirmado via docs oficiais | `cursor.com/docs/reference/third-party-hooks` |
| Tradução de `hooks/hooks.json` → `.cursor/hooks.json` (`cli/lib/installer/cursor-hooks.js`) validada contra o schema documentado | Confirmado — teste automatizado (`cli/test/installer-cursor-hooks.test.js`) | `cursor.com/docs/hooks` |
| Comportamento do parser do Cursor diante de campos de frontmatter desconhecidos em `agents/*.md` (`tools`, `isolation`) | **Não confirmado** — inferido por analogia ao padrão de skills | — |
| `agent`/`cursor-agent` como symlinks do mesmo binário | Confirmado via script de instalação real | `cursor.com/install` |
| Schema de `.cursor-plugin/plugin.json` (campo `skills` como string/array de path relativo) | Confirmado via docs oficiais | `cursor.com/docs/reference/plugins` |
| **Instalação end-to-end validada contra o Cursor real instalado** (incluindo o `.cursor/hooks.json` traduzido de fato bloqueando uma ação) | **Não feito nesta investigação** — sem Cursor/CLI instalado nesta máquina | — |

## Teste manual pendente

Este repositório não tem o Cursor (editor ou CLI) instalado no ambiente onde esta investigação foi
feita. A cobertura automatizada (`cli/test/installer-detector.test.js`,
`cli/test/installer-writer.test.js`) verifica detecção (âncora de diretório e comando no PATH) e que
`installFiles()` copia bytes para o caminho de destino documentado (`.cursor/skills/...`,
`.cursor/agents/...`) — **não** verifica que o *conteúdo* dos arquivos reais (`skills/*/SKILL.md`,
`agents/*.md`) satisfaz o parser de frontmatter do Cursor, nem que o Cursor real, ao abrir o
projeto, de fato reconhece o que foi gerado. Procedimento para quem for validar manualmente:

1.  Rode `vetor install` com Cursor selecionado em um projeto de teste.
2.  Abra o projeto no Cursor (editor ou `cursor-agent`/`agent` CLI).
3.  Abra **Customize → Skills** e confirme que as skills do Vetor aparecem listadas.
4.  Abra **Customize** e confirme que os subagentes (`.cursor/agents/*.md`) aparecem, mesmo com os
    campos `tools`/`isolation` extras no frontmatter (confirmar se são ignorados ou causam erro de
    parse — ponto não verificado nesta investigação, ver tabela acima).
5.  Abra a aba **Hooks** em Customize e confirme que `.cursor/hooks.json` foi carregado sem erro
    de parse, com os 4 eventos traduzidos (`preToolUse`, `postToolUse`, `subagentStop`,
    `sessionStart`) listados. Dispare uma ação que o `safety-check.ts` bloquearia no Claude Code
    (ex.: editar um arquivo fora do worktree esperado) e confirme que o Cursor de fato bloqueia —
    isso depende de `${CLAUDE_PLUGIN_ROOT}` resolver no ambiente onde o Cursor roda o script, o
    que **não é garantido pela tradução** (ver gap documentado na seção Hooks).
6.  Registre desvios encontrados como issue de acompanhamento (mesmo padrão usado para os gaps do
    Codex e OpenCode).

---

[← Wiki do Vetor](Home.md)
