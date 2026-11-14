import { assertEquals } from "@std/assert";
import { CapabilityRegistry } from "../lib/capabilities/registry.ts";
import type { HarnessDescriptor, HarnessObservation } from "../lib/capabilities/types.ts";
import { matchExecutors } from "../lib/execution/matcher.ts";
import type { TaskProfile } from "../lib/execution/types.ts";

function coreSupported(): HarnessDescriptor["declared"] {
  return {
    terminal: { state: "supported", source: "test" },
    filesystem: { state: "supported", source: "test" },
    git: { state: "supported", source: "test" },
  };
}

function descriptor(
  id: string,
  declared: HarnessDescriptor["declared"] = coreSupported(),
): HarnessDescriptor {
  return { descriptorVersion: 1, id, kind: "cli", command: id, declared };
}

function profile(opts?: {
  browser?: boolean;
  mcp?: boolean;
  dataSensitivity?: TaskProfile["dataSensitivity"];
}): TaskProfile {
  return {
    profileVersion: 1,
    taskId: "652",
    operations: ["feat"],
    domains: ["scripts"],
    complexity: "unknown",
    risk: "unknown",
    requirements: { browser: opts?.browser ?? false, mcp: opts?.mcp ?? false },
    dataSensitivity: opts?.dataSensitivity ?? "public",
    provenance: {
      operations: "derived",
      domains: "derived",
      complexity: "derived",
      risk: "derived",
      requirements: opts?.browser || opts?.mcp ? "explicit" : "default",
      dataSensitivity: "config",
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

function policy(
  overrides: Partial<{
    mode: "manual" | "assisted" | "autonomous";
    authorizedExecutors: string[];
    dataSensitivityPolicy: Record<TaskProfile["dataSensitivity"], string[]>;
  }> = {},
) {
  return {
    mode: overrides.mode ?? "autonomous",
    authorizedExecutors: overrides.authorizedExecutors ?? [],
    dataSensitivityPolicy: overrides.dataSensitivityPolicy ?? {
      public: [],
      private: [],
      sensitive: [],
      unknown: [],
    },
  };
}

Deno.test("RejectedBy authorization: fora de authorizedExecutors", () => {
  const registry = new CapabilityRegistry().register(descriptor("alpha"));
  const result = matchExecutors({
    registry,
    observations: [{
      executorId: "alpha",
      observedAt: "2026-01-01T00:00:00Z",
      capabilities: {
        terminal: { state: "supported", level: "verified", source: "p" },
        filesystem: { state: "supported", level: "verified", source: "p" },
        git: { state: "supported", level: "verified", source: "p" },
      },
      sideEffects: "none",
    }],
    profile: profile(),
    policy: policy({
      authorizedExecutors: ["other"],
      dataSensitivityPolicy: { public: ["alpha"], private: [], sensitive: [], unknown: [] },
    }),
  });
  assertEquals(result.map((c) => [c.executorId, c.verdict, c.rejectedBy]), [[
    "alpha",
    "rejected",
    "authorization",
  ]]);
});

Deno.test("RejectedBy dataSensitivity: fora da política do nível", () => {
  const registry = new CapabilityRegistry().register(descriptor("alpha"));
  const result = matchExecutors({
    registry,
    observations: [{
      executorId: "alpha",
      observedAt: "2026-01-01T00:00:00Z",
      capabilities: {
        terminal: { state: "supported", level: "verified", source: "p" },
        filesystem: { state: "supported", level: "verified", source: "p" },
        git: { state: "supported", level: "verified", source: "p" },
      },
      sideEffects: "none",
    }],
    profile: profile({ dataSensitivity: "private" }),
    policy: policy({
      authorizedExecutors: ["alpha"],
      dataSensitivityPolicy: { public: ["alpha"], private: [], sensitive: [], unknown: [] },
    }),
  });
  assertEquals(result[0].rejectedBy, "dataSensitivity");
  assertEquals(result[0].verdict, "rejected");
});

Deno.test("RejectedBy capability: requisito obrigatório não atendido", () => {
  const registry = new CapabilityRegistry().register(
    descriptor("alpha", {
      terminal: { state: "supported", source: "t" },
      filesystem: { state: "supported", source: "t" },
      git: { state: "unsupported", source: "t" },
    }),
  );
  const result = matchExecutors({
    registry,
    profile: profile(),
    policy: policy({
      mode: "assisted",
      authorizedExecutors: ["alpha"],
      dataSensitivityPolicy: { public: ["alpha"], private: [], sensitive: [], unknown: [] },
    }),
  });
  assertEquals(result[0].rejectedBy, "capability");
  assertEquals(result[0].verdict, "rejected");
});

Deno.test("RejectedBy evidence: atendido mas abaixo da evidência exigida pelo modo", () => {
  const registry = new CapabilityRegistry().register(descriptor("alpha"));
  // só declarado, modo autonomous exige verified
  const result = matchExecutors({
    registry,
    profile: profile(),
    policy: policy({
      mode: "autonomous",
      authorizedExecutors: ["alpha"],
      dataSensitivityPolicy: { public: ["alpha"], private: [], sensitive: [], unknown: [] },
    }),
  });
  assertEquals(result[0].rejectedBy, "evidence");
  assertEquals(result[0].verdict, "rejected");
});

Deno.test("RejectedBy availability: executor indisponível", () => {
  const registry = new CapabilityRegistry().register(descriptor("alpha"));
  const obs: HarnessObservation = {
    executorId: "alpha",
    observedAt: "2026-01-02T00:00:00Z",
    capabilities: {
      terminal: { state: "supported", level: "verified", source: "p" },
      filesystem: { state: "supported", level: "verified", source: "p" },
      git: { state: "supported", level: "verified", source: "p" },
    },
    availability: { state: "unavailable", reason: "quota" },
    sideEffects: "none",
  };
  const result = matchExecutors({
    registry,
    observations: [obs],
    profile: profile(),
    policy: policy({
      mode: "autonomous",
      authorizedExecutors: ["alpha"],
      dataSensitivityPolicy: { public: ["alpha"], private: [], sensitive: [], unknown: [] },
    }),
  });
  assertEquals(result[0].rejectedBy, "availability");
  assertEquals(result[0].verdict, "rejected");
});

Deno.test("determinismo: ordem segue registry.list() e resultado estável", () => {
  const registry = new CapabilityRegistry()
    .register(descriptor("zeta"))
    .register(descriptor("alpha"))
    .register(descriptor("mid"));
  const observations: HarnessObservation[] = ["alpha", "mid", "zeta"].map((id) => ({
    executorId: id,
    observedAt: "2026-01-01T00:00:00Z",
    capabilities: {
      terminal: { state: "supported", level: "verified", source: "p" },
      filesystem: { state: "supported", level: "verified", source: "p" },
      git: { state: "supported", level: "verified", source: "p" },
    },
    sideEffects: "none" as const,
  }));
  const input = {
    registry,
    observations,
    profile: profile(),
    policy: policy({
      mode: "autonomous",
      authorizedExecutors: ["alpha", "mid", "zeta"],
      dataSensitivityPolicy: {
        public: ["alpha", "mid", "zeta"],
        private: [],
        sensitive: [],
        unknown: [],
      },
    }),
  };
  const a = matchExecutors(input);
  const b = matchExecutors(input);
  assertEquals(a.map((c) => c.executorId), ["alpha", "mid", "zeta"]);
  assertEquals(a, b);
  assertEquals(a.every((c) => c.verdict === "eligible"), true);
});

Deno.test("falha fechada de operational sem sonda", async () => {
  const registry = new CapabilityRegistry().register(
    descriptor("alpha", {
      ...coreSupported(),
      isolatedWorktree: { state: "supported", source: "decl" },
    }),
  );
  // requisito pede operacional explicitamente; sem observação operacional => rejeita por evidência
  const observations: HarnessObservation[] = [{
    executorId: "alpha",
    observedAt: "2026-01-01T00:00:00Z",
    capabilities: {
      terminal: { state: "supported", level: "verified", source: "p" },
      filesystem: { state: "supported", level: "verified", source: "p" },
      git: { state: "supported", level: "verified", source: "p" },
      isolatedWorktree: { state: "supported", level: "verified", source: "p" },
    },
    sideEffects: "none",
  }];
  // matchExecutors usa deriveRequirements(profile) que não inclui isolatedWorktree por padrão.
  // Testa falha fechada via requisito com minLevel operacional: simulamos chamando meetsEvidence
  // indiretamente não é direto aqui, mas podemos construir um perfil que force? não.
  // Em vez disso, validamos comportamento via API interna: deriveRequirements + meetsEvidence contract.
  // Porém o critério diz "falha fechada de `operational` sem sonda" nos testes do matcher/requisitos.
  // Garantimos que, se um requisito exigir operacional, sem evidência operacional falha.
  const req = { name: "isolatedWorktree" as const, minLevel: "operational" as const };
  const effective = (await import("../lib/capabilities/evidence.ts")).resolveEffective(
    registry.get("alpha")!,
    observations,
  );
  assertEquals(effective.isolatedWorktree.level, "verified");
  assertEquals(
    (await import("../lib/capabilities/evidence.ts")).meetsEvidence(
      effective.isolatedWorktree,
      "autonomous",
      req.minLevel,
    ),
    false,
  );
});

Deno.test("browser/mcp só entram como requisito quando explicitamente requeridos", () => {
  const registry = new CapabilityRegistry().register(descriptor("alpha")); // sem browser/mcp declarados
  const observations: HarnessObservation[] = [{
    executorId: "alpha",
    observedAt: "2026-01-01T00:00:00Z",
    capabilities: {
      terminal: { state: "supported", level: "verified", source: "p" },
      filesystem: { state: "supported", level: "verified", source: "p" },
      git: { state: "supported", level: "verified", source: "p" },
    },
    sideEffects: "none",
  }];
  const base = {
    registry,
    observations,
    policy: policy({
      mode: "autonomous",
      authorizedExecutors: ["alpha"],
      dataSensitivityPolicy: { public: ["alpha"], private: [], sensitive: [], unknown: [] },
    }),
  };
  // sem requisito explícito: elegível mesmo sem browser/mcp
  assertEquals(matchExecutors({ ...base, profile: profile() })[0].verdict, "eligible");
  // com requisito explícito mcp: rejeitado por capability (ausente/unknown)
  const mcp = matchExecutors({ ...base, profile: profile({ mcp: true }) })[0];
  assertEquals(mcp.verdict, "rejected");
  assertEquals(mcp.rejectedBy, "capability");
});
