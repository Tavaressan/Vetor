import type { HarnessObservation } from "./types.ts";

export interface ObserveOrchestratorProbeInput {
  /** `HarnessDescriptor.id` / `OrchestratorAdapter.id`. */
  executorId: string;
  /** Resultado de `OrchestratorAdapter.isAvailable(context)` (types.ts:113). */
  isAvailable: boolean;
  /**
   * Runtimes MCP detectados pela skill (`mcpAvailable` de delegation-runtime.ts:23).
   * Quando inclui `executorId`, indica disponibilidade via namespace MCP.
   */
  mcpAvailable?: readonly string[];
  /** Horário da observação (ISO 8601). Padrão: `new Date().toISOString()`. */
  observedAt?: string;
}

/**
 * Mapeia os probes existentes de orquestrador (`OrchestratorAdapter.isAvailable`
 * e `mcpAvailable` de `scripts/lib/delegation-runtime.ts:23`) para
 * `HarnessObservation`, sem alterar contratos de `orchestrator/` nem de
 * `delegation-runtime.ts`.
 */
export function observeFromOrchestratorProbe(
  input: ObserveOrchestratorProbeInput,
): HarnessObservation {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const mcpDetected = input.mcpAvailable?.includes(input.executorId) === true;
  const available = input.isAvailable || mcpDetected;
  const sources = [
    ...(input.isAvailable ? ["scripts/lib/orchestrator/types.ts:113"] : []),
    ...(mcpDetected ? ["scripts/lib/delegation-runtime.ts:23"] : []),
  ];
  const source = sources.join(", ") || "scripts/lib/orchestrator/types.ts:113";

  return {
    executorId: input.executorId,
    observedAt,
    installed: available,
    capabilities: available
      ? {
        mcp: {
          state: "supported",
          level: "verified",
          source,
        },
      }
      : {},
    availability: {
      state: available ? "available" : "unavailable",
      reason: available ? undefined : "orquestrador indisponível",
    },
    sideEffects: "none",
  };
}
