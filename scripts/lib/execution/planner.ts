// Planner em modo recomendação e dry-run (ADR-002, Fase 2, F2-7;
// docs/investigations/contrato-minimo-fase-1.md §4.5, §5, §6.1, §6.2).
// Encadeia filtros (manual → inline; autorização; requisitos; disponibilidade; ranking;
// fallbacks) e devolve ExecutionPlan e RoutingDecision com reasons reproduzíveis e
// candidates com rejectedBy. Só recomenda: não despacha, não chama selectDelegationRuntime
// nem OrchestratorRegistry.

import type { CapabilityRegistry } from "../capabilities/registry.ts";
import type { CapabilityName, HarnessObservation } from "../capabilities/types.ts";
import { buildFallbacks } from "./fallback.ts";
import { matchExecutors } from "./matcher.ts";
import type { ExecutionPolicy } from "./policy.ts";
import { rankExecutors } from "./scorer.ts";
import type {
  ExecutionPlan,
  PlanAction,
  PlannedExecutor,
  RejectedBy,
  RoutingDecision,
  TaskProfile,
} from "./types.ts";

export interface PlanExecutionInput {
  registry: CapabilityRegistry;
  observations?: readonly HarnessObservation[];
  profile: TaskProfile;
  policy: ExecutionPolicy;
  /** Preferência explícita (`delegation.preferredRuntime`). */
  preferredRuntime?: string;
  /** Necessário para decidir `ask` vs `inline` quando a preferência não pode ser atendida. */
  interactive?: boolean;
  /** 0 = primeiro dispatch. */
  attempt?: number;
  /** ISO 8601; injetável para determinismo em testes. */
  decidedAt?: string;
  /** Capacidades opcionais de interesse (ranking, nunca gates). */
  desirableCapabilities?: readonly CapabilityName[];
}

export interface PlanExecutionResult {
  plan: ExecutionPlan;
  decision: RoutingDecision;
}

function decisionIdOf(taskId: string, attempt: number): string {
  return `${taskId}#${attempt}`;
}

function profileSummary(profile: TaskProfile): RoutingDecision["profile"] {
  return {
    operations: [...profile.operations],
    domains: [...profile.domains],
    dataSensitivity: profile.dataSensitivity,
    requirements: { ...profile.requirements },
    provenance: { ...profile.provenance },
  };
}

function restrictionsOf(policy: ExecutionPolicy, profile: TaskProfile): string[] {
  const restrictions: string[] = [`mode=${policy.mode}`];
  restrictions.push(`dataSensitivity=${profile.dataSensitivity}`);
  return restrictions;
}

function plannedFor(
  registry: CapabilityRegistry,
  executorId: string,
  rank: number,
): PlannedExecutor {
  const descriptor = registry.get(executorId);
  if (!descriptor) {
    throw new RangeError(`executor "${executorId}" não está no CapabilityRegistry`);
  }
  return { executorId, mode: descriptor.kind, rank };
}

function inlineResult(
  input: PlanExecutionInput,
  decidedAt: string,
  reasons: string[],
  candidates: RoutingDecision["candidates"],
  action: "inline",
): PlanExecutionResult {
  const attempt = input.attempt ?? 0;
  const decisionId = decisionIdOf(input.profile.taskId, attempt);
  const decision: RoutingDecision = {
    decisionVersion: 1,
    decisionId,
    decidedAt,
    taskId: input.profile.taskId,
    attempt,
    policyMode: input.policy.mode,
    action,
    profile: profileSummary(input.profile),
    candidates,
    restrictions: restrictionsOf(input.policy, input.profile),
    reasons: [...reasons],
  };
  const plan: ExecutionPlan = {
    planVersion: 1,
    taskId: input.profile.taskId,
    policyMode: input.policy.mode,
    action,
    fallbacks: [],
    maxRetryAttempts: input.policy.maxRetryAttempts,
    reasons: [...reasons],
    decisionId,
  };
  return { plan, decision };
}

function emptyCandidates(registry: CapabilityRegistry): RoutingDecision["candidates"] {
  return registry.list().map((d) => ({
    executorId: d.id,
    verdict: "rejected" as const,
    rejectedBy: "authorization" as const,
    detail: "roteamento em modo manual; nenhum executor avaliado",
    evidence: {},
  }));
}

export function planExecution(input: PlanExecutionInput): PlanExecutionResult {
  const decidedAt = input.decidedAt ?? new Date().toISOString();
  const attempt = input.attempt ?? 0;
  const { registry, profile, policy } = input;
  const observations = input.observations ?? [];
  const interactive = input.interactive === true;
  const decisionId = decisionIdOf(profile.taskId, attempt);

  // (1) modo manual → inline
  if (policy.mode === "manual") {
    return inlineResult(
      input,
      decidedAt,
      ["modo manual: roteamento desligado, execução inline"],
      emptyCandidates(registry),
      "inline",
    );
  }

  // (2)-(4) autorização, requisitos/evidência, disponibilidade
  const matched = matchExecutors({ registry, observations, profile, policy });

  // (5) ranking lexicográfico
  const ranking = rankExecutors({
    registry,
    observations,
    profile,
    policy,
    candidates: matched,
    ...(input.preferredRuntime !== undefined ? { preferredRuntime: input.preferredRuntime } : {}),
    ...(input.desirableCapabilities !== undefined
      ? { desirableCapabilities: input.desirableCapabilities }
      : {}),
  });

  const preference = input.preferredRuntime;

  // Preferência explícita indisponível ou sem a capacidade requerida não é substituída:
  // ask se interativo, senão inline.
  if (preference !== undefined && !ranking.some((c) => c.executorId === preference)) {
    const action: PlanAction = interactive ? "ask" : "inline";
    const preferenceDetail = (() => {
      const match = matched.find((c) => c.executorId === preference);
      if (!match) {
        return `preferência explícita "${preference}" desconhecida no registry; não é substituída`;
      }
      if (match.verdict === "rejected") {
        return `preferência explícita "${preference}" inelegível (${match.rejectedBy}: ${match.detail}); não é substituída`;
      }
      return `preferência explícita "${preference}" não elegível; não é substituída`;
    })();
    const reasons = [
      preferenceDetail,
      action === "ask"
        ? "ação ask: preferência explícita indisponível em contexto interativo"
        : "ação inline: preferência explícita indisponível em contexto não interativo",
    ];
    const candidates: RoutingDecision["candidates"] = matched.map((c) => ({
      executorId: c.executorId,
      verdict: "rejected",
      ...(c.verdict === "rejected" && c.rejectedBy ? { rejectedBy: c.rejectedBy } : {}),
      detail: c.executorId === preference ? preferenceDetail : c.detail,
      evidence: { ...c.evidence },
      ...(c.executorId === preference && c.verdict === "eligible"
        ? { rejectedBy: "preference" as RejectedBy }
        : {}),
    }));
    // se a preferência não está no registry, inclui um candidato rejeitado explícito
    if (!matched.some((c) => c.executorId === preference)) {
      candidates.push({
        executorId: preference,
        verdict: "rejected",
        rejectedBy: "preference",
        detail: preferenceDetail,
        evidence: {},
      });
      candidates.sort((a, b) => a.executorId.localeCompare(b.executorId));
    }
    // para elegíveis que não são a preferência, marca como rejeitados por preference (não substituem)
    for (const cand of candidates) {
      if (cand.executorId !== preference && cand.verdict === "rejected" && !cand.rejectedBy) {
        cand.rejectedBy = "preference";
      }
    }
    const decision: RoutingDecision = {
      decisionVersion: 1,
      decisionId,
      decidedAt,
      taskId: profile.taskId,
      attempt,
      policyMode: policy.mode,
      action,
      profile: profileSummary(profile),
      candidates,
      restrictions: restrictionsOf(policy, profile),
      reasons,
    };
    const plan: ExecutionPlan = {
      planVersion: 1,
      taskId: profile.taskId,
      policyMode: policy.mode,
      action,
      fallbacks: [],
      maxRetryAttempts: policy.maxRetryAttempts,
      reasons,
      decisionId,
    };
    return { plan, decision };
  }

  // Sem candidatos elegíveis → bloqueado
  if (ranking.length === 0) {
    const reasons = [
      "nenhum executor elegível após autorização, sensibilidade, requisitos/evidência e disponibilidade",
      "ação blocked: não há candidato para delegação",
    ];
    const candidates: RoutingDecision["candidates"] = matched.map((c) => ({
      executorId: c.executorId,
      verdict: "rejected",
      ...(c.rejectedBy ? { rejectedBy: c.rejectedBy } : {}),
      detail: c.detail,
      evidence: { ...c.evidence },
    }));
    const decision: RoutingDecision = {
      decisionVersion: 1,
      decisionId,
      decidedAt,
      taskId: profile.taskId,
      attempt,
      policyMode: policy.mode,
      action: "blocked",
      profile: profileSummary(profile),
      candidates,
      restrictions: restrictionsOf(policy, profile),
      reasons,
    };
    const plan: ExecutionPlan = {
      planVersion: 1,
      taskId: profile.taskId,
      policyMode: policy.mode,
      action: "blocked",
      fallbacks: [],
      maxRetryAttempts: policy.maxRetryAttempts,
      reasons,
      decisionId,
    };
    return { plan, decision };
  }

  const primaryRanked = ranking[0];
  const primary = plannedFor(registry, primaryRanked.executorId, 1);
  const fb = buildFallbacks({
    registry,
    ranking,
    maxRetryAttempts: policy.maxRetryAttempts,
    ...(preference !== undefined ? { preferredRuntime: preference } : {}),
  });

  const fallbackIds = new Set(fb.fallbacks.map((f) => f.executorId));
  const excludedById = new Map(fb.excluded.map((e) => [e.executorId, e]));
  const matchedById = new Map(matched.map((c) => [c.executorId, c]));

  const candidates: RoutingDecision["candidates"] = matched.map((c) => {
    if (c.executorId === primaryRanked.executorId) {
      return {
        executorId: c.executorId,
        verdict: "selected" as const,
        detail: c.detail,
        evidence: { ...c.evidence },
      };
    }
    if (fallbackIds.has(c.executorId)) {
      return {
        executorId: c.executorId,
        verdict: "fallback" as const,
        detail: c.detail,
        evidence: { ...c.evidence },
      };
    }
    if (c.verdict === "rejected") {
      return {
        executorId: c.executorId,
        verdict: "rejected" as const,
        ...(c.rejectedBy ? { rejectedBy: c.rejectedBy } : {}),
        detail: c.detail,
        evidence: { ...c.evidence },
      };
    }
    // elegível mas fora dos fallbacks (limite de retentativas) ou excluído
    const exclusion = excludedById.get(c.executorId);
    if (exclusion) {
      return {
        executorId: c.executorId,
        verdict: "rejected" as const,
        rejectedBy: exclusion.rejectedBy,
        detail: exclusion.detail,
        evidence: { ...c.evidence },
      };
    }
    return {
      executorId: c.executorId,
      verdict: "rejected" as const,
      detail: "elegível, mas fora do limite de retentativas",
      evidence: { ...c.evidence },
    };
  });

  const reasons: string[] = [
    `selecionado ${primary.executorId} (rank 1, critério ${primaryRanked.rankedBy})`,
  ];
  if (preference !== undefined && preference === primary.executorId) {
    reasons.push(`preferência explícita "${preference}" atendida`);
  }
  if (fb.fallbacks.length > 0) {
    reasons.push(
      `fallbacks: ${fb.fallbacks.map((f) => `${f.executorId}(rank ${f.rank})`).join(", ")}`,
    );
  }
  reasons.push(...fb.reasons);

  const decision: RoutingDecision = {
    decisionVersion: 1,
    decisionId,
    decidedAt,
    taskId: profile.taskId,
    attempt,
    policyMode: policy.mode,
    action: "delegate",
    selected: { executorId: primary.executorId, mode: primary.mode },
    profile: profileSummary(profile),
    candidates,
    restrictions: restrictionsOf(policy, profile),
    reasons,
  };
  const plan: ExecutionPlan = {
    planVersion: 1,
    taskId: profile.taskId,
    policyMode: policy.mode,
    action: "delegate",
    primary,
    fallbacks: fb.fallbacks,
    maxRetryAttempts: policy.maxRetryAttempts,
    reasons,
    decisionId,
  };
  // keep references consistent
  void matchedById;
  return { plan, decision };
}
