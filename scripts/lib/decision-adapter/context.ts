// Validação do FailureContext recebido e construção do contexto mínimo enviado ao provedor.

import type { FailureContext } from "./types.ts";

const OPERATIONS = new Set(["test", "build", "typecheck", "lint", "ci"]);
const CATEGORIES = new Set([
  "compile",
  "type",
  "test_assertion",
  "dependency",
  "network",
  "infra",
  "permission",
  "unknown",
]);

export const MAX_SUMMARY_CHARS = 1500;
export const MAX_SIGNATURE_CHARS = 200;
export const MAX_PREVIOUS_SIGNATURES = 5;
/** Teto do `state` serializado — bem abaixo dos 64 KiB que o Ollama aceita. */
export const MAX_STATE_BYTES = 4096;

export type ParsedContext = { ok: true; context: FailureContext } | { ok: false; error: string };

function optionalString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined;
}

/** Aceita só os campos conhecidos; qualquer outro campo do JSON de entrada é descartado. */
export function parseFailureContext(raw: unknown): ParsedContext {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "contexto deve ser um objeto JSON" };
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.operation !== "string" || !OPERATIONS.has(r.operation)) {
    return { ok: false, error: "operation deve ser test|build|typecheck|lint|ci" };
  }
  if (r.exitCode !== null && !Number.isInteger(r.exitCode)) {
    return { ok: false, error: "exitCode deve ser inteiro ou null" };
  }
  if (!Number.isInteger(r.attempt) || (r.attempt as number) < 1) {
    return { ok: false, error: "attempt deve ser inteiro >= 1" };
  }
  if (!Number.isInteger(r.maxAttempts) || (r.maxAttempts as number) < 1) {
    return { ok: false, error: "maxAttempts deve ser inteiro >= 1" };
  }
  if (r.errorCategory !== undefined && !CATEGORIES.has(r.errorCategory as string)) {
    return { ok: false, error: "errorCategory desconhecida" };
  }

  const context: FailureContext = {
    operation: r.operation as FailureContext["operation"],
    exitCode: r.exitCode as number | null,
    attempt: r.attempt as number,
    maxAttempts: r.maxAttempts as number,
  };
  if (r.timedOut === true) context.timedOut = true;
  if (r.errorCategory !== undefined) {
    context.errorCategory = r.errorCategory as FailureContext["errorCategory"];
  }
  const summary = optionalString(r.errorSummary, MAX_SUMMARY_CHARS);
  if (summary) context.errorSummary = summary;
  const signature = optionalString(r.errorSignature, MAX_SIGNATURE_CHARS);
  if (signature) context.errorSignature = signature;
  if (Array.isArray(r.previousErrorSignatures)) {
    context.previousErrorSignatures = r.previousErrorSignatures
      .filter((s): s is string => typeof s === "string")
      .slice(-MAX_PREVIOUS_SIGNATURES)
      .map((s) => s.slice(0, MAX_SIGNATURE_CHARS));
  }
  if (r.retryable === true) context.retryable = true;
  if (r.requiresApproval === true) context.requiresApproval = true;
  return { ok: true, context };
}

const SECRET_PATTERNS: RegExp[] = [
  /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g,
  /\b(github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(sk-[A-Za-z0-9_-]{16,})\b/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b([A-Za-z0-9_]*(?:token|secret|password|passwd|api[_-]?key)[A-Za-z0-9_]*\s*[=:]\s*)\S+/gi,
];

/** Mascara padrões óbvios de segredo. É uma rede de segurança, não uma garantia. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(
      pattern,
      (match, prefix: string) => prefix && prefix !== match ? `${prefix}[REDACTED]` : "[REDACTED]",
    );
  }
  return out;
}

/**
 * Serializa o contexto mínimo para o provedor: só os campos do FailureContext, resumo mascarado
 * e truncado até caber em MAX_STATE_BYTES. Nunca inclui ambiente, caminhos ou arquivos.
 */
export function buildState(context: FailureContext): string {
  const state: Record<string, unknown> = {
    operation: context.operation,
    exitCode: context.exitCode,
    timedOut: context.timedOut ?? false,
    errorCategory: context.errorCategory ?? "unknown",
    attempt: context.attempt,
    maxAttempts: context.maxAttempts,
    retryable: context.retryable ?? false,
    sameErrorAsPreviousAttempt: context.errorSignature !== undefined &&
      context.previousErrorSignatures?.at(-1) === context.errorSignature,
    errorSummary: context.errorSummary ? redactSecrets(context.errorSummary) : "",
  };
  const encoder = new TextEncoder();
  let text = JSON.stringify(state);
  while (encoder.encode(text).length > MAX_STATE_BYTES) {
    const summary = state.errorSummary as string;
    state.errorSummary = summary.slice(0, Math.floor(summary.length * 0.8));
    text = JSON.stringify(state);
  }
  return text;
}
