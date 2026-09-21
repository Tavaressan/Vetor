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

## Hooks — formato camelCase, schema de payload confirmado, mas caminho de destino incompatível com o writer atual

Confirmado em `cursor.com/docs/hooks`: hooks vivem em `hooks.json` (JSON, `stdin`/`stdout`, exit
code `2` bloqueia — "This matches Claude Code behavior for compatibility"), com **nomes de evento em
camelCase** (`preToolUse`, `postToolUse`, `beforeShellExecution`, `afterShellExecution`,
`beforeReadFile`, `afterFileEdit`, `subagentStart`, `subagentStop`, `beforeSubmitPrompt`,
`preCompact`, `stop`, `sessionStart`, `sessionEnd`, `afterAgentResponse`, `afterAgentThought`,
`workspaceOpen`) — cobertura de eventos maior que Codex e OpenCode, mas **payload por evento
diferente do Claude Code** (ex.: `beforeShellExecution` expõe `command` como campo de topo, não
`tool_input.command` aninhado; `preToolUse` não documenta payload de entrada específico por tipo de
tool). Achado favorável: a variável de ambiente `CLAUDE_PROJECT_DIR` é injetada automaticamente nos
hooks do Cursor "(Claude compatibility)" — mas isso não substitui a adaptação de schema de payload
necessária para reaproveitar `scripts/safety-check.ts`/`scripts/check-edit.ts` como estão.

**Caminho de destino do arquivo, não só o formato, diverge:** hooks de projeto carregam de
`<project-root>/.cursor/hooks.json` — um **arquivo único na raiz de `.cursor/`**, não
`.cursor/hooks/hooks.json` (diretório). O `SOURCE_DIRS`/`installFiles()` deste repositório
(`cli/lib/installer/writer.js`) copia `hooks/` inteiro para `<destino>/hooks/...`, sempre um
subdiretório — então mesmo com `cursor: '.cursor'` em `ENGINE_DEST_DIR`, uma cópia direta de
`hooks/hooks.json` cairia em `.cursor/hooks/hooks.json`, onde o Cursor **não o descobre**. Esse é o
mesmo tipo de gap já documentado (e deliberadamente não resolvido pelo writer, ver comentário em
`writer.js`) para OpenCode (hooks são TS em `.opencode/plugin/*.ts`, não JSON) e para Antigravity
(`.antigravity` não é sequer uma âncora documentada) — **decisão consciente**: tratar hooks como
gap conhecido e documentado por engine em vez de complicar `installFiles()` com destino
por-subdiretório-por-engine (YAGNI: nenhuma engine hoje usa o layout genérico de `hooks/` tal como
o writer copia). Tradução de `hooks/hooks.json` para o schema de payload + caminho do Cursor fica
como trabalho futuro, fora do escopo desta issue.

**Formato de plugin** (`cursor.com/docs/reference/plugins`): quando empacotado como *Cursor Plugin*
(`.cursor-plugin/plugin.json`, análogo a `.codex-plugin/plugin.json`), a descoberta padrão de hooks
*dentro do plugin* é `hooks/hooks.json` relativo à raiz do plugin — mas essa é uma rota de
distribuição via marketplace/instalação de plugin (`~/.cursor/plugins/local` ou Customize), **não**
o mecanismo `vetor install` (cópia direta de arquivo) usado por este CLI. As duas rotas não se
confundem: `.cursor-plugin/plugin.json` deste repositório é só um manifesto de referência para quem
quiser instalar o Vetor como Cursor Plugin nativo (mesmo papel que `.codex-plugin/plugin.json` já
cumpre para o Codex) — inclui apenas `skills`. `agents` fica de fora do manifesto de propósito: a
tabela de descoberta de componentes (`cursor.com/docs/reference/plugins#cursor-plugin-component-discovery`)
escaneia `agents/` por `.md`/`.mdc`/`.markdown`, e `agents/issue-worker.md`/`agents/code-review.md`
deste repositório usam frontmatter do Claude Code (`tools`, `isolation`) — campos que o parser de
agente do Cursor **não documenta reconhecer**, diferente do que está confirmado para skills (`name`/
`description`, campos extras ignorados). Sem validar isso contra o parser real, incluir `agents` no
manifesto do plugin seria uma alegação não verificada; o caminho `.cursor/agents/` via
`vetor install` (writer, abaixo) já cobre a descoberta confirmada por `docs/subagents#file-locations`
sem depender dessa inferência. `hooks` também fica de fora do manifesto até a tradução de schema ser
feita.

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
descoberta nativa). `hooks/` é copiado para `.cursor/hooks/...` por consistência com as demais
engines, mas **não é descoberto pelo Cursor** nesse caminho (ver seção Hooks acima) — limitação
conhecida, documentada no comentário do writer, não escondida do usuário.

## Resumo da confiança por componente

| Componente | Confiança | Fonte |
| --- | --- | --- |
| `.cursor/rules/*.mdc`, `AGENTS.md` | Confirmado via docs oficiais | `cursor.com/docs/rules` |
| `.cursorrules` legado/deprecado | Confirmado via docs oficiais | `cursor.com/help/customization/rules` |
| Skills em `.cursor/skills/` + compat `.claude/skills/`/`.codex/skills/` | Confirmado via docs oficiais | `cursor.com/docs/skills` |
| Subagentes em `.cursor/agents/` + compat `.claude/agents/`/`.codex/agents/` | Confirmado via docs oficiais | `cursor.com/docs/subagents` |
| Schema de payload de hooks (camelCase, campos por evento) | Confirmado via docs oficiais | `cursor.com/docs/hooks` |
| Caminho `.cursor/hooks.json` (arquivo único, não diretório) | Confirmado via docs oficiais | `cursor.com/docs/hooks#configuration` |
| Comportamento do parser do Cursor diante de campos de frontmatter desconhecidos em `agents/*.md` (`tools`, `isolation`) | **Não confirmado** — inferido por analogia ao padrão de skills | — |
| `agent`/`cursor-agent` como symlinks do mesmo binário | Confirmado via script de instalação real | `cursor.com/install` |
| **Instalação end-to-end validada contra o Cursor real instalado** | **Não feito nesta investigação** — sem Cursor/CLI instalado nesta máquina | — |

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
5.  Registre desvios encontrados como issue de acompanhamento (mesmo padrão usado para os gaps do
    Codex e OpenCode).

---

[← Wiki do Vetor](Home.md)
