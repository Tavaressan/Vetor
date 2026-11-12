// scripts/lib/capabilities/types.ts
// Tipos do Capability Registry (ADR-002, Amendment A1 / contrato mínimo Fase 1).
// Apenas o perfil declarado e estático; verificado/operacional são HarnessObservation.

/** Lista fechada na v1; acrescentar nome é mudança aditiva. */
export const CAPABILITY_NAMES = [
  "terminal",
  "filesystem",
  "git", // núcleo (harness-capabilities.md:10-16)
  "mcp",
  "browser",
  "subagents", // subagente nativo invocado pela skill (modos-de-execucao.md §4)
  "background",
  "resumable",
  "isolatedWorktree",
] as const;
export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

/** Ordem crescente de confiança. `operational` é opt-in e não tem sonda na Fase 1. */
export type EvidenceLevel = "declared" | "verified" | "operational";
export type CapabilityState = "supported" | "unsupported" | "unknown";

export interface CapabilityClaim {
  state: CapabilityState;
  /** Origem citável: `arquivo:linha`, relatório, nome de sonda. Obrigatório (auditabilidade). */
  source: string;
}

/** `cli` = caminho de delegation-runtime.ts; `orchestrator` = OrchestratorAdapter. */
export type ExecutorKind = "cli" | "orchestrator";

/** Perfil estático e declarado. Não contém nada observado em runtime. */
export interface HarnessDescriptor {
  descriptorVersion: 1;
  /** kebab-case; mesmo `id` de `OrchestratorAdapter.id` e valor de `authorizedExecutors`. */
  id: string;
  kind: ExecutorKind;
  /** Executável no PATH (kind "cli"). Ausente para orquestrador sem binário (ex.: Alethe via MCP). */
  command?: string;
  /** Faixa semver que o perfil cobre. Ausente = não restringe. */
  versionRange?: string;
  /** Capacidade ausente do mapa equivale a `unknown`. */
  declared: Partial<Record<CapabilityName, CapabilityClaim>>;
}

/** Resultado de uma sonda executada em runtime. Imutável; nunca vira parte do descritor. */
export interface HarnessObservation {
  executorId: string;
  observedAt: string; // ISO 8601
  version?: string;
  /** Executável resolvido no PATH (cli) ou `isAvailable()` verdadeiro (orchestrator). */
  installed?: boolean;
  capabilities: Partial<
    Record<
      CapabilityName,
      {
        state: CapabilityState;
        level: Exclude<EvidenceLevel, "declared">;
        source: string;
      }
    >
  >;
  /** Estado de uso agora (rate limit, sem modelo saudável, queda). Alimentado pelo adapter. */
  availability?: {
    state: "available" | "degraded" | "unavailable";
    reason?: string;
    until?: string;
  };
  /** `possible` quando a sonda pode instalar/baixar algo (caso do shim do mise, #618 §3.2). */
  sideEffects: "none" | "possible";
}

/** Resultado de `resolveEffective` por capacidade. */
export interface EffectiveCapability {
  state: CapabilityState;
  level: EvidenceLevel;
  sources: string[];
  /** Quando uma observação contradisse o perfil declarado. */
  conflict?: string;
}
