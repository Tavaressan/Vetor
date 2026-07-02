# Verificação de Disponibilidade de MCP (Vetor)

Todas as skills que têm um caminho "Com MCP" / "Sem MCP (Fallback)" devem verificar disponibilidade
da mesma forma — esta referência centraliza o mecanismo para evitar que cada skill reinvente (ou
pule) a checagem.

## O mecanismo correto

Ferramentas de servidores MCP aparecem no seu namespace de ferramentas com o prefixo
`mcp__<server>__<tool>` (ex.: `mcp__github__search_issues`, `mcp__sentry__list_issues`) — diretas na
lista de ferramentas disponíveis, ou listadas por nome entre as ferramentas diferidas (que você
carrega via `ToolSearch` antes de chamar).

**Verificar disponibilidade é simplesmente olhar se algum nome com esse prefixo existe** — não é
necessário rodar comando, nem tentar a chamada MCP "para ver se funciona":

1. Procure na sua lista de ferramentas (diretas + diferidas, listadas em `<system-reminder>` no
   início da conversa e sempre que atualizadas) por qualquer nome começando com `mcp__<server>__`,
   onde `<server>` é o servidor relevante para a tarefa (`github`, `sentry`/observabilidade,
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

| Servidor | Prefixo | Usado em |
|---|---|---|
| GitHub | `mcp__github__` | `backlog-ideator`, `issue-coordinator`, `guardian` (issues, PRs) |
| Observabilidade (Sentry/Datadog) | `mcp__sentry__` / `mcp__datadog__` | `backlog-ideator` §2.a (opcional) |
| Banco de dados | `mcp__<db>__` (nome depende do MCP configurado) | `guardian` (auditoria de schema/queries) |

Cada skill que referencia este documento deve nomear o servidor esperado (ex.: "GitHub" na seção
acima) antes de aplicar o mecanismo — este documento define *como* checar, não *quais* servidores
uma skill específica precisa.
