# Verificação de Disponibilidade de MCP (Vetor)

Todas as skills que têm um caminho "Com MCP" / "Sem MCP (Fallback)" devem verificar disponibilidade
da mesma forma — esta referência centraliza o mecanismo para evitar que cada skill reinvente (ou
pule) a checagem.

## O mecanismo correto

Ferramentas de servidores MCP aparecem no seu namespace de ferramentas com o prefixo
`mcp__<server>__<tool>` (ex.: `mcp__sentry__list_issues`) — diretas na
lista de ferramentas disponíveis, ou listadas por nome entre as ferramentas diferidas (que você
carrega via `ToolSearch` antes de chamar).

**Verificar disponibilidade é simplesmente olhar se algum nome com esse prefixo existe** — não é
necessário rodar comando, nem tentar a chamada MCP "para ver se funciona":

1. Procure na sua lista de ferramentas (diretas + diferidas, listadas em `<system-reminder>` no
   início da conversa e sempre que atualizadas) por qualquer nome começando com `mcp__<server>__`,
   onde `<server>` é o servidor relevante para a tarefa (sentry/observabilidade,
   banco de dados).
2. **Se existir:** o MCP está disponível. Se a ferramenta estiver na lista de diferidas, carregue-a
   primeiro com `ToolSearch({query: "select:<tool_name>"})` antes de chamá-la.
3. **Se não existir nenhum nome com esse prefixo:** o MCP não está configurado nesta sessão — vá
   direto para o fallback documentado na skill (CLI `gh`, query SQL manual, etc.). Não gaste uma
   chamada tentando invocar uma ferramenta MCP inexistente só para descobrir que falha.

## Por que não "tentar e capturar erro"

Tentar chamar uma ferramenta MCP e cair para o fallback só se ela falhar desperdiça uma chamada de
ferramenta (e o turno associado) sempre que o MCP não está configurado — que é exatamente o caso mais
comum hoje. Como a lista de ferramentas já informa antecipadamente o que está disponível, a checagem
correta é estática (olhar a lista), não uma tentativa em runtime.

## Servidores relevantes neste plugin

| Observabilidade (Sentry/Datadog) | `mcp__sentry__` / `mcp__datadog__` | `backlog-ideator` §2.a (opcional) |
| Banco de dados | `mcp__<db>__` (nome depende do MCP configurado) | `guardian` (auditoria de schema/queries) |
| Docker | `mcp__docker__` | `guardian` (auditoria de saúde de containers) |
| Browser (chrome-devtools) | `mcp__chrome-devtools__` | `fix-loop-agent` (reproduzir bug de UI antes do fix), `worktree-ship` (checagem e2e leve antes do PR) |

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
