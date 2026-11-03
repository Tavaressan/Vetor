// Classificação determinística de referência — sem IA, mesmo contrato de saída do modelo.
// Codifica as regras que fix/ship já descrevem em prosa; é a linha de base do experimento.

import { allowedAlternatives } from "./policy.ts";
import type { Alternative, FailureContext } from "./types.ts";

/** Quantas tentativas anteriores com a mesma assinatura caracterizam um loop travado. */
const STUCK_REPEATS = 2;

export function classifyBaseline(context: FailureContext): Alternative {
  const allowed = allowedAlternatives(context);
  // 1. Restrição rígida da política (aprovação, infra, orçamento esgotado).
  if (allowed.length === 1) return allowed[0];

  // 2. Mesma assinatura de erro nas últimas tentativas: novas hipóteses não estão funcionando.
  const previous = context.previousErrorSignatures ?? [];
  if (
    context.errorSignature !== undefined && previous.length >= STUCK_REPEATS &&
    previous.slice(-STUCK_REPEATS).every((s) => s === context.errorSignature)
  ) {
    return "request_human_review";
  }

  // 3. Falha transitória numa operação explicitamente repetível (ship §8.c).
  if (
    allowed.includes("retry_operation") &&
    (context.timedOut === true || context.errorCategory === "network")
  ) {
    return "retry_operation";
  }

  // 4. Erro de código ou evidência insuficiente: investigar.
  return "inspect_failure";
}
