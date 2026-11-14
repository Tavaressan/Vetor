// Tipos do plano de execução, perfil de tarefa e registros de decisão
// (ADR-002, Fase 2; contrato congelado em docs/investigations/contrato-minimo-fase-1.md §5.2, §6.1, §6.2).
// Só tipos e constantes; sem lógica. Importa apenas de `capabilities/`.
import type { CapabilityName, EvidenceLevel } from "../capabilities/types.ts";

/** Origem de um campo do perfil. Só `explicit`, `config` e `default` podem gatear. */
export type FieldSource = "derived" | "explicit" | "config" | "default";
export type DataSensitivity = "public" | "private" | "sensitive" | "unknown";

export const FIELD_SOURCES = [
  "derived",
  "explicit",
  "config",
  "default",
] as const satisfies readonly FieldSource[];
export const DATA_SENSITIVITIES = [
  "public",
  "private",
  "sensitive",
  "unknown",
] as const satisfies readonly DataSensitivity[];

export interface TaskProfile {
  profileVersion: 1;
  /** Número da issue ou id externo. */
  taskId: string;
  /** derived */
  operations: string[];
  /** derived */
  domains: string[];
  /** derived, informativo, não gateia. */
  complexity: "low" | "medium" | "high" | "unknown";
  /** derived, informativo, não gateia. */
  risk: "low" | "medium" | "high" | "unknown";
  /** Só vale `true` por restrição explícita. Gateiam o matching. */
  requirements: { browser: boolean; mcp: boolean };
  /** Gateia a autorização. Explícito, vindo de `defaultDataSensitivity` da config, ou `unknown`. */
  dataSensitivity: DataSensitivity;
  provenance: {
    operations: FieldSource;
    domains: FieldSource;
    complexity: FieldSource;
    risk: FieldSource;
    requirements: FieldSource;
    dataSensitivity: FieldSource;
  };
  /** Somente fatos extraídos; nunca corpo da issue nem prompt (§6.3). */
  evidence: {
    titlePrefix?: string;
    labels: string[];
    acceptanceCriteriaCount: number;
    resolvedModules: string[];
    specProvided: boolean;
    microSpecProvided: boolean;
  };
}

/** Restrições declaradas por entrada programática (§5.2); nunca derivadas. */
export interface ExplicitConstraints {
  requirements?: Partial<TaskProfile["requirements"]>;
  dataSensitivity?: DataSensitivity;
  /** Preferência explícita (→ `delegation.preferredRuntime`). */
  preferredExecutor?: string;
}

/** Vocabulário de DelegationAction (delegation-runtime.ts) + "blocked". */
export type PlanAction = "inline" | "delegate" | "ask" | "blocked";
/** `subagent` é modo de despacho, não executor. */
export type DispatchMode = "cli" | "orchestrator" | "subagent";
export type PolicyMode = "manual" | "assisted" | "autonomous";

export const PLAN_ACTIONS = [
  "inline",
  "delegate",
  "ask",
  "blocked",
] as const satisfies readonly PlanAction[];
export const DISPATCH_MODES = [
  "cli",
  "orchestrator",
  "subagent",
] as const satisfies readonly DispatchMode[];
export const POLICY_MODES = [
  "manual",
  "assisted",
  "autonomous",
] as const satisfies readonly PolicyMode[];

export interface PlannedExecutor {
  executorId: string;
  mode: DispatchMode;
  /** → OrchestratorDispatchInput.preferredWorker. */
  preferredWorker?: string;
  /** 1 = primário; ordem lexicográfica de §4.5. */
  rank: number;
}

export interface ExecutionPlan {
  planVersion: 1;
  taskId: string;
  policyMode: PolicyMode;
  action: PlanAction;
  /** Presente quando `action` é `delegate` ou `ask` (proposta ao humano). */
  primary?: PlannedExecutor;
  /** Já passaram por TODOS os filtros do primário; nenhum relaxa restrição. */
  fallbacks: PlannedExecutor[];
  /** Retentativas APÓS o primeiro dispatch. Padrão 2. */
  maxRetryAttempts: number;
  reasons: string[];
  decisionId: string;
}

export type RejectedBy =
  | "authorization" // fora de authorizedExecutors
  | "dataSensitivity" // fora da política do nível
  | "capability" // requisito obrigatório não atendido
  | "evidence" // atendido, mas abaixo da evidência exigida pelo modo
  | "availability" // degradado/indisponível/saturado
  | "attempted" // já falhou nesta execução
  | "preference"; // preferência explícita aponta para outro

export const REJECTED_BY = [
  "authorization",
  "dataSensitivity",
  "capability",
  "evidence",
  "availability",
  "attempted",
  "preference",
] as const satisfies readonly RejectedBy[];

export interface RoutingDecision {
  decisionVersion: 1;
  /** `${taskId}#${attempt}` */
  decisionId: string;
  /** ISO 8601 */
  decidedAt: string;
  taskId: string;
  /** 0 = primeiro dispatch. */
  attempt: number;
  policyMode: PolicyMode;
  action: PlanAction;
  selected?: { executorId: string; mode: DispatchMode };
  /** Resumo do perfil: enums e contagens, nunca corpo da issue nem prompt. */
  profile: {
    operations: string[];
    domains: string[];
    dataSensitivity: DataSensitivity;
    requirements: { browser: boolean; mcp: boolean };
    provenance: TaskProfile["provenance"];
  };
  candidates: Array<{
    executorId: string;
    verdict: "selected" | "fallback" | "rejected";
    rejectedBy?: RejectedBy;
    detail: string;
    /** Nível efetivo de cada capacidade requerida, para auditar o gate de evidência. */
    evidence: Partial<Record<CapabilityName, EvidenceLevel>>;
  }>;
  /** ex.: "dataSensitivity=unknown", "mode=autonomous" */
  restrictions: string[];
  /** Frases curtas, reproduzíveis para as mesmas entradas. */
  reasons: string[];
}

export interface ExecutionOutcome {
  outcomeVersion: 1;
  decisionId: string;
  finishedAt: string;
  status: "succeeded" | "failed" | "cancelled" | "abandoned";
  durationMs?: number;
  retryCount: number;
  fallbackUsed: boolean;
  humanIntervention: boolean;
  validation?: "passed" | "failed" | "not-run";
  /** String opaca informada pelo adapter; o planner não a interpreta. */
  model?: string;
  estimatedCost?: number;
}
