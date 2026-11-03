// Orquestração da classificação de falhas: baseline sempre; modelo só com o experimento ligado
// e quando a política deixa mais de uma alternativa. Qualquer falha do provedor cai no fallback
// configurado. O resultado é só uma recomendação — nada aqui executa a ação.

import { classifyBaseline } from "./baseline.ts";
import { buildState } from "./context.ts";
import type { DecisionMetrics } from "./metrics.ts";
import { allowedAlternatives, validateAnswer } from "./policy.ts";
import {
  ALTERNATIVE_DESCRIPTIONS,
  type DecisionAdapterConfig,
  type DecisionProvider,
  type DecisionRequest,
  type DecisionResult,
  type FailureContext,
} from "./types.ts";

export const TRIAGE_INSTRUCTIONS =
  "A development command failed. Using only the facts in the state, choose the next step. " +
  "Do not assume information that is not in the state.";

export function buildRequest(context: FailureContext): DecisionRequest {
  const alternatives: DecisionRequest["alternatives"] = {};
  for (const alt of allowedAlternatives(context)) alternatives[alt] = ALTERNATIVE_DESCRIPTIONS[alt];
  return {
    question: "failure_triage",
    instructions: TRIAGE_INSTRUCTIONS,
    state: buildState(context),
    alternatives,
  };
}

export interface ClassifyOptions {
  config: DecisionAdapterConfig;
  /** Obrigatório só com `config.enabled`; injetável para testes e benchmark. */
  provider?: DecisionProvider;
  metrics?: DecisionMetrics;
}

export async function classifyFailure(
  context: FailureContext,
  { config, provider, metrics }: ClassifyOptions,
): Promise<DecisionResult> {
  const baseline = classifyBaseline(context);
  const baselineResult: DecisionResult = {
    action: baseline,
    source: "baseline",
    provider: "baseline",
    structurallyValid: null,
    policyAccepted: null,
    baseline,
    latencyMs: 0,
  };

  const allowed = allowedAlternatives(context);
  // Desligado, sem provedor ou com uma só alternativa possível: nenhuma chamada de rede.
  if (!config.enabled || !provider || allowed.length < 2) {
    metrics?.record(baselineResult, false);
    return baselineResult;
  }

  const request = buildRequest(context);
  const started = performance.now();
  const signal = AbortSignal.timeout(config.timeoutMs);
  let outcome;
  try {
    outcome = await provider.decide(request, signal);
  } catch {
    // Um provedor que lança em vez de devolver ProviderOutcome também não derruba o fluxo.
    outcome = {
      ok: false as const,
      reason: signal.aborted ? "timeout" as const : "unavailable" as const,
    };
  }
  const latencyMs = performance.now() - started;
  const base = { provider: provider.id, model: provider.model, baseline, latencyMs };
  const fallbackAction = config.fallback === "request_human_review"
    ? "request_human_review"
    : baseline;

  let result: DecisionResult;
  if (!outcome.ok) {
    result = {
      ...base,
      action: fallbackAction,
      source: "fallback",
      structurallyValid: null,
      policyAccepted: null,
      fallbackReason: outcome.reason,
      fallbackDetail: outcome.detail,
    };
    // Falha de transporte: a resposta nunca chegou, então não houve validação.
  } else {
    const validation = validateAnswer(outcome.answer, allowed, config.minimumConfidence);
    if (validation.ok) {
      result = {
        ...base,
        action: validation.choice,
        source: "model",
        modelChoice: validation.choice,
        probabilities: validation.probabilities,
        confidence: validation.confidence,
        structurallyValid: true,
        policyAccepted: true,
      };
    } else {
      result = {
        ...base,
        action: fallbackAction,
        source: "fallback",
        modelChoice: validation.modelChoice,
        structurallyValid: validation.structurallyValid,
        policyAccepted: false,
        fallbackReason: validation.reason,
        fallbackDetail: validation.detail,
      };
    }
  }
  metrics?.record(result, true);
  return result;
}
