import { assertEquals, assertThrows } from "@std/assert";
import { CapabilityRegistry } from "../capabilities/registry.ts";
import type { HarnessDescriptor } from "../capabilities/types.ts";
import { buildFallbacks } from "./fallback.ts";
import { matchExecutors } from "./matcher.ts";
import { type RankedCandidate, rankExecutors } from "./scorer.ts";
import type { TaskProfile } from "./types.ts";

function descriptor(id: string, kind: "cli" | "orchestrator" = "cli"): HarnessDescriptor {
  return {
    descriptorVersion: 1,
    id,
    kind,
    command: kind === "cli" ? id : undefined,
    declared: Object.fromEntries(
      ["terminal", "filesystem", "git"].map((c) => [c, { state: "supported", source: `p:${id}` }]),
    ) as HarnessDescriptor["declared"],
  };
}

function registry(ids: string[]): CapabilityRegistry {
  const r = new CapabilityRegistry();
  for (const id of ids) r.register(descriptor(id, id === "orq" ? "orchestrator" : "cli"));
  return r;
}

function ranked(ids: string[]): RankedCandidate[] {
  return ids.map((executorId, i) => ({
    executorId,
    verdict: "eligible",
    detail: "",
    evidence: {},
    rank: i + 1,
    rankedBy: i === 0 ? "first" : "id",
    minimumEvidence: "declared",
    desirableCapabilitiesMet: 0,
    availability: "available",
  } as RankedCandidate));
}

const reg = registry(["a", "b", "c", "d", "orq"]);

Deno.test("fallbacks seguem a ordem do ranking, sem o primário, com rank a partir de 2", () => {
  const r = buildFallbacks({
    registry: reg,
    ranking: ranked(["a", "b", "c"]),
    maxRetryAttempts: 2,
  });
  assertEquals(r.fallbacks, [
    { executorId: "b", mode: "cli", rank: 2 },
    { executorId: "c", mode: "cli", rank: 3 },
  ]);
});

Deno.test("modo do fallback vem do tipo do executor", () => {
  const r = buildFallbacks({ registry: reg, ranking: ranked(["a", "orq"]), maxRetryAttempts: 1 });
  assertEquals(r.fallbacks[0].mode, "orchestrator");
});

Deno.test("executores já tentados saem", () => {
  const r = buildFallbacks({
    registry: reg,
    ranking: ranked(["a", "b", "c"]),
    attempted: ["b"],
    maxRetryAttempts: 2,
  });
  assertEquals(r.fallbacks.map((f) => [f.executorId, f.rank]), [["c", 2]]);
  assertEquals(r.excluded.map((e) => [e.executorId, e.rejectedBy]), [["b", "attempted"]]);
});

Deno.test("respeita maxRetryAttempts", () => {
  const ranking = ranked(["a", "b", "c", "d"]);
  assertEquals(
    buildFallbacks({ registry: reg, ranking, maxRetryAttempts: 1 }).fallbacks.map((f) =>
      f.executorId
    ),
    ["b"],
  );
  assertEquals(buildFallbacks({ registry: reg, ranking, maxRetryAttempts: 0 }).fallbacks, []);
});

Deno.test("maxRetryAttempts inválido é rejeitado", () => {
  assertThrows(
    () => buildFallbacks({ registry: reg, ranking: ranked(["a"]), maxRetryAttempts: -1 }),
    RangeError,
  );
  assertThrows(
    () => buildFallbacks({ registry: reg, ranking: ranked(["a"]), maxRetryAttempts: 1.5 }),
    RangeError,
  );
});

Deno.test("preferência fora do ranking não é substituída", () => {
  const r = buildFallbacks({
    registry: reg,
    ranking: ranked(["a", "b", "c"]),
    preferredRuntime: "d",
    maxRetryAttempts: 2,
  });
  assertEquals(r.fallbacks, []);
  assertEquals(r.excluded.map((e) => e.rejectedBy), ["preference", "preference"]);
});

Deno.test("preferência elegível não bloqueia fallbacks", () => {
  const r = buildFallbacks({
    registry: reg,
    ranking: ranked(["b", "a", "c"]),
    preferredRuntime: "b",
    maxRetryAttempts: 2,
  });
  assertEquals(r.fallbacks.map((f) => f.executorId), ["a", "c"]);
});

Deno.test("sem fallback restante: lista vazia com motivo", () => {
  const solo = buildFallbacks({ registry: reg, ranking: ranked(["a"]), maxRetryAttempts: 2 });
  assertEquals(solo.fallbacks, []);
  assertEquals(solo.reasons.length, 1);
  const allTried = buildFallbacks({
    registry: reg,
    ranking: ranked(["a", "b"]),
    attempted: ["a", "b"],
    maxRetryAttempts: 2,
  });
  assertEquals(allTried.fallbacks, []);
  assertEquals(buildFallbacks({ registry: reg, ranking: [], maxRetryAttempts: 2 }).fallbacks, []);
});

Deno.test("integração: rejeitados pelo matcher nunca viram fallback", () => {
  const r = registry(["a", "b", "c"]);
  const profile: TaskProfile = {
    profileVersion: 1,
    taskId: "654",
    operations: [],
    domains: [],
    complexity: "unknown",
    risk: "unknown",
    requirements: { browser: false, mcp: true },
    dataSensitivity: "private",
    provenance: {
      operations: "derived",
      domains: "derived",
      complexity: "derived",
      risk: "derived",
      requirements: "explicit",
      dataSensitivity: "explicit",
    },
    evidence: {
      labels: [],
      acceptanceCriteriaCount: 0,
      resolvedModules: [],
      specProvided: false,
      microSpecProvided: false,
    },
  };
  const policy = {
    mode: "assisted" as const,
    authorizedExecutors: ["a", "b"],
    dataSensitivityPolicy: {
      public: ["a", "b", "c"],
      private: ["a", "b", "c"],
      sensitive: [],
      unknown: [],
    },
  };
  // Nenhum descritor declara mcp: todos reprovam em "capability".
  const candidates = matchExecutors({ registry: r, profile, policy });
  const ranking = rankExecutors({ registry: r, profile, policy, candidates });
  assertEquals(ranking, []);
  assertEquals(buildFallbacks({ registry: r, ranking, maxRetryAttempts: 2 }).fallbacks, []);
});
