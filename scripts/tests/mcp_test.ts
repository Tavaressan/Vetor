import { assertEquals } from "@std/assert";
import { hasMcpServer, matchesMcpServer } from "../lib/mcp.ts";
import { detectBrowserMcpServer } from "../lib/design-loop-mcp.ts";

Deno.test("matchesMcpServer: detecta MCP standalone (mcp__<server>__<tool>)", () => {
  assertEquals(
    matchesMcpServer("mcp__chrome-devtools__take_screenshot", "chrome-devtools"),
    true,
  );
  assertEquals(
    matchesMcpServer("mcp__docker__list_containers", "docker"),
    true,
  );
  assertEquals(
    matchesMcpServer("mcp__sentry__list_issues", "sentry"),
    true,
  );
});

Deno.test("matchesMcpServer: detecta MCP empacotado em plugin (mcp__plugin_<plugin>_<server>__<tool>) — issue #336", () => {
  assertEquals(
    matchesMcpServer("mcp__plugin_vetor_chrome-devtools__take_screenshot", "chrome-devtools"),
    true,
  );
  assertEquals(
    matchesMcpServer("mcp__plugin_vetor_context7__query-docs", "context7"),
    true,
  );
  assertEquals(
    matchesMcpServer("mcp__plugin_custom_docker__ps", "docker"),
    true,
  );
  assertEquals(
    matchesMcpServer("mcp__plugin_vetor_cli_chrome-devtools__take_screenshot", "chrome-devtools"),
    true,
  );
});

Deno.test("matchesMcpServer: não produz falso positivo por substring solta — issue #336", () => {
  // mcp__MCP_DOCKER__browser_click não deve ser detectado como docker
  assertEquals(
    matchesMcpServer("mcp__MCP_DOCKER__browser_click", "docker"),
    false,
  );
  // Servidores com nomes compostos não devem casar com prefixos parciais
  assertEquals(
    matchesMcpServer("mcp__docker_gateway__run", "docker"),
    false,
  );
  assertEquals(
    matchesMcpServer("mcp__plugin_vetor_docker_gateway__run", "docker"),
    false,
  );
});

Deno.test("hasMcpServer e detectBrowserMcpServer: reconhece MCP empacotado em plugin na lista de ferramentas", () => {
  const tools = [
    "Read",
    "Bash",
    "mcp__plugin_vetor_chrome-devtools__take_screenshot",
  ];
  assertEquals(hasMcpServer(tools, "chrome-devtools"), true);
  assertEquals(detectBrowserMcpServer(tools), "chrome-devtools");
});
