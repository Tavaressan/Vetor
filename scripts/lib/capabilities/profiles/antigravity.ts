import type { HarnessDescriptor } from "../types.ts";

/**
 * Perfil declarado embutido: Antigravity.
 * Derivado de wiki/Contrato-de-Capacidades.md:24-30 e
 * docs/investigations/descoberta-de-capacidades.md:141-149 (§4.2, #618).
 */
export const antigravityProfile: HarnessDescriptor = {
  descriptorVersion: 1,
  id: "antigravity",
  kind: "cli",
  command: "agy",
  declared: {
    terminal: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:141; skills/shared/references/harness-capabilities.md:10",
    },
    filesystem: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:142; skills/shared/references/harness-capabilities.md:10",
    },
    git: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:144; skills/shared/references/harness-capabilities.md:13",
    },
    mcp: {
      state: "supported",
      source: "docs/investigations/descoberta-de-capacidades.md:145",
    },
    browser: {
      state: "unknown",
      source: "docs/investigations/descoberta-de-capacidades.md:143",
    },
    subagents: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:146; wiki/Contrato-de-Capacidades.md:25",
    },
    background: {
      state: "unknown",
      source:
        "docs/investigations/descoberta-de-capacidades.md:147; wiki/Contrato-de-Capacidades.md:29",
    },
    resumable: {
      state: "supported",
      source: "docs/investigations/descoberta-de-capacidades.md:148",
    },
    isolatedWorktree: {
      state: "unsupported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:149; wiki/Contrato-de-Capacidades.md:27",
    },
  },
};
