// Matcher com eliminação auditável (ADR-002 F2-4,
// docs/investigations/contrato-minimo-fase-1.md §4.5, §5, §6.1).
// Aplica filtros 2 a 4 sobre candidatos do CapabilityRegistry:
// (2) autorização, (3) requisitos com meetsEvidence, (4) availability ≠ unavailable.
// Cada eliminação registra RejectedBy e detail. Função pura e determinística.

import { meetsEvidence, resolveEffective } from "../capabilities/evidence.ts";
import type { CapabilityRegistry } from "../capabilities/registry.ts";
import type {
  CapabilityName,
  EffectiveCapability,
  EvidenceLevel,
  HarnessObservation,
} from "../capabilities/types.ts";
import type { ExecutionPolicy } from "./policy.ts";
import { deriveRequirements, type RequiredCapability } from "./requirements.ts";
import type { RejectedBy, TaskProfile } from "./types.ts";

export interface MatchCandidate {
  executorId: string;
  verdict: "eligible" | "rejected";
  rejectedBy?: RejectedBy;
  detail: string;
  /** Nível efetivo de cada capacidade requerida, para auditar o gate de evidência. */
  evidence: Partial<Record<CapabilityName, EvidenceLevel>>;
}

export interface MatchInput {
  registry: CapabilityRegistry;
  observations?: readonly HarnessObservation[];
  profile: TaskProfile;
  policy: Pick<ExecutionPolicy, "mode" | "authorizedExecutors" | "dataSensitivityPolicy">;
}

function latestAvailability(
  executorId: string,
  observations: readonly HarnessObservation[],
): HarnessObservation["availability"] | undefined {
  let latest: HarnessObservation | undefined;
  let latestTs = Number.NEGATIVE_INFINITY;
  for (const obs of observations) {
    if (obs.executorId !== executorId || !obs.availability) continue;
    const ts = Date.parse(obs.observedAt);
    const t = Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
    if (!latest || t >= latestTs) {
      latest = obs;
      latestTs = t;
    }
  }
  return latest?.availability;
}

function evidenceOf(
  effective: Record<CapabilityName, EffectiveCapability>,
  requirements: readonly RequiredCapability[],
): Partial<Record<CapabilityName, EvidenceLevel>> {
  const out: Partial<Record<CapabilityName, EvidenceLevel>> = {};
  for (const req of requirements) {
    out[req.name] = effective[req.name].level;
  }
  return out;
}

function firstFailingRequirement(
  effective: Record<CapabilityName, EffectiveCapability>,
  requirements: readonly RequiredCapability[],
  mode: ExecutionPolicy["mode"],
): { req: RequiredCapability; cap: EffectiveCapability; reason: "capability" | "evidence" } | null {
  for (const req of requirements) {
    const cap = effective[req.name];
    if (cap.state !== "supported") {
      return { req, cap, reason: "capability" };
    }
    if (!meetsEvidence(cap, mode, req.minLevel)) {
      return { req, cap, reason: "evidence" };
    }
  }
  return null;
}

/**
 * Avalia candidatos do registry (ordem determinística de `registry.list()`), aplicando
 * filtros 2-4 de §6.1. Não realiza seleção/ranking (filtro 5) nem trata modo manual.
 * Descritores não registrados/validados nunca são candidatos (garantido pelo registry).
 */
export function matchExecutors(input: MatchInput): MatchCandidate[] {
  const { registry, profile, policy } = input;
  const observations = input.observations ?? [];
  const requirements = deriveRequirements(profile);
  const authorized = new Set(policy.authorizedExecutors);
  const allowedForSensitivity = new Set(
    policy.dataSensitivityPolicy[profile.dataSensitivity] ?? [],
  );

  return registry.list().map((descriptor) => {
    const effective = resolveEffective(descriptor, observations);
    const evidence = evidenceOf(effective, requirements);
    const id = descriptor.id;

    if (!authorized.has(id)) {
      return {
        executorId: id,
        verdict: "rejected",
        rejectedBy: "authorization",
        detail: `executor "${id}" não está em authorizedExecutors`,
        evidence,
      };
    }
    if (!allowedForSensitivity.has(id)) {
      return {
        executorId: id,
        verdict: "rejected",
        rejectedBy: "dataSensitivity",
        detail: `executor "${id}" não permitido para dataSensitivity="${profile.dataSensitivity}"`,
        evidence,
      };
    }

    const failing = firstFailingRequirement(effective, requirements, policy.mode);
    if (failing) {
      const { req, cap, reason } = failing;
      if (reason === "capability") {
        return {
          executorId: id,
          verdict: "rejected",
          rejectedBy: "capability",
          detail:
            `requisito "${req.name}" não atendido (estado efetivo: ${cap.state}, nível: ${cap.level})`,
          evidence,
        };
      }
      return {
        executorId: id,
        verdict: "rejected",
        rejectedBy: "evidence",
        detail:
          `requisito "${req.name}" abaixo da evidência exigida (estado: ${cap.state}, nível: ${cap.level}${
            req.minLevel ? `, mínimo requerido: ${req.minLevel}` : ""
          })`,
        evidence,
      };
    }

    const availability = latestAvailability(id, observations);
    if (availability?.state === "unavailable") {
      return {
        executorId: id,
        verdict: "rejected",
        rejectedBy: "availability",
        detail: availability.reason
          ? `executor indisponível: ${availability.reason}`
          : "executor indisponível",
        evidence,
      };
    }

    return {
      executorId: id,
      verdict: "eligible",
      detail: "aprovado nos filtros de autorização, requisitos/evidência e disponibilidade",
      evidence,
    };
  });
}
