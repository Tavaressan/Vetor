import { assert, assertEquals } from "@std/assert";
import { CapabilityRegistry } from "../lib/capabilities/registry.ts";
import { embeddedProfiles } from "../lib/capabilities/profiles/mod.ts";
import type { HarnessObservation } from "../lib/capabilities/types.ts";
import { planExecution } from "../lib/execution/planner.ts";
import type { ExecutionPolicy } from "../lib/execution/policy.ts";
import type { TaskProfile } from "../lib/execution/types.ts";

function fullRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  for (const profile of embeddedProfiles) registry.register(profile);
  return registry;
}

function verifiedCoreObservation(
  executorId: string,
  opts?: { unavailable?: boolean; degraded?: boolean; reason?: string },
): HarnessObservation {
  const availability = opts?.unavailable
    ? { state: "unavailable" as const, reason: opts.reason ?? "indisponível" }
    : opts?.degraded
    ? { state: "degraded" as const, reason: opts.reason ?? "degradado" }
    : { state: "available" as const };
  return {
    executorId,
    observedAt: "2026-11-13T10:00:00Z",
    capabilities: {
      terminal: { state: "supported", level: "verified", source: "probe" },
      filesystem: { state: "supported", level: "verified", source: "probe" },
      git: { state: "supported", level: "verified", source: "probe" },
    },
    availability,
    sideEffects: "none",
  };
}

function allVerifiedObservations(
  ids: readonly string[] = embeddedProfiles.map((p) => p.id),
): HarnessObservation[] {
  return ids.map((id) => verifiedCoreObservation(id));
}

function baseProfile(overrides: Partial<TaskProfile> = {}): TaskProfile {
  return {
    profileVersion: 1,
    taskId: "655",
    operations: ["feat"],
    domains: ["scripts"],
    complexity: "unknown",
    risk: "unknown",
    requirements: { browser: false, mcp: false },
    dataSensitivity: "public",
    provenance: {
      operations: "derived",
      domains: "derived",
      complexity: "derived",
      risk: "derived",
      requirements: "default",
      dataSensitivity: "config",
    },
    evidence: {
      titlePrefix: "feat",
      labels: ["enhancement"],
      acceptanceCriteriaCount: 4,
      resolvedModules: ["scripts"],
      specProvided: false,
      microSpecProvided: false,
    },
    ...overrides,
  };
}

function policy(
  overrides: Partial<ExecutionPolicy> & Pick<ExecutionPolicy, "authorizedExecutors"> & {
    dataSensitivityPolicy: ExecutionPolicy["dataSensitivityPolicy"];
  },
): ExecutionPolicy {
  return {
    mode: "autonomous",
    maxRetryAttempts: 2,
    ...overrides,
  };
}

function allowAll(ids: readonly string[]): ExecutionPolicy["dataSensitivityPolicy"] {
  return {
    public: [...ids],
    private: [...ids],
    sensitive: [...ids],
    unknown: [...ids],
  };
}

Deno.test("planner: modo manual retorna inline sem avaliar candidatos", () => {
  const registry = fullRegistry();
  const result = planExecution({
    registry,
    observations: allVerifiedObservations(),
    profile: baseProfile(),
    policy: {
      mode: "manual",
      authorizedExecutors: [],
      dataSensitivityPolicy: { public: [], private: [], sensitive: [], unknown: [] },
      maxRetryAttempts: 2,
    },
    decidedAt: "2026-11-13T12:00:00Z",
  });
  assertEquals(result.plan.action, "inline");
  assertEquals(result.plan.primary, undefined);
  assertEquals(result.plan.fallbacks, []);
  assertEquals(result.plan.decisionId, "655#0");
  assertEquals(result.decision.action, "inline");
  assert(result.decision.reasons.some((r) => r.includes("manual")));
  assertEquals(result.decision.candidates.length, embeddedProfiles.length);
});

Deno.test("planner: roteamento autônomo com perfis embutidos seleciona delegate e registra decisão", () => {
  const ids = embeddedProfiles.map((p) => p.id);
  const registry = fullRegistry();
  const result = planExecution({
    registry,
    observations: allVerifiedObservations(ids),
    profile: baseProfile(),
    policy: policy({ authorizedExecutors: ids, dataSensitivityPolicy: allowAll(ids) }),
    decidedAt: "2026-11-13T12:00:00Z",
  });
  assertEquals(result.plan.action, "delegate");
  assert(result.plan.primary !== undefined);
  assertEquals(result.plan.primary.rank, 1);
  assertEquals(result.decision.action, "delegate");
  assertEquals(result.decision.selected?.executorId, result.plan.primary.executorId);
  assertEquals(result.decision.decisionId, "655#0");
  assertEquals(result.decision.decidedAt, "2026-11-13T12:00:00Z");
  // candidatos auditáveis: todos os perfis embutidos presentes
  const candidateIds = result.decision.candidates.map((c) => c.executorId).sort();
  assertEquals(candidateIds, [...ids].sort());
  const selected = result.decision.candidates.find((c) => c.verdict === "selected");
  assert(selected !== undefined);
  assertEquals(selected.rejectedBy, undefined);
  assert(result.plan.reasons.length > 0);
  assert(result.decision.reasons.length > 0);
});

Deno.test("planner: preferência explícita elegível é atendida e cobre perfis embutidos", () => {
  const ids = embeddedProfiles.map((p) => p.id);
  for (const preferred of ids) {
    const registry = fullRegistry();
    const result = planExecution({
      registry,
      observations: allVerifiedObservations(ids),
      profile: baseProfile(),
      policy: policy({ authorizedExecutors: ids, dataSensitivityPolicy: allowAll(ids) }),
      preferredRuntime: preferred,
      decidedAt: "2026-11-13T12:00:00Z",
    });
    assertEquals(result.plan.action, "delegate", `preferência ${preferred}`);
    assertEquals(result.plan.primary?.executorId, preferred, `preferência ${preferred}`);
    assertEquals(result.decision.selected?.executorId, preferred, `preferência ${preferred}`);
    assert(
      result.decision.reasons.some((r) => r.includes("preferência explícita")),
      `razão de preferência para ${preferred}`,
    );
  }
});

Deno.test("planner: fallback ordenado respeita maxRetryAttempts e não inclui primário", () => {
  const ids = ["claude-code", "codex", "opencode"]; // 3 perfis embutidos
  const registry = new CapabilityRegistry();
  for (const id of ids) {
    const p = embeddedProfiles.find((x) => x.id === id)!;
    registry.register(p);
  }
  const result = planExecution({
    registry,
    observations: allVerifiedObservations(ids),
    profile: baseProfile(),
    policy: policy({
      authorizedExecutors: ids,
      dataSensitivityPolicy: allowAll(ids),
      maxRetryAttempts: 1,
    }),
    preferredRuntime: "claude-code",
    decidedAt: "2026-11-13T12:00:00Z",
  });
  assertEquals(result.plan.action, "delegate");
  assertEquals(result.plan.primary?.executorId, "claude-code");
  assertEquals(result.plan.fallbacks.length, 1);
  assertEquals(result.plan.fallbacks[0].rank, 2);
  assert(result.plan.fallbacks[0].executorId !== "claude-code");
  const verdicts = new Map(result.decision.candidates.map((c) => [c.executorId, c.verdict]));
  assertEquals(verdicts.get("claude-code"), "selected");
  assertEquals(verdicts.get(result.plan.fallbacks[0].executorId), "fallback");
});

Deno.test("planner: fallback em cadeia com perfis embutidos inclui múltiplos elegíveis", () => {
  const ids = ["antigravity", "claude-code", "codex", "opencode"];
  const registry = new CapabilityRegistry();
  for (const id of ids) registry.register(embeddedProfiles.find((x) => x.id === id)!);
  const result = planExecution({
    registry,
    observations: allVerifiedObservations(ids),
    profile: baseProfile(),
    policy: policy({
      authorizedExecutors: ids,
      dataSensitivityPolicy: allowAll(ids),
      maxRetryAttempts: 3,
    }),
    preferredRuntime: "antigravity",
    decidedAt: "2026-11-13T12:00:00Z",
  });
  assertEquals(result.plan.primary?.executorId, "antigravity");
  assertEquals(result.plan.fallbacks.length, 3);
  assertEquals(result.plan.fallbacks.map((f) => f.rank), [2, 3, 4]);
  // nenhum fallback repete primário
  assert(result.plan.fallbacks.every((f) => f.executorId !== "antigravity"));
});

Deno.test("planner: preferência explícita indisponível vira ask se interativo", () => {
  const ids = embeddedProfiles.map((p) => p.id);
  const registry = fullRegistry();
  const observations = allVerifiedObservations(ids).map((o) =>
    o.executorId === "codex" ? verifiedCoreObservation("codex", { unavailable: true }) : o
  );
  const result = planExecution({
    registry,
    observations,
    profile: baseProfile(),
    policy: policy({ authorizedExecutors: ids, dataSensitivityPolicy: allowAll(ids) }),
    preferredRuntime: "codex",
    interactive: true,
    decidedAt: "2026-11-13T12:00:00Z",
  });
  assertEquals(result.plan.action, "ask");
  assertEquals(result.plan.primary, undefined);
  assertEquals(result.plan.fallbacks, []);
  assertEquals(result.decision.action, "ask");
  assert(result.decision.reasons.some((r) => r.includes("codex")));
  assert(result.decision.reasons.some((r) => r.includes("não é substituída") || r.includes("ask")));
});

Deno.test("planner: preferência explícita indisponível vira inline se não interativo", () => {
  const ids = embeddedProfiles.map((p) => p.id);
  const registry = fullRegistry();
  const observations = allVerifiedObservations(ids).map((o) =>
    o.executorId === "codex" ? verifiedCoreObservation("codex", { unavailable: true }) : o
  );
  const result = planExecution({
    registry,
    observations,
    profile: baseProfile(),
    policy: policy({ authorizedExecutors: ids, dataSensitivityPolicy: allowAll(ids) }),
    preferredRuntime: "codex",
    interactive: false,
    decidedAt: "2026-11-13T12:00:00Z",
  });
  assertEquals(result.plan.action, "inline");
  assertEquals(result.decision.action, "inline");
  assert(result.decision.reasons.some((r) => r.includes("inline")));
});

Deno.test("planner: preferência explícita desconhecida não é substituída", () => {
  const ids = embeddedProfiles.map((p) => p.id);
  const registry = fullRegistry();
  const result = planExecution({
    registry,
    observations: allVerifiedObservations(ids),
    profile: baseProfile(),
    policy: policy({ authorizedExecutors: ids, dataSensitivityPolicy: allowAll(ids) }),
    preferredRuntime: "inexistente",
    interactive: true,
    decidedAt: "2026-11-13T12:00:00Z",
  });
  assertEquals(result.plan.action, "ask");
  assert(result.decision.reasons.some((r) => r.includes("desconhecida")));
});

Deno.test("planner: sem executor elegível retorna blocked com rejectedBy auditável", () => {
  const ids = embeddedProfiles.map((p) => p.id);
  const registry = fullRegistry();
  // política não autoriza ninguém para public
  const result = planExecution({
    registry,
    observations: allVerifiedObservations(ids),
    profile: baseProfile({ dataSensitivity: "public" }),
    policy: policy({
      authorizedExecutors: ids,
      dataSensitivityPolicy: { public: [], private: [], sensitive: [], unknown: [] },
    }),
    decidedAt: "2026-11-13T12:00:00Z",
  });
  assertEquals(result.plan.action, "blocked");
  assertEquals(result.decision.action, "blocked");
  assertEquals(result.decision.selected, undefined);
  assert(result.decision.candidates.every((c) => c.verdict === "rejected"));
  assert(result.decision.candidates.every((c) => c.rejectedBy !== undefined));
});

Deno.test("planner: Alethe (orchestrator) pode ser selecionado e gera modo orchestrator", () => {
  const ids = ["alethe", "claude-code"];
  const registry = new CapabilityRegistry();
  for (const id of ids) registry.register(embeddedProfiles.find((x) => x.id === id)!);
  const observations = [
    verifiedCoreObservation("alethe"),
    verifiedCoreObservation("claude-code"),
  ];
  const result = planExecution({
    registry,
    observations,
    profile: baseProfile(),
    policy: policy({ authorizedExecutors: ids, dataSensitivityPolicy: allowAll(ids) }),
    preferredRuntime: "alethe",
    decidedAt: "2026-11-13T12:00:00Z",
  });
  assertEquals(result.plan.action, "delegate");
  assertEquals(result.plan.primary?.executorId, "alethe");
  assertEquals(result.plan.primary?.mode, "orchestrator");
  assertEquals(result.decision.selected, { executorId: "alethe", mode: "orchestrator" });
});

Deno.test("planner: requisitos explícitos rejeitam por capability e entram no decision", () => {
  const ids = embeddedProfiles.map((p) => p.id);
  const registry = fullRegistry();
  // exige mcp explicitamente; perfis declaram mcp supported mas evidência verificada do core não cobre mcp -
  // em modo autonomous precisa verified; mcp declarado não vira verified sem observação específica.
  const result = planExecution({
    registry,
    observations: allVerifiedObservations(ids),
    profile: baseProfile({
      requirements: { browser: false, mcp: true },
      provenance: {
        operations: "derived",
        domains: "derived",
        complexity: "derived",
        risk: "derived",
        requirements: "explicit",
        dataSensitivity: "config",
      },
    }),
    policy: policy({ authorizedExecutors: ids, dataSensitivityPolicy: allowAll(ids) }),
    decidedAt: "2026-11-13T12:00:00Z",
  });
  // todos rejeitados por evidence/capability para mcp (mcp declarado mas não verificado em autonomous)
  assertEquals(result.plan.action, "blocked");
  assert(
    result.decision.candidates.some((c) =>
      c.rejectedBy === "evidence" || c.rejectedBy === "capability"
    ),
  );
});
