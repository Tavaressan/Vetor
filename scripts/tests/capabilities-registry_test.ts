import { assertEquals, assertThrows } from "@std/assert";
import { CapabilityRegistry } from "../lib/capabilities/registry.ts";
import type { HarnessDescriptor, HarnessObservation } from "../lib/capabilities/types.ts";

function descriptor(
  id: string,
  declared: HarnessDescriptor["declared"] = {
    terminal: { state: "supported", source: "test:terminal" },
    filesystem: { state: "supported", source: "test:filesystem" },
    git: { state: "supported", source: "test:git" },
  },
): HarnessDescriptor {
  return {
    descriptorVersion: 1,
    id,
    kind: "cli",
    command: id,
    declared,
  };
}

function observation(
  executorId: string,
  capabilities: HarnessObservation["capabilities"],
): HarnessObservation {
  return {
    executorId,
    observedAt: "2026-11-12T10:00:00.000Z",
    capabilities,
    sideEffects: "none",
  };
}

Deno.test("register rejeita descritor inválido via validateDescriptor", () => {
  const registry = new CapabilityRegistry();
  const invalid = {
    descriptorVersion: 1,
    id: "Bad Id",
    kind: "cli",
    declared: {},
  } as unknown as HarnessDescriptor;

  const err = assertThrows(() => registry.register(invalid), Error);
  assertEquals(err.message.includes("Descritor inválido"), true);
  assertEquals(err.message.includes("id"), true);
  assertEquals(registry.list(), []);
});

Deno.test("register rejeita duplicata", () => {
  const registry = new CapabilityRegistry();
  registry.register(descriptor("alpha"));

  const err = assertThrows(() => registry.register(descriptor("alpha")), Error);
  assertEquals(err.message.includes("já está registrado"), true);
  assertEquals(registry.list().map((d) => d.id), ["alpha"]);
});

Deno.test("get retorna descritor registrado e undefined para desconhecido", () => {
  const registry = new CapabilityRegistry();
  const alpha = descriptor("alpha");
  registry.register(alpha);

  assertEquals(registry.get("alpha"), alpha);
  assertEquals(registry.get("desconhecido"), undefined);
});

Deno.test("list retorna em ordem alfabética de id (determinismo)", () => {
  const registry = new CapabilityRegistry();
  registry.register(descriptor("zulu"));
  registry.register(descriptor("alpha"));
  registry.register(descriptor("mike"));

  assertEquals(registry.list().map((d) => d.id), ["alpha", "mike", "zulu"]);
});

Deno.test("list é determinística independentemente da ordem de registro", () => {
  const a = new CapabilityRegistry();
  a.register(descriptor("charlie"));
  a.register(descriptor("alpha"));
  a.register(descriptor("bravo"));

  const b = new CapabilityRegistry();
  b.register(descriptor("bravo"));
  b.register(descriptor("charlie"));
  b.register(descriptor("alpha"));

  assertEquals(
    a.list().map((d) => d.id),
    b.list().map((d) => d.id),
  );
  assertEquals(a.list().map((d) => d.id), ["alpha", "bravo", "charlie"]);
});

Deno.test("query retorna em ordem alfabética de id (determinismo)", () => {
  const registry = new CapabilityRegistry();
  registry.register(descriptor("zulu"));
  registry.register(descriptor("alpha"));
  registry.register(descriptor("mike"));

  const result = registry.query({ capability: "terminal", minLevel: "declared" });
  assertEquals(result.map((d) => d.id), ["alpha", "mike", "zulu"]);
});

Deno.test("descritor desconhecido não é selecionável por query", () => {
  const registry = new CapabilityRegistry();
  registry.register(descriptor("alpha"));

  // "desconhecido" nunca foi registrado: não aparece, independente de observações.
  const result = registry.query(
    { capability: "terminal", minLevel: "declared" },
    [
      observation("desconhecido", {
        terminal: { state: "supported", level: "verified", source: "probe:x" },
      }),
    ],
  );
  assertEquals(result.map((d) => d.id), ["alpha"]);
  assertEquals(registry.get("desconhecido"), undefined);
});

Deno.test("query filtra por capacidade e nível mínimo de evidência com observações", () => {
  const registry = new CapabilityRegistry();
  registry.register(
    descriptor("alpha", {
      terminal: { state: "supported", source: "decl:alpha" },
    }),
  );
  registry.register(
    descriptor("bravo", {
      terminal: { state: "supported", source: "decl:bravo" },
    }),
  );
  registry.register(
    descriptor("charlie", {
      terminal: { state: "unsupported", source: "decl:charlie" },
    }),
  );

  const observations: HarnessObservation[] = [
    observation("bravo", {
      terminal: { state: "supported", level: "verified", source: "probe:bravo" },
    }),
  ];

  assertEquals(
    registry.query({ capability: "terminal", minLevel: "declared" }, observations).map((d) => d.id),
    ["alpha", "bravo"],
  );
  assertEquals(
    registry.query({ capability: "terminal", minLevel: "verified" }, observations).map((d) => d.id),
    ["bravo"],
  );
  assertEquals(
    registry
      .query({ capability: "terminal", minLevel: "operational" }, observations)
      .map((d) => d.id),
    [],
  );
});

Deno.test("query não seleciona capacidade ausente ou unknown", () => {
  const registry = new CapabilityRegistry();
  registry.register(
    descriptor("alpha", {
      terminal: { state: "supported", source: "decl:alpha" },
    }),
  );
  registry.register(
    descriptor("bravo", {
      terminal: { state: "unknown", source: "decl:bravo" },
      browser: { state: "supported", source: "decl:bravo" },
    }),
  );

  assertEquals(
    registry.query({ capability: "browser", minLevel: "declared" }).map((d) => d.id),
    ["bravo"],
  );
  // alpha não declara browser -> unknown, não selecionável
  assertEquals(
    registry.query({ capability: "mcp", minLevel: "declared" }).map((d) => d.id),
    [],
  );
});
