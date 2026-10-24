import { assertEquals } from "@std/assert";
import { selectDelegationRuntime } from "../lib/delegation-runtime.ts";

// Cobre o critério de aceite da issue #247: seleção de runtime de delegação
// agnóstica de provedor (Gemini/OpenCode/Codex), sem assumir nenhum como
// padrão/preferencial sem configuração ou anuência explícita do usuário.

Deno.test("nenhum runtime disponível -> inline, sem erro", () => {
  const result = selectDelegationRuntime({ available: [], interactive: true });
  assertEquals(result, {
    action: "inline",
    reason: "nenhum runtime de delegação disponível no PATH",
  });
});

Deno.test("um único candidato disponível, sem preferência -> delega direto (sem ambiguidade)", () => {
  const result = selectDelegationRuntime({ available: ["agy"], interactive: false });
  assertEquals(result.action, "delegate");
  assertEquals(result.runtime, "agy");
});

Deno.test("dois ou mais candidatos, sem preferência, sessão interativa -> pergunta ao usuário", () => {
  const result = selectDelegationRuntime({ available: ["agy", "opencode"], interactive: true });
  assertEquals(result.action, "ask");
  assertEquals(result.runtime, undefined);
});

Deno.test("dois ou mais candidatos, sem preferência, sessão headless -> inline (critério de desempate documentado: sem anuência possível, nunca escolhe silenciosamente)", () => {
  const result = selectDelegationRuntime({
    available: ["agy", "opencode", "codex"],
    interactive: false,
  });
  assertEquals(result.action, "inline");
});

Deno.test("preferência configurada e disponível -> delega para a preferência, mesmo com outros candidatos", () => {
  const result = selectDelegationRuntime({
    available: ["agy", "opencode"],
    preferred: "opencode",
    interactive: true,
  });
  assertEquals(result.action, "delegate");
  assertEquals(result.runtime, "opencode");
});

Deno.test("preferência configurada mas indisponível -> inline, nunca substitui silenciosamente por outro runtime", () => {
  const result = selectDelegationRuntime({
    available: ["opencode"],
    preferred: "codex",
    interactive: true,
  });
  assertEquals(result.action, "inline");
});

Deno.test("preferência configurada e único candidato disponível coincide -> delega", () => {
  const result = selectDelegationRuntime({
    available: ["codex"],
    preferred: "codex",
    interactive: false,
  });
  assertEquals(result.action, "delegate");
  assertEquals(result.runtime, "codex");
});

// Issue #481: runtime MCP (Alethe) informado pelo chamador, detectado pelo namespace
// mcp__alethe__* e não por binário no PATH. Só é escolhido quando é a preferência configurada.

Deno.test("alethe MCP disponível e preferido, sem binário no PATH -> delega para alethe", () => {
  const result = selectDelegationRuntime({
    available: [],
    mcpAvailable: ["alethe"],
    preferred: "alethe",
    interactive: false,
  });
  assertEquals(result, {
    action: "delegate",
    runtime: "alethe",
    reason: "preferência configurada e disponível via MCP",
  });
});

Deno.test("alethe MCP preferido com CLIs também disponíveis -> delega para alethe", () => {
  const result = selectDelegationRuntime({
    available: ["agy", "opencode"],
    mcpAvailable: ["alethe"],
    preferred: "alethe",
    interactive: true,
  });
  assertEquals(result.action, "delegate");
  assertEquals(result.runtime, "alethe");
});

Deno.test("alethe MCP disponível sem preferência e sem CLI -> inline, nunca escolhe em silêncio", () => {
  for (const interactive of [true, false]) {
    const result = selectDelegationRuntime({
      available: [],
      mcpAvailable: ["alethe"],
      interactive,
    });
    assertEquals(result.action, "inline");
    assertEquals(result.runtime, undefined);
  }
});

Deno.test("alethe MCP disponível sem preferência não conta como candidato: um CLI único segue direto", () => {
  const result = selectDelegationRuntime({
    available: ["codex"],
    mcpAvailable: ["alethe"],
    interactive: false,
  });
  assertEquals(result.action, "delegate");
  assertEquals(result.runtime, "codex");
});

Deno.test("alethe MCP disponível sem preferência não desfaz a ambiguidade entre dois CLIs", () => {
  const ask = selectDelegationRuntime({
    available: ["agy", "opencode"],
    mcpAvailable: ["alethe"],
    interactive: true,
  });
  assertEquals(ask.action, "ask");

  const headless = selectDelegationRuntime({
    available: ["agy", "opencode"],
    mcpAvailable: ["alethe"],
    interactive: false,
  });
  assertEquals(headless.action, "inline");
});

Deno.test("preferência por CLI vale mesmo com alethe MCP disponível", () => {
  const result = selectDelegationRuntime({
    available: ["agy", "opencode"],
    mcpAvailable: ["alethe"],
    preferred: "opencode",
    interactive: true,
  });
  assertEquals(result.action, "delegate");
  assertEquals(result.runtime, "opencode");
});

Deno.test("preferência alethe sem o namespace MCP detectado -> inline, sem trocar por CLI", () => {
  const withCli = selectDelegationRuntime({
    available: ["opencode"],
    mcpAvailable: [],
    preferred: "alethe",
    interactive: true,
  });
  assertEquals(withCli.action, "inline");
  assertEquals(withCli.runtime, undefined);

  const withoutCli = selectDelegationRuntime({
    available: [],
    preferred: "alethe",
    interactive: false,
  });
  assertEquals(withoutCli.action, "inline");
  assertEquals(withoutCli.runtime, undefined);
});
