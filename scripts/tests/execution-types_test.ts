import { assert, assertEquals } from "@std/assert";
import type {
  ExecutionOutcome,
  ExecutionPlan,
  ExplicitConstraints,
  RoutingDecision,
  TaskProfile,
} from "../lib/execution/types.ts";
import { DISPATCH_MODES, PLAN_ACTIONS, POLICY_MODES, REJECTED_BY } from "../lib/execution/types.ts";

const provenance: TaskProfile["provenance"] = {
  operations: "derived",
  domains: "derived",
  complexity: "derived",
  risk: "derived",
  requirements: "default",
  dataSensitivity: "config",
};

Deno.test("objetos de exemplo compilam com a forma congelada", () => {
  const profile: TaskProfile = {
    profileVersion: 1,
    taskId: "649",
    operations: ["feat"],
    domains: ["scripts"],
    complexity: "unknown",
    risk: "unknown",
    requirements: { browser: false, mcp: false },
    dataSensitivity: "private",
    provenance,
    evidence: {
      labels: [],
      acceptanceCriteriaCount: 5,
      resolvedModules: [],
      specProvided: false,
      microSpecProvided: false,
    },
  };
  const constraints: ExplicitConstraints = {
    requirements: { mcp: true },
    dataSensitivity: "sensitive",
  };
  const plan: ExecutionPlan = {
    planVersion: 1,
    taskId: profile.taskId,
    policyMode: "assisted",
    action: "delegate",
    primary: { executorId: "claude", mode: "cli", rank: 1 },
    fallbacks: [],
    maxRetryAttempts: 2,
    reasons: [],
    decisionId: "649#0",
  };
  const decision: RoutingDecision = {
    decisionVersion: 1,
    decisionId: plan.decisionId,
    decidedAt: new Date(0).toISOString(),
    taskId: profile.taskId,
    attempt: 0,
    policyMode: plan.policyMode,
    action: plan.action,
    selected: { executorId: "claude", mode: "cli" },
    profile: {
      operations: profile.operations,
      domains: profile.domains,
      dataSensitivity: profile.dataSensitivity,
      requirements: profile.requirements,
      provenance: profile.provenance,
    },
    candidates: [{
      executorId: "claude",
      verdict: "selected",
      detail: "ok",
      evidence: { terminal: "declared" },
    }],
    restrictions: [],
    reasons: [],
  };
  const outcome: ExecutionOutcome = {
    outcomeVersion: 1,
    decisionId: decision.decisionId,
    finishedAt: new Date(0).toISOString(),
    status: "succeeded",
    retryCount: 0,
    fallbackUsed: false,
    humanIntervention: false,
  };
  assertEquals(outcome.decisionId, plan.decisionId);
  assert(constraints.requirements?.mcp);
});

Deno.test("constantes de vocabulário", () => {
  assertEquals([...PLAN_ACTIONS], ["inline", "delegate", "ask", "blocked"]);
  assertEquals([...DISPATCH_MODES], ["cli", "orchestrator", "subagent"]);
  assertEquals([...POLICY_MODES], ["manual", "assisted", "autonomous"]);
  assertEquals(REJECTED_BY.length, 7);
});

Deno.test("execution/ só importa de capabilities/ e da biblioteca padrão", async () => {
  const dir = new URL("../lib/execution/", import.meta.url);
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    const src = await Deno.readTextFile(new URL(entry.name, dir));
    const specs = [...src.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of specs) {
      const ok = spec.startsWith("../capabilities/") || spec.startsWith("./") ||
        spec.startsWith("@std/") ||
        spec.startsWith("node:") || spec.startsWith("jsr:@std/") ||
        spec === "../orchestrator/context-packet.ts";
      assert(ok, `${entry.name} importa fora do permitido: ${spec}`);
    }
  }
});
