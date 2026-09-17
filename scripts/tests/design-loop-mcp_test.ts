import { assertEquals, assertNotEquals } from "@std/assert";
import { detectBrowserMcpServer, LOOP_STEP_IDS, reportLoopStep } from "../lib/design-loop-mcp.ts";

Deno.test("detectBrowserMcpServer retorna null sem nenhum MCP de browser", () => {
  assertEquals(detectBrowserMcpServer([]), null);
  assertEquals(detectBrowserMcpServer(["mcp__sentry__list_issues", "Read", "Bash"]), null);
});

Deno.test("detectBrowserMcpServer reconhece chrome-devtools e playwright", () => {
  assertEquals(
    detectBrowserMcpServer(["mcp__chrome-devtools__take_screenshot"]),
    "chrome-devtools",
  );
  assertEquals(detectBrowserMcpServer(["mcp__playwright__navigate"]), "playwright");
});

Deno.test("reportLoopStep sem MCP de browser: nunca lança, nunca finge verificação", () => {
  for (const step of LOOP_STEP_IDS) {
    const report = reportLoopStep(step, []);
    // (a) limitação explícita e legível por humano
    assertNotEquals(report.limitation, null);
    assertEquals(typeof report.limitation === "string" && report.limitation.length > 0, true);
    // (b) veredito não pode ser confundido com inspeção bem-sucedida
    assertEquals(report.verdict, "unverified");
    assertNotEquals(report.verdict as string, "verified");
    assertNotEquals(report.verdict as string, "pass");
  }
});

Deno.test("reportLoopStep sem MCP: a limitação nomeia a etapa pulada, não um texto genérico", () => {
  const report = reportLoopStep("screenshot", []);
  assertEquals(
    report.limitation?.includes("screenshot") || report.limitation?.includes("captura"),
    true,
  );
});

Deno.test("reportLoopStep com MCP de browser disponível: veredito verified e sem limitação", () => {
  const tools = ["mcp__chrome-devtools__take_screenshot", "mcp__chrome-devtools__navigate_page"];
  for (const step of LOOP_STEP_IDS) {
    const report = reportLoopStep(step, tools);
    assertEquals(report.verdict, "verified");
    assertEquals(report.limitation, null);
  }
});

Deno.test("reportLoopStep ignora MCP de servidor não-browser (sem falso positivo)", () => {
  const report = reportLoopStep("accessibility_snapshot", ["mcp__sentry__list_issues"]);
  assertEquals(report.verdict, "unverified");
});
