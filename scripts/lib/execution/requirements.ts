// Derivação de requisitos obrigatórios a partir do TaskProfile (ADR-002 F2-4,
// docs/investigations/contrato-minimo-fase-1.md §4.5, §5, §6.1).
// Funções puras; sem I/O. Núcleo sempre exigido; browser/mcp só por restrição explícita.

import type { CapabilityName, EvidenceLevel } from "../capabilities/types.ts";
import type { TaskProfile } from "./types.ts";

/** Requisito de capacidade com evidência mínima opcional por requisito. */
export interface RequiredCapability {
  name: CapabilityName;
  /** Eleva (nunca reduz) a evidência mínima exigida pelo modo. */
  minLevel?: EvidenceLevel;
}

/** Capacidades do núcleo, sempre obrigatórias para qualquer candidato. */
export const CORE_REQUIREMENTS: readonly CapabilityName[] = [
  "terminal",
  "filesystem",
  "git",
];

/**
 * Deriva os requisitos obrigatórios do perfil.
 * - Núcleo (`terminal`, `filesystem`, `git`) sempre incluído.
 * - `browser`/`mcp` apenas quando explicitamente requeridos no perfil.
 * Ordem determinística: núcleo, depois opcionais em ordem estável.
 */
export function deriveRequirements(profile: TaskProfile): RequiredCapability[] {
  const requirements: RequiredCapability[] = CORE_REQUIREMENTS.map((name) => ({ name }));
  if (profile.requirements.browser) requirements.push({ name: "browser" });
  if (profile.requirements.mcp) requirements.push({ name: "mcp" });
  return requirements;
}
