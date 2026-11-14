import { assertEquals } from "@std/assert";
import type { CapabilityRegistry } from "../capabilities/registry.ts";
import { CapabilityRegistry as Registry } from "../capabilities/registry.ts";
import type {
  CapabilityName,
  EvidenceLevel,
  HarnessDescriptor,
  HarnessObservation,
} from "../capabilities/types.ts";
import type { MatchCandidate } from "./matcher.ts";
import { rankExecutors } from "./scorer.ts";
import type { TaskProfile } from "./types.ts";

const CORE: CapabilityName[] = ["terminal", "filesystem", "git"];

function descriptor(
  id: string,
  unsupported: readonly CapabilityName[] = [],
): HarnessDescriptor {
  const unsupportedCapabilities = new Set(unsupported);
  const capabilities: CapabilityName[] = [...CORE, "browser", "mcp"];
  return {
    descriptorVersion: 1,
    id,
    kind: "cli",
    command: id,
    declared: Object.fromEntries(
      capabilities.map((capability) => [
        capability,
        {
          state: unsupportedCapabilities.has(capability) ? "unsupported" : "supported",
          source: `perfil:${id}`,
        },
      ]),
    ) as HarnessDescriptor["declared"],
  };
}

function registry(ids: string[]): CapabilityRegistry {
  const value = new Registry();
  for (const id of ids) value.register(descriptor(id));
  return value;
}

function profile(): TaskProfile {
  return {
    profileVersion: 1,
    taskId: "653",
    operations: [],
    domains: [],
    complexity: "unknown",
    risk: "unknown",
    requirements: { browser: false, mcp: false },
    dataSensitivity: "unknown",
    provenance: {
      operations: "derived",
      domains: "derived",
      complexity: "derived",
      risk: "derived",
      requirements: "default",
      dataSensitivity: "default",
    },
    evidence: {
      labels: [],
      acceptanceCriteriaCount: 0,
      resolvedModules: [],
      specProvided: false,
      microSpecProvided: false,
    },
  };
}

function candidate(
  executorId: string,
  level: EvidenceLevel = "declared",
): MatchCandidate {
  return {
    executorId,
    verdict: "eligible",
    detail: "eligible",
    evidence: Object.fromEntries(CORE.map((name) => [name, level])) as Partial<
      Record<CapabilityName, EvidenceLevel>
    >,
  };
}

function input(
  ids: string[],
  candidates: MatchCandidate[],
  options: {
    authorizedExecutors?: string[];
    preferredRuntime?: string;
    desirableCapabilities?: CapabilityName[];
    observations?: HarnessObservation[];
  } = {},
) {
  return {
    registry: registry(ids),
    profile: profile(),
    policy: { authorizedExecutors: options.authorizedExecutors ?? ids },
    candidates,
    ...(options.preferredRuntime !== undefined
      ? { preferredRuntime: options.preferredRuntime }
      : {}),
    ...(options.desirableCapabilities !== undefined
      ? { desirableCapabilities: options.desirableCapabilities }
      : {}),
    ...(options.observations !== undefined ? { observations: options.observations } : {}),
  };
}

Deno.test("preference autorizada precede evidência e registra o critério", () => {
  const ranked = rankExecutors(input(
    ["alpha", "preferred"],
    [candidate("alpha", "operational"), candidate("preferred")],
    { preferredRuntime: "preferred" },
  ));
  assertEquals(ranked.map(({ executorId }) => executorId), ["preferred", "alpha"]);
  assertEquals(ranked.map(({ rankedBy }) => rankedBy), ["first", "preferredRuntime"]);
});

Deno.test("preferência fora de authorizedExecutors não promove o executor", () => {
  const ranked = rankExecutors(input(
    ["alpha", "preferred"],
    [candidate("preferred"), candidate("alpha", "verified")],
    { preferredRuntime: "preferred", authorizedExecutors: ["alpha"] },
  ));
  assertEquals(ranked.map(({ executorId }) => executorId), ["alpha", "preferred"]);
  assertEquals(ranked[1].rankedBy, "minimumEvidence");
});

Deno.test("maior nível mínimo de evidência entre requisitos obrigatórios vence", () => {
  const ranked = rankExecutors(input(
    ["declared", "verified", "operational"],
    [
      candidate("declared"),
      candidate("verified", "verified"),
      candidate("operational", "operational"),
    ],
  ));
  assertEquals(ranked.map(({ executorId }) => executorId), [
    "operational",
    "verified",
    "declared",
  ]);
  assertEquals(ranked[1].rankedBy, "minimumEvidence");
  assertEquals(ranked[0].minimumEvidence, "operational");
});

Deno.test("mais capacidades desejáveis suportadas vencem sem duplicar requisitos", () => {
  const ranked = rankExecutors({
    ...input(
      ["browser", "mcp"],
      [candidate("mcp"), candidate("browser")],
      { desirableCapabilities: ["browser", "mcp", "browser"] },
    ),
    registry: new Registry()
      .register(descriptor("browser"))
      .register(descriptor("mcp", ["browser"])),
  });
  assertEquals(ranked.map(({ executorId }) => executorId), ["browser", "mcp"]);
  assertEquals(ranked.map(({ desirableCapabilitiesMet }) => desirableCapabilitiesMet), [2, 1]);
  assertEquals(ranked[1].rankedBy, "desirableCapabilities");
});

Deno.test("available precede degraded e o critério fica registrado", () => {
  const observations: HarnessObservation[] = [{
    executorId: "degraded",
    observedAt: "2026-11-13T00:00:00Z",
    capabilities: {},
    availability: { state: "degraded" },
    sideEffects: "none",
  }];
  const ranked = rankExecutors(input(
    ["available", "degraded"],
    [candidate("degraded"), candidate("available")],
    { observations },
  ));
  assertEquals(ranked.map(({ executorId }) => executorId), ["available", "degraded"]);
  assertEquals(ranked[1].rankedBy, "availability");
});

Deno.test("id alfabético resolve empates de forma reproduzível", () => {
  const candidates = [candidate("zeta"), candidate("alpha"), candidate("mu")];
  const rankInput = input(["alpha", "mu", "zeta"], candidates);
  const first = rankExecutors(rankInput);
  const second = rankExecutors(rankInput);
  assertEquals(first.map(({ executorId }) => executorId), ["alpha", "mu", "zeta"]);
  assertEquals(first, second);
  assertEquals(first.map(({ rankedBy }) => rankedBy), ["first", "id", "id"]);
});
