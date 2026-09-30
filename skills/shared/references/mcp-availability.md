# Verificação de Disponibilidade de MCP (Vetor)

Todas as skills que têm um caminho "Com MCP" / "Sem MCP (Fallback)" devem verificar disponibilidade
da mesma forma — esta referência centraliza o mecanismo para evitar que cada skill reinvente (ou
pule) a checagem.

## O mecanismo correto

Ferramentas de servidores MCP aparecem no seu namespace de ferramentas como
`mcp__<segmento-de-servidor>__<tool>` — diretas na lista de ferramentas disponíveis, ou listadas
por nome entre as ferramentas diferidas (que você carrega via `ToolSearch` antes de chamar). O
**segmento de servidor** é o trecho entre `mcp__` e o próximo `__`, e tem duas formas:

- **standalone** (registrado direto no projeto/usuário): `<server>` — ex.:
  `mcp__sentry__list_issues` (segmento `sentry`);
- **empacotado num plugin** (ex.: o próprio vetor): `plugin_<plugin>_<server>` — ex.:
  `mcp__plugin_vetor_context7__query-docs` (segmento `plugin_vetor_context7`).

**Verificar disponibilidade é simplesmente olhar se existe uma ferramenta cujo segmento de servidor
casa com o servidor relevante** — não é necessário rodar comando, nem tentar a chamada MCP "para ver
se funciona":

1. Procure na sua lista de ferramentas (diretas + diferidas, listadas em `<system-reminder>` no
   início da conversa e sempre que atualizadas) por qualquer nome `mcp__…` e extraia o segmento de
   servidor. O servidor `<server>` (ex.: `context7`, `sentry`, `docker`, `chrome-devtools`) casa
   quando o segmento **inteiro** é `<server>` ou começa com `plugin_` e termina com `_<server>`
   (`plugin_<plugin>_<server>`), sem distinguir maiúsculas de minúsculas. **Nunca por substring
   solta:** `docker` **não** casa `mcp__MCP_DOCKER__*` (segmento `MCP_DOCKER`, o gateway de MCPs do
   Docker é outro servidor).
2. **Se existir:** o MCP está disponível. Se a ferramenta estiver na lista de diferidas, carregue-a
   primeiro com `ToolSearch({query: "select:<tool_name>"})` antes de chamá-la.
3. **Se não existir nenhum segmento correspondente:** o MCP não está configurado nesta sessão — vá
   direto para o fallback documentado na skill (CLI `gh`, query SQL manual, etc.). Não gaste uma
   chamada tentando invocar uma ferramenta MCP inexistente só para descobrir que falha.
4. **Quando houver mais de um segmento correspondente para o mesmo serviço**, use esta ordem de
   preferência (única definição — as skills referenciam este item, não a repetem): (1) o do próprio
   plugin, `plugin_vetor_<server>`, pois compartilha o ciclo de vida e a configuração do plugin;
   (2) o standalone, `<server>`; (3) o de outro plugin, `plugin_<outro>_<server>` (o primeiro na
   lista). Ao chamar mais de uma ferramenta do mesmo serviço (ex.: `resolve-library-id` e
   `query-docs`), use sempre o mesmo segmento.

## Por que não "tentar e capturar erro"

Tentar chamar uma ferramenta MCP e cair para o fallback só se ela falhar desperdiça uma chamada de
ferramenta (e o turno associado) sempre que o MCP não está configurado — que é exatamente o caso mais
comum hoje. Como a lista de ferramentas já informa antecipadamente o que está disponível, a checagem
correta é estática (olhar a lista), não uma tentativa em runtime.

## Servidores relevantes neste plugin

Cada servidor abaixo casa pelas duas formas de segmento (ver "O mecanismo correto"): standalone
`mcp__<server>__` ou empacotado `mcp__plugin_<plugin>_<server>__`. O plugin vetor empacota
`context7`, `chrome-devtools` e `docker` (`.mcp.json`) — numa sessão com o vetor, o nome real
desses três é `mcp__plugin_vetor_<server>__`.

| Observabilidade (Sentry/Datadog) | `mcp__sentry__` / `mcp__datadog__` (ou `mcp__plugin_<plugin>_sentry__` / `mcp__plugin_<plugin>_datadog__`) | `backlog-ideator` §2.a (opcional) |
| Banco de dados | `mcp__<db>__` (ou `mcp__plugin_<plugin>_<db>__`; o nome `<db>` depende do MCP configurado) | `guardian` (auditoria de schema/queries) |
| Docker | `mcp__docker__` (ou `mcp__plugin_<plugin>_docker__`; **não** `mcp__MCP_DOCKER__`) | `guardian` (auditoria de saúde de containers) |
| Browser (chrome-devtools) | `mcp__chrome-devtools__` (ou `mcp__plugin_<plugin>_chrome-devtools__`) | `fix-loop-agent` (reproduzir bug de UI antes do fix), `worktree-ship` (checagem e2e leve antes do PR) |
| Pesquisa web (Exa) | `mcp__exa__` (ou `mcp__plugin_<plugin>_exa__`) | `backlog-ideator` (pesquisar padrões/arquitetura antes de propor issue), `fix-loop-agent` (pesquisar mensagem de erro/documentação de uma lib externa), `issue-worker` (checar docs de API externa durante a implementação) |
| Documentação de ferramentas/libs (Context7) | `mcp__context7__` (ou `mcp__plugin_<plugin>_context7__`) | **Obrigatório quando disponível** (ver issue vetor#163) — qualquer skill que precise pesquisar comportamento de uma ferramenta/lib/framework/API externa (`issue-worker`, `fix-loop-agent`, `guardian`, `backlog-ideator`) |
| Documentação do próprio Claude Code (`claude-code-docs`) | `mcp__claude-code-docs__` (ou `mcp__plugin_<plugin>_claude-code-docs__`) | **Obrigatório quando disponível** (ver issue vetor#164) — qualquer skill que precise responder sobre o funcionamento do próprio Claude Code (hooks, slash commands, MCP, permissões, SDK) (`vetor` (setup), `retro`) |

### Documentação de ferramentas/libs (Context7)

Use antes de afirmar comportamento de uma ferramenta, biblioteca, framework, SDK ou API externa —
não confie só no conhecimento pré-treinado do agente, que pode estar desatualizado.

- **Com MCP (obrigatório):** localize o servidor `context7` pela regra de segmento acima (ex.:
  `mcp__context7__resolve-library-id` ou `mcp__plugin_vetor_context7__resolve-library-id`; com mais
  de um, siga a ordem do item 4). Use `resolve-library-id` do segmento escolhido para achar o library
  ID, depois `query-docs` do mesmo segmento com uma pergunta específica e escopada a um único
  conceito.
- **Sem MCP (fallback):** siga sem o MCP, sinalizando a limitação no resultado entregue ao usuário —
  não bloqueia a skill.

### Documentação do próprio Claude Code (`claude-code-docs`)

Use antes de afirmar comportamento do próprio Claude Code (hooks, slash commands, configuração de
MCP, permissões, SDK de agentes, comportamento do harness) — evita responder de memória sobre um
produto que muda rápido.

- **Com MCP (obrigatório):** consulte via `mcp__claude-code-docs__*` antes de afirmar comportamento
  do produto. Registro: `claude mcp add --transport http claude-code-docs https://code.claude.com/docs/mcp`
  (endpoint oficial confirmado via Context7 contra `code.claude.com/docs/en/mcp-quickstart` —
  **não** usar `https://claude.com` nem `https://code.claude.com/docs/en/`, que são páginas HTML e
  não conectam como MCP).
- **Sem MCP (fallback):** siga sem o MCP, sinalizando a limitação no resultado — não bloqueia a
  skill. Nota: há sobreposição parcial com o agente `claude-code-guide` já existente no Vetor/Claude
  Code para dúvidas sobre o próprio produto; ao implementar, avaliar se o MCP substitui ou
  complementa esse agente.

### Pesquisa web (Exa)

Use quando a tarefa precisa de busca na web ou fetch de uma página específica — pesquisar
documentação externa, mensagens de erro pouco usuais, padrões de arquitetura, ou conteúdo de uma
URL já conhecida. Não é um substituto do Context7 (ver issue vetor#163 — Context7 é o caminho
preferido para documentação de ferramentas/bibliotecas quando disponível); use Exa para busca web
geral e fetch de páginas que o Context7 não cobre.

- **Com MCP:** use `mcp__exa__web_search_exa` para busca geral e `mcp__exa__web_fetch_exa` para
  buscar o conteúdo de uma URL específica. Se o servidor tiver sido registrado com
  `web_search_advanced_exa` habilitado (query param `tools=` na URL do MCP), prefira essa variante
  para buscas que precisem de filtros mais refinados.
- **Sem MCP (fallback):** prossiga sem pesquisa web — baseie a resposta no conhecimento do agente e
  nos arquivos do projeto, sinalizando a limitação quando a falta de pesquisa externa for relevante
  para a conclusão.

**Autenticação:** o Exa MCP usa OAuth (sem API key) — a primeira conexão abre o navegador para login
na conta Exa. Não é necessário configurar segredo nenhum no ambiente do Vetor.

### Browser (chrome-devtools)

Use só quando a tarefa envolve UI/frontend (bug reportado como visual, PR que altera componentes de
interface). Não invoque para módulos puramente backend/CLI.

- **Com MCP:** navegue até a página relevante (`mcp__chrome-devtools__navigate_page`), reproduza o
  cenário (`click`/`fill`/`fill_form`) e capture evidência (`take_screenshot`,
  `list_console_messages`, `list_network_requests`) antes de propor o fix. No `worktree-ship`, use o
  mesmo fluxo como checagem e2e leve (navegar pelo fluxo alterado e conferir ausência de erros de
  console) antes de abrir o PR — nunca como substituto dos testes automatizados do módulo.
- **Sem MCP (fallback):** prossiga sem reprodução visual — baseie o diagnóstico/fix na descrição do
  bug, logs de erro e testes existentes, como já era feito antes deste mecanismo.

Cada skill que referencia este documento deve nomear o servidor esperado (ex.: "Observabilidade" na seção
acima) antes de aplicar o mecanismo — este documento define *como* checar, não *quais* servidores
uma skill específica precisa.
