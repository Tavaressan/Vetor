import { assertEquals } from "@std/assert";
import type { HarnessDescriptor } from "../lib/capabilities/types.ts";
import { validateDescriptor } from "../lib/capabilities/validate.ts";

function validCliDescriptor(): HarnessDescriptor {
  return {
    descriptorVersion: 1,
    id: "claude-code",
    kind: "cli",
    command: "claude",
    versionRange: ">=1.0.0 <2.0.0",
    declared: {
      terminal: { state: "supported", source: "wiki/Contrato-de-Capacidades.md:24" },
      filesystem: { state: "supported", source: "wiki/Contrato-de-Capacidades.md:24" },
      git: { state: "supported", source: "harness-capabilities.md:10" },
      mcp: { state: "supported", source: "wiki/Contrato-de-Capacidades.md:24" },
      subagents: { state: "unknown", source: "descoberta-de-capacidades.md:4" },
    },
  };
}

function validOrchestratorDescriptor(): HarnessDescriptor {
  return {
    descriptorVersion: 1,
    id: "alethe",
    kind: "orchestrator",
    declared: {
      terminal: { state: "supported", source: "modos-de-execucao.md:101" },
      filesystem: { state: "supported", source: "modos-de-execucao.md:101" },
      git: { state: "supported", source: "modos-de-execucao.md:101" },
    },
  };
}

Deno.test("validateDescriptor - descritor CLI válido", () => {
  const errors = validateDescriptor(validCliDescriptor());
  assertEquals(errors, []);
});

Deno.test("validateDescriptor - descritor orquestrador válido (sem command)", () => {
  const errors = validateDescriptor(validOrchestratorDescriptor());
  assertEquals(errors, []);
});

Deno.test("validateDescriptor - id deve ser kebab-case", () => {
  const desc = { ...validCliDescriptor(), id: "ClaudeCode" };
  const errors = validateDescriptor(desc);
  assertEquals(errors.some((e) => e.path === "id"), true);
});

Deno.test("validateDescriptor - id vazio é inválido", () => {
  const desc = { ...validCliDescriptor(), id: "" };
  const errors = validateDescriptor(desc);
  assertEquals(errors.some((e) => e.path === "id"), true);
});

Deno.test("validateDescriptor - id único rejeita duplicata", () => {
  const desc = validCliDescriptor();
  const errors = validateDescriptor(desc, { existingIds: ["claude-code", "opencode"] });
  assertEquals(
    errors.some((e) => e.path === "id" && e.message.includes("já está registrado")),
    true,
  );
});

Deno.test("validateDescriptor - id único aceita quando não duplicado", () => {
  const desc = validCliDescriptor();
  const errors = validateDescriptor(desc, { existingIds: ["opencode", "codex"] });
  assertEquals(errors, []);
});

Deno.test("validateDescriptor - kind inválido", () => {
  const desc = { ...validCliDescriptor(), kind: "agent" } as unknown as HarnessDescriptor;
  const errors = validateDescriptor(desc);
  assertEquals(errors.some((e) => e.path === "kind"), true);
});

Deno.test("validateDescriptor - command obrigatório quando kind é cli", () => {
  const desc = { ...validCliDescriptor() } as HarnessDescriptor & { command?: string };
  delete desc.command;
  const errors = validateDescriptor(desc);
  assertEquals(errors.some((e) => e.path === "command"), true);
});

Deno.test("validateDescriptor - command vazio quando kind é cli é inválido", () => {
  const desc = { ...validCliDescriptor(), command: "   " };
  const errors = validateDescriptor(desc);
  assertEquals(errors.some((e) => e.path === "command"), true);
});

Deno.test("validateDescriptor - descriptorVersion diferente de 1", () => {
  const desc = { ...validCliDescriptor(), descriptorVersion: 2 } as unknown as HarnessDescriptor;
  const errors = validateDescriptor(desc);
  assertEquals(errors.some((e) => e.path === "descriptorVersion"), true);
});

Deno.test("validateDescriptor - versionRange parseável aceita faixas comuns", () => {
  for (const range of [">=1.0.0", "^2.3.4", "~1.2", "1.x", ">=1 <3", "1.0.0 || 2.0.0", "*"]) {
    const errors = validateDescriptor({ ...validCliDescriptor(), versionRange: range });
    assertEquals(errors.some((e) => e.path === "versionRange"), false, `range: ${range}`);
  }
});

Deno.test("validateDescriptor - versionRange inválido ou vazio", () => {
  for (const range of ["", "   ", "abc", "!!!"]) {
    const errors = validateDescriptor({ ...validCliDescriptor(), versionRange: range });
    assertEquals(errors.some((e) => e.path === "versionRange"), true, `range: ${range}`);
  }
});

Deno.test("validateDescriptor - versionRange ausente é permitido", () => {
  const desc = { ...validCliDescriptor() } as HarnessDescriptor & { versionRange?: string };
  delete desc.versionRange;
  const errors = validateDescriptor(desc);
  assertEquals(errors, []);
});

Deno.test("validateDescriptor - nome de capacidade desconhecido", () => {
  const desc = validCliDescriptor();
  (desc.declared as Record<string, { state: string; source: string }>)["teleport"] = {
    state: "supported",
    source: "inventado.md:1",
  };
  const errors = validateDescriptor(desc);
  assertEquals(errors.some((e) => e.path === "declared.teleport"), true);
});

Deno.test("validateDescriptor - source não vazio em toda afirmação", () => {
  const desc = validCliDescriptor();
  desc.declared.terminal = { state: "supported", source: "" };
  const errors = validateDescriptor(desc);
  assertEquals(errors.some((e) => e.path === "declared.terminal.source"), true);
});

Deno.test("validateDescriptor - source ausente/não-string em afirmação", () => {
  const desc = validCliDescriptor();
  (desc.declared as Record<string, unknown>).git = { state: "supported" };
  const errors = validateDescriptor(desc);
  assertEquals(errors.some((e) => e.path === "declared.git.source"), true);
});

Deno.test("validateDescriptor - state inválido em afirmação", () => {
  const desc = validCliDescriptor();
  (desc.declared as Record<string, unknown>).mcp = { state: "maybe", source: "x:1" };
  const errors = validateDescriptor(desc);
  assertEquals(errors.some((e) => e.path === "declared.mcp.state"), true);
});

Deno.test("validateDescriptor - declared ausente/não-objeto", () => {
  const desc = { ...validCliDescriptor(), declared: null } as unknown as HarnessDescriptor;
  const errors = validateDescriptor(desc);
  assertEquals(errors.some((e) => e.path === "declared"), true);
});

Deno.test("validateDescriptor - múltiplos erros são reportados", () => {
  const desc = {
    descriptorVersion: 2,
    id: "Bad Id",
    kind: "cli",
    declared: {
      terminal: { state: "bogus", source: "" },
    },
  } as unknown as HarnessDescriptor;
  const errors = validateDescriptor(desc);
  // descriptorVersion, id, command, terminal.state, terminal.source
  assertEquals(errors.length >= 4, true);
});
