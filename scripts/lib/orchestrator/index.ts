/**
 * Ponto de entrada do módulo de orquestradores (issue #482).
 */

import { OrchestratorRegistry } from "./registry.ts";
import { AletheAdapter } from "./adapters/alethe.ts";
import { OrcaAdapter } from "./adapters/orca.ts";
import { GenericMcpAdapter } from "./adapters/generic-mcp.ts";
import type { OrchestratorConfig } from "./types.ts";

export * from "./types.ts";
export * from "./registry.ts";
export * from "./adapters/alethe.ts";
export * from "./adapters/orca.ts";
export * from "./adapters/generic-mcp.ts";

/**
 * Cria uma instância padrão do OrchestratorRegistry pré-populada com os adaptadores
 * nativos (Alethe, Orca) e quaisquer adaptadores customizados declarados no config.json.
 */
export function createDefaultOrchestratorRegistry(
  config?: OrchestratorConfig,
): OrchestratorRegistry {
  const registry = new OrchestratorRegistry();
  registry.register(new AletheAdapter());
  registry.register(new OrcaAdapter());

  if (config?.custom) {
    for (const [id, customOpts] of Object.entries(config.custom)) {
      registry.register(
        new GenericMcpAdapter({
          id,
          dispatchTool: customOpts.dispatchTool,
          checkTool: customOpts.checkTool,
          releaseTool: customOpts.releaseTool,
          maxTimeoutMs: customOpts.maxTimeoutMs,
        }),
      );
    }
  }

  return registry;
}
