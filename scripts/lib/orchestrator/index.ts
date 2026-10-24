/**
 * Ponto de entrada do módulo de orquestradores (issue #482).
 */

import { OrchestratorRegistry } from "./registry.ts";
import { AletheAdapter } from "./adapters/alethe.ts";

export * from "./types.ts";
export * from "./registry.ts";
export * from "./adapters/alethe.ts";

/**
 * Cria uma instância padrão do OrchestratorRegistry pré-populada com o adaptador do Alethe,
 * o único orquestrador com fonte observada (sonda real de 2026-10-23, job-67).
 */
export function createDefaultOrchestratorRegistry(): OrchestratorRegistry {
  const registry = new OrchestratorRegistry();
  registry.register(new AletheAdapter());
  return registry;
}
