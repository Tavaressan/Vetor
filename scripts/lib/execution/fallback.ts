// Fallback ordenado que nunca relaxa restrições (ADR-002 F2-6,
// docs/investigations/contrato-minimo-fase-1.md §4.5, §6.1).
// Parte do ranking de `rankExecutors`, cujos candidatos já passaram por TODOS os filtros
// (autorização, sensibilidade, requisitos/evidência e disponibilidade). Esta função só
// remove e trunca: nunca adiciona executor fora do ranking nem relaxa filtro.
// Função pura e determinística; sem I/O.

import type { CapabilityRegistry } from "../capabilities/registry.ts";
import type { RankedCandidate } from "./scorer.ts";
import type { PlannedExecutor, RejectedBy } from "./types.ts";

export interface FallbackExclusion {
  executorId: string;
  rejectedBy: Extract<RejectedBy, "attempted" | "preference">;
  detail: string;
}

export interface BuildFallbacksInput {
  registry: CapabilityRegistry;
  /** Resultado de `rankExecutors`; só candidatos elegíveis e já ordenados. */
  ranking: readonly RankedCandidate[];
  /** Executores já tentados nesta execução; nunca voltam como fallback. */
  attempted?: readonly string[];
  /** Retentativas APÓS o primeiro dispatch (`ExecutionPolicy.maxRetryAttempts`). */
  maxRetryAttempts: number;
  /** Preferência explícita (`delegation.preferredRuntime`). */
  preferredRuntime?: string;
}

export interface FallbackResult {
  /** `rank` 2, 3, ... (o primário é 1 e não entra aqui). */
  fallbacks: PlannedExecutor[];
  /** Candidatos do ranking que ficaram de fora por `attempted` ou `preference`. */
  excluded: FallbackExclusion[];
  reasons: string[];
}

/**
 * Monta a lista de fallbacks a partir do ranking.
 *
 * - O primário é `ranking[0]` e não aparece nos fallbacks.
 * - Executores em `attempted` saem.
 * - A lista tem no máximo `maxRetryAttempts` itens.
 * - Preferência explícita que não está no ranking (indisponível, sem a capacidade requerida,
 *   não autorizada) não é substituída: não há fallback.
 */
export function buildFallbacks(input: BuildFallbacksInput): FallbackResult {
  const { registry, ranking, preferredRuntime } = input;
  const max = input.maxRetryAttempts;
  if (!Number.isSafeInteger(max) || max < 0) {
    throw new RangeError("maxRetryAttempts deve ser um inteiro seguro não negativo");
  }

  const excluded: FallbackExclusion[] = [];
  const reasons: string[] = [];
  const rest = ranking.slice(1);

  if (preferredRuntime !== undefined && !ranking.some((c) => c.executorId === preferredRuntime)) {
    for (const candidate of rest) {
      excluded.push({
        executorId: candidate.executorId,
        rejectedBy: "preference",
        detail:
          `preferência explícita "${preferredRuntime}" não está elegível; não é substituída por fallback`,
      });
    }
    reasons.push(
      `preferência explícita "${preferredRuntime}" indisponível ou sem a capacidade requerida: sem fallback`,
    );
    return { fallbacks: [], excluded, reasons };
  }

  const attempted = new Set(input.attempted ?? []);
  const remaining: RankedCandidate[] = [];
  for (const candidate of rest) {
    if (attempted.has(candidate.executorId)) {
      excluded.push({
        executorId: candidate.executorId,
        rejectedBy: "attempted",
        detail: `executor "${candidate.executorId}" já foi tentado nesta execução`,
      });
    } else {
      remaining.push(candidate);
    }
  }

  const selected = remaining.slice(0, max);
  const fallbacks = selected.map((candidate, index): PlannedExecutor => {
    const descriptor = registry.get(candidate.executorId);
    if (!descriptor) {
      throw new RangeError(`executor "${candidate.executorId}" não está no CapabilityRegistry`);
    }
    return {
      executorId: candidate.executorId,
      mode: descriptor.kind,
      rank: index + 2,
    };
  });

  if (fallbacks.length === 0) {
    reasons.push("nenhum fallback restante após filtros, tentativas e limite de retentativas");
  } else if (remaining.length > selected.length) {
    reasons.push(`fallbacks limitados a maxRetryAttempts=${max}`);
  }
  return { fallbacks, excluded, reasons };
}
