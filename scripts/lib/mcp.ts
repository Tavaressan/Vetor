/**
 * Utilitários de detecção e verificação de disponibilidade de servidores MCP.
 *
 * Ferramentas de servidores MCP aparecem no namespace com dois formatos possíveis:
 * 1. Standalone: `mcp__<server>__<tool>`
 * 2. Empacotado em plugin: `mcp__plugin_<plugin>_<server>__<tool>`
 *
 * A detecção casa estritamente por segmento delimitado, sem substring solta, prevenindo
 * falsos positivos como `mcp__MCP_DOCKER__*` casar indevidamente com `docker` (issue #336).
 */

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Verifica se o nome de uma ferramenta pertence ao servidor MCP especificado.
 */
export function matchesMcpServer(toolName: string, serverName: string): boolean {
  // 1. Formato standalone: mcp__<server>__<tool>
  if (toolName.startsWith(`mcp__${serverName}__`)) {
    return true;
  }

  // 2. Formato empacotado em plugin: mcp__plugin_<plugin>_<server>__<tool>
  // O prefixo mcp__plugin_ é seguido pelo identificador do plugin, depois "_" e o nome do servidor,
  // finalizando com "__" antes da ferramenta.
  const pluginPattern = new RegExp(`^mcp__plugin_.+?_${escapeRegex(serverName)}__`);
  if (pluginPattern.test(toolName)) {
    return true;
  }

  return false;
}

/**
 * Retorna se alguma das ferramentas fornecidas pertence ao servidor MCP especificado.
 */
export function hasMcpServer(toolNames: string[], serverName: string): boolean {
  return toolNames.some((tool) => matchesMcpServer(tool, serverName));
}
