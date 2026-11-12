import { assert, assertEquals } from "@std/assert";
import { aletheProfile, embeddedProfiles } from "../lib/capabilities/profiles/mod.ts";
import { validateDescriptor } from "../lib/capabilities/validate.ts";
import { meetsEvidence, resolveEffective } from "../lib/capabilities/evidence.ts";
import { observeFromOrchestratorProbe } from "../lib/capabilities/orchestrator.ts";

Deno.test("perfil embutido do Alethe é válido e registrado", () => {
  assertEquals(validateDescriptor(aletheProfile), []);
  assertEquals(aletheProfile.kind, "orchestrator");
  assertEquals(aletheProfile.command, undefined);
  assert(embeddedProfiles.some((p) => p.id === "alethe"));
});

Deno.test("observeFromOrchestratorProbe mapeia isAvailable=true para HarnessObservation", () => {
  const obs = observeFromOrchestratorProbe({
    executorId: "alethe",
    isAvailable: true,
    observedAt: "2026-11-12T12:00:00.000Z",
  });

  assertEquals(obs.executorId, "alethe");
  assertEquals(obs.observedAt, "2026-11-12T12:00:00.000Z");
  assertEquals(obs.installed, true);
  assertEquals(obs.sideEffects, "none");
  assertEquals(obs.availability, { state: "available", reason: undefined });
  assertEquals(obs.capabilities.mcp, {
    state: "supported",
    level: "verified",
    source: "scripts/lib/orchestrator/types.ts:113",
  });
});

Deno.test("observeFromOrchestratorProbe mapeia mcpAvailable para HarnessObservation", () => {
  const obs = observeFromOrchestratorProbe({
    executorId: "alethe",
    isAvailable: false,
    mcpAvailable: ["alethe", "outro"],
    observedAt: "2026-11-12T12:00:00.000Z",
  });

  assertEquals(obs.installed, true);
  assertEquals(obs.availability?.state, "available");
  assertEquals(obs.capabilities.mcp, {
    state: "supported",
    level: "verified",
    source: "scripts/lib/delegation-runtime.ts:23",
  });
});

Deno.test("observeFromOrchestratorProbe combina isAvailable e mcpAvailable como fontes", () => {
  const obs = observeFromOrchestratorProbe({
    executorId: "alethe",
    isAvailable: true,
    mcpAvailable: ["alethe"],
    observedAt: "2026-11-12T12:00:00.000Z",
  });

  assertEquals(
    obs.capabilities.mcp?.source,
    "scripts/lib/orchestrator/types.ts:113, scripts/lib/delegation-runtime.ts:23",
  );
});

Deno.test("observeFromOrchestratorProbe mapeia indisponível", () => {
  const obs = observeFromOrchestratorProbe({
    executorId: "alethe",
    isAvailable: false,
    mcpAvailable: ["outro"],
    observedAt: "2026-11-12T12:00:00.000Z",
  });

  assertEquals(obs.installed, false);
  assertEquals(obs.capabilities, {});
  assertEquals(obs.availability, {
    state: "unavailable",
    reason: "orquestrador indisponível",
  });
});

Deno.test("observação de orquestrador eleva evidência efetiva do Alethe", () => {
  const obs = observeFromOrchestratorProbe({
    executorId: "alethe",
    isAvailable: true,
    observedAt: "2026-11-12T12:00:00.000Z",
  });
  const effective = resolveEffective(aletheProfile, [obs], {
    now: "2026-11-12T12:00:00.000Z",
  });

  assertEquals(effective.mcp.state, "supported");
  assertEquals(effective.mcp.level, "verified");
  assert(meetsEvidence(effective.mcp, "autonomous"));
  // capacidades sem observação permanecem declaradas
  assertEquals(effective.isolatedWorktree.level, "declared");
});
