// Contratos do Decision Adapter experimental (docs/investigations/decision-adapter.md).
//
// O núcleo não conhece Claude Code, OpenCode, Codex nem Ollama: os provedores implementam
// `DecisionProvider` e devolvem campos crus (`unknown`), que o núcleo valida antes de usar.

/** Alternativas da classificação de falhas. Nenhuma delas é executada pelo módulo. */
export const ALTERNATIVES = ["inspect_failure", "retry_operation", "request_human_review"] as const;
export type Alternative = typeof ALTERNATIVES[number];

export const ALTERNATIVE_DESCRIPTIONS: Record<Alternative, string> = {
  inspect_failure: "Investigate the failure and collect more evidence before changing anything.",
  retry_operation:
    "Re-run the same operation unchanged, because the failure looks transient (network, timeout, flaky runner).",
  request_human_review:
    "Stop and ask a human, because the failure needs approval, external action or judgement.",
};

export function isAlternative(value: unknown): value is Alternative {
  return typeof value === "string" && (ALTERNATIVES as readonly string[]).includes(value);
}

/**
 * O que o runtime já sabe quando um teste/build falha. Todos os campos vêm do fluxo existente
 * (comando rodado, exit code, orçamento de iterações do fix/ship, assinatura de erro, circuit
 * breaker de infraestrutura); nada aqui é inferido pelo módulo.
 */
export interface FailureContext {
  operation: "test" | "build" | "typecheck" | "lint" | "ci";
  /** `null` quando o processo foi morto (timeout, sinal). */
  exitCode: number | null;
  timedOut?: boolean;
  errorCategory?:
    | "compile"
    | "type"
    | "test_assertion"
    | "dependency"
    | "network"
    | "infra"
    | "permission"
    | "unknown";
  /** Resumo limitado da mensagem de erro — truncado e com segredos mascarados antes do envio. */
  errorSummary?: string;
  /** Tentativa atual, a partir de 1. */
  attempt: number;
  /** Orçamento de tentativas do fluxo (5 no fix, 3 no ship). */
  maxAttempts: number;
  errorSignature?: string;
  /** Assinaturas das tentativas anteriores, da mais antiga para a mais recente. */
  previousErrorSignatures?: string[];
  /** A operação é explicitamente repetível sem efeitos colaterais (ex.: `gh run rerun`). */
  retryable?: boolean;
  /** A próxima ação exige aprovação humana (permissão, billing, segredo). */
  requiresApproval?: boolean;
}

export type FallbackReason =
  | "unavailable"
  | "network_denied"
  | "timeout"
  | "http_error"
  | "model_not_found"
  | "incompatible_endpoint"
  | "invalid_json"
  | "incomplete_response"
  | "unknown_alternative"
  | "invalid_probabilities"
  | "policy_rejected"
  | "low_confidence";

/** Pergunta independente de provedor. */
export interface DecisionRequest {
  question: "failure_triage";
  instructions: string;
  /** Contexto mínimo serializado, já limitado em tamanho. */
  state: string;
  /** Só as alternativas permitidas pela política para este contexto (sempre 2 ou mais). */
  alternatives: Partial<Record<Alternative, string>>;
}

/** Resposta crua do provedor: o núcleo valida cada campo. */
export interface ProviderAnswer {
  choice: unknown;
  probabilities: unknown;
  confidence: unknown;
}

export type ProviderOutcome =
  | { ok: true; answer: ProviderAnswer }
  | { ok: false; reason: FallbackReason; detail?: string };

export interface DecisionProvider {
  readonly id: string;
  readonly model?: string;
  decide(request: DecisionRequest, signal: AbortSignal): Promise<ProviderOutcome>;
}

/** Resultado normalizado — o mesmo formato para a baseline e para o modelo. */
export interface DecisionResult {
  /** Recomendação final. O runtime decide o que fazer com ela; o módulo nunca a executa. */
  action: Alternative;
  source: "baseline" | "model" | "fallback";
  provider: string;
  model?: string;
  /** Escolha crua do modelo (mesmo rejeitada), só se for uma alternativa conhecida. */
  modelChoice?: Alternative;
  probabilities?: Partial<Record<Alternative, number>>;
  confidence?: number;
  /** `null` quando o modelo não foi consultado. */
  structurallyValid: boolean | null;
  policyAccepted: boolean | null;
  fallbackReason?: FallbackReason;
  /** Detalhe não sensível do fallback, para `debug`. */
  fallbackDetail?: string;
  /** Ação da baseline determinística, sempre calculada para comparação. */
  baseline: Alternative;
  latencyMs: number;
}

export interface DecisionAdapterConfig {
  enabled: boolean;
  provider: "ollama";
  endpoint: string;
  model: string;
  timeoutMs: number;
  /** Limite de `confidence` para aceitar a escolha do modelo; `null` desliga o limite. */
  minimumConfidence: number | null;
  fallback: "baseline" | "request_human_review";
  debug: boolean;
}
