// Métricas em memória do Decision Adapter. Nada é persistido nem enviado para fora do processo.

import type { Alternative, DecisionResult, FallbackReason } from "./types.ts";

export interface MetricsSnapshot {
  requests: number;
  /** Chamadas efetivas ao provedor (contextos com uma só alternativa permitida não chamam). */
  modelCalls: number;
  valid: number;
  rejected: number;
  timeouts: number;
  fallbacks: number;
  fallbackReasons: Partial<Record<FallbackReason, number>>;
  modelChoices: Partial<Record<Alternative, number>>;
  /** Respostas válidas do modelo que divergem da baseline. */
  disagreements: number;
  latencyMs: { count: number; mean: number; p50: number; p95: number; p99: number; max: number };
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export class DecisionMetrics {
  #requests = 0;
  #modelCalls = 0;
  #valid = 0;
  #rejected = 0;
  #timeouts = 0;
  #fallbacks = 0;
  #reasons: Partial<Record<FallbackReason, number>> = {};
  #choices: Partial<Record<Alternative, number>> = {};
  #disagreements = 0;
  #latencies: number[] = [];

  record(result: DecisionResult, modelCalled: boolean): void {
    this.#requests++;
    if (!modelCalled) return;
    this.#modelCalls++;
    this.#latencies.push(result.latencyMs);
    if (result.modelChoice) {
      this.#choices[result.modelChoice] = (this.#choices[result.modelChoice] ?? 0) + 1;
    }
    if (result.source === "model") {
      this.#valid++;
      if (result.action !== result.baseline) this.#disagreements++;
      return;
    }
    this.#fallbacks++;
    if (result.fallbackReason) {
      this.#reasons[result.fallbackReason] = (this.#reasons[result.fallbackReason] ?? 0) + 1;
      if (result.fallbackReason === "timeout") this.#timeouts++;
    }
    if (result.structurallyValid !== null) this.#rejected++;
  }

  snapshot(): MetricsSnapshot {
    const sorted = [...this.#latencies].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
      requests: this.#requests,
      modelCalls: this.#modelCalls,
      valid: this.#valid,
      rejected: this.#rejected,
      timeouts: this.#timeouts,
      fallbacks: this.#fallbacks,
      fallbackReasons: { ...this.#reasons },
      modelChoices: { ...this.#choices },
      disagreements: this.#disagreements,
      latencyMs: {
        count: sorted.length,
        mean: sorted.length ? sum / sorted.length : 0,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        p99: percentile(sorted, 99),
        max: sorted.at(-1) ?? 0,
      },
    };
  }
}
