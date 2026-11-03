// Política determinística do Decision Adapter: quais alternativas são permitidas num contexto e
// se a resposta do modelo pode ser aceita. A resposta do modelo é entrada não confiável — uma
// resposta estruturalmente válida ainda precisa passar pela política.

import {
  type Alternative,
  type FailureContext,
  type FallbackReason,
  isAlternative,
} from "./types.ts";

/**
 * Restrições rígidas, iguais às das skills:
 * - aprovação exigida, infraestrutura ou permissão → só revisão humana (ship §8.b);
 * - orçamento de tentativas esgotado → só revisão humana (fix §4, ship §8.c);
 * - `retry_operation` só para operação explicitamente repetível.
 */
export function allowedAlternatives(context: FailureContext): Alternative[] {
  if (
    context.requiresApproval || context.errorCategory === "permission" ||
    context.errorCategory === "infra"
  ) {
    return ["request_human_review"];
  }
  if (context.attempt >= context.maxAttempts) return ["request_human_review"];
  const allowed: Alternative[] = ["inspect_failure"];
  if (context.retryable) allowed.push("retry_operation");
  allowed.push("request_human_review");
  return allowed;
}

const PROBABILITY_SUM_TOLERANCE = 0.01;

export type Validation =
  | {
    ok: true;
    choice: Alternative;
    probabilities: Partial<Record<Alternative, number>>;
    confidence?: number;
  }
  | {
    ok: false;
    reason: FallbackReason;
    structurallyValid: boolean;
    modelChoice?: Alternative;
    detail: string;
  };

/**
 * Valida a resposta crua contra as alternativas enviadas e aplica a política. `structurallyValid`
 * separa respostas malformadas (não deveriam ocorrer com um endpoint compatível) de respostas bem
 * formadas que a política recusou.
 */
export function validateAnswer(
  answer: { choice: unknown; probabilities: unknown; confidence: unknown },
  allowed: Alternative[],
  minimumConfidence: number | null,
): Validation {
  const { choice, probabilities, confidence } = answer;
  if (typeof choice !== "string") {
    return {
      ok: false,
      reason: "incomplete_response",
      structurallyValid: false,
      detail: "sem choice",
    };
  }
  if (!isAlternative(choice)) {
    return {
      ok: false,
      reason: "unknown_alternative",
      structurallyValid: false,
      detail: "choice fora do conjunto de alternativas",
    };
  }
  if (typeof probabilities !== "object" || probabilities === null || Array.isArray(probabilities)) {
    return {
      ok: false,
      reason: "invalid_probabilities",
      structurallyValid: false,
      modelChoice: choice,
      detail: "probabilities ausente",
    };
  }
  const probs = probabilities as Record<string, unknown>;
  const keys = Object.keys(probs);
  const normalized: Partial<Record<Alternative, number>> = {};
  let sum = 0;
  for (const alt of allowed) {
    const p = probs[alt];
    if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
      return {
        ok: false,
        reason: "invalid_probabilities",
        structurallyValid: false,
        modelChoice: choice,
        detail: `probabilidade inválida para ${alt}`,
      };
    }
    normalized[alt] = p;
    sum += p;
  }
  if (keys.length !== allowed.length) {
    return {
      ok: false,
      reason: "invalid_probabilities",
      structurallyValid: false,
      modelChoice: choice,
      detail: "probabilities com chaves fora das alternativas enviadas",
    };
  }
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) {
    return {
      ok: false,
      reason: "invalid_probabilities",
      structurallyValid: false,
      modelChoice: choice,
      detail: `probabilities somam ${sum.toFixed(4)}`,
    };
  }
  if (!allowed.includes(choice)) {
    return {
      ok: false,
      reason: "policy_rejected",
      structurallyValid: true,
      modelChoice: choice,
      detail: "alternativa não permitida neste contexto",
    };
  }
  const max = Math.max(...Object.values(normalized));
  if ((normalized[choice] ?? 0) < max - 1e-9) {
    return {
      ok: false,
      reason: "invalid_probabilities",
      structurallyValid: false,
      modelChoice: choice,
      detail: "choice não é a alternativa mais provável",
    };
  }
  const conf = typeof confidence === "number" && Number.isFinite(confidence) &&
      confidence >= 0 && confidence <= 1
    ? confidence
    : undefined;
  if (minimumConfidence !== null && (conf === undefined || conf < minimumConfidence)) {
    return {
      ok: false,
      reason: "low_confidence",
      structurallyValid: true,
      modelChoice: choice,
      detail: conf === undefined
        ? "confidence ausente"
        : `confidence ${conf.toFixed(3)} < ${minimumConfidence}`,
    };
  }
  return { ok: true, choice, probabilities: normalized, confidence: conf };
}
