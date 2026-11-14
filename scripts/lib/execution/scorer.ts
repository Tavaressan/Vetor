// Ranking lexicográfico determinístico dos candidatos compatíveis (ADR-002 F2-5,
// docs/investigations/contrato-minimo-fase-1.md §4.5, §5 e §6.1).

import { resolveEffective } from "../capabilities/evidence.ts";
import type { CapabilityRegistry } from "../capabilities/registry.ts";
import type { CapabilityName, EvidenceLevel, HarnessObservation } from "../capabilities/types.ts";
import type { ExecutionPolicy } from "./policy.ts";
import { deriveRequirements } from "./requirements.ts";
import type { MatchCandidate } from "./matcher.ts";
import type { TaskProfile } from "./types.ts";

export type RankingCriterion =
  | "preferredRuntime"
  | "minimumEvidence"
  | "desirableCapabilities"
  | "availability"
  | "id";

export interface RankedCandidate extends MatchCandidate {
  /** Posição 1-based na ordem final. */
  rank: number;
  /** Critério que separou este candidato do anterior; `first` não tem anterior. */
  rankedBy: RankingCriterion | "first";
  /** Menor evidência entre todos os requisitos obrigatórios. */
  minimumEvidence: EvidenceLevel;
  /** Quantidade de capacidades desejáveis efetivamente suportadas. */
  desirableCapabilitiesMet: number;
  availability: "available" | "degraded" | "unavailable";
}

export interface RankExecutorsInput {
  registry: CapabilityRegistry;
  observations?: readonly HarnessObservation[];
  profile: TaskProfile;
  policy: Pick<ExecutionPolicy, "authorizedExecutors">;
  /** Resultado de matchExecutors; candidatos rejeitados são ignorados. */
  candidates: readonly MatchCandidate[];
  /** Preferência explícita de `delegation.preferredRuntime`. */
  preferredRuntime?: string;
  /** Capacidades opcionais de interesse desta tarefa; nunca são gates. */
  desirableCapabilities?: readonly CapabilityName[];
}

const EVIDENCE_ORDER: Record<EvidenceLevel, number> = {
  declared: 0,
  verified: 1,
  operational: 2,
};

const AVAILABILITY_ORDER: Record<RankedCandidate["availability"], number> = {
  available: 0,
  degraded: 1,
  unavailable: 2,
};

interface ScoredCandidate {
  candidate: MatchCandidate;
  preferred: boolean;
  minimumEvidence: EvidenceLevel;
  desirableCapabilitiesMet: number;
  availability: RankedCandidate["availability"];
}

function latestAvailability(
  executorId: string,
  observations: readonly HarnessObservation[],
): RankedCandidate["availability"] {
  let latest: HarnessObservation | undefined;
  let latestTs = Number.NEGATIVE_INFINITY;
  for (const observation of observations) {
    if (observation.executorId !== executorId || !observation.availability) continue;
    const ts = Date.parse(observation.observedAt);
    const observedAt = Number.isFinite(ts) ? ts : Number.NEGATIVE_INFINITY;
    if (!latest || observedAt >= latestTs) {
      latest = observation;
      latestTs = observedAt;
    }
  }
  return latest?.availability?.state ?? "available";
}

function compareId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareScored(left: ScoredCandidate, right: ScoredCandidate): number {
  if (left.preferred !== right.preferred) return left.preferred ? -1 : 1;
  const evidenceDifference = EVIDENCE_ORDER[right.minimumEvidence] -
    EVIDENCE_ORDER[left.minimumEvidence];
  if (evidenceDifference !== 0) return evidenceDifference;
  if (left.desirableCapabilitiesMet !== right.desirableCapabilitiesMet) {
    return right.desirableCapabilitiesMet - left.desirableCapabilitiesMet;
  }
  const availabilityDifference = AVAILABILITY_ORDER[left.availability] -
    AVAILABILITY_ORDER[right.availability];
  if (availabilityDifference !== 0) return availabilityDifference;
  return compareId(left.candidate.executorId, right.candidate.executorId);
}

function decidingCriterion(left: ScoredCandidate, right: ScoredCandidate): RankingCriterion {
  if (left.preferred !== right.preferred) return "preferredRuntime";
  if (left.minimumEvidence !== right.minimumEvidence) return "minimumEvidence";
  if (left.desirableCapabilitiesMet !== right.desirableCapabilitiesMet) {
    return "desirableCapabilities";
  }
  if (left.availability !== right.availability) return "availability";
  return "id";
}

/**
 * Ordena candidatos elegíveis em ordem lexicográfica, sem pesos nem I/O.
 * `rankedBy` aponta o primeiro critério que distingue cada posição da anterior.
 */
export function rankExecutors(input: RankExecutorsInput): RankedCandidate[] {
  const observations = input.observations ?? [];
  const requirements = deriveRequirements(input.profile);
  const requiredNames = new Set(requirements.map(({ name }) => name));
  const desirableCapabilities = [
    ...new Set(input.desirableCapabilities ?? []),
  ].filter((capability) => !requiredNames.has(capability));
  const authorized = new Set(input.policy.authorizedExecutors);
  const scored: ScoredCandidate[] = [];

  for (const candidate of input.candidates) {
    if (candidate.verdict !== "eligible") continue;
    const descriptor = input.registry.get(candidate.executorId);
    if (!descriptor) {
      throw new RangeError(`executor "${candidate.executorId}" não está no CapabilityRegistry`);
    }
    const evidence = requirements.map((requirement) =>
      candidate.evidence[requirement.name] ?? "declared"
    );
    const minimumEvidence = evidence.reduce((minimum, level) =>
      EVIDENCE_ORDER[level] < EVIDENCE_ORDER[minimum] ? level : minimum
    );
    const effective = resolveEffective(descriptor, observations);
    const desirableCapabilitiesMet = desirableCapabilities.filter((capability) =>
      effective[capability].state === "supported"
    ).length;

    scored.push({
      candidate,
      preferred: input.preferredRuntime === candidate.executorId &&
        authorized.has(candidate.executorId),
      minimumEvidence,
      desirableCapabilitiesMet,
      availability: latestAvailability(candidate.executorId, observations),
    });
  }

  scored.sort(compareScored);
  return scored.map((entry, index) => ({
    ...entry.candidate,
    rank: index + 1,
    rankedBy: index === 0 ? "first" : decidingCriterion(entry, scored[index - 1]),
    minimumEvidence: entry.minimumEvidence,
    desirableCapabilitiesMet: entry.desirableCapabilitiesMet,
    availability: entry.availability,
  }));
}
