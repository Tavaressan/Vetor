import type { HarnessDescriptor } from "../types.ts";

/**
 * Perfil declarado embutido: OpenCode.
 * Derivado de wiki/Contrato-de-Capacidades.md:24-30 e
 * docs/investigations/descoberta-de-capacidades.md:155-163 (§4.3, #618).
 */
export const opencodeProfile: HarnessDescriptor = {
  descriptorVersion: 1,
  id: "opencode",
  kind: "cli",
  command: "opencode",
  declared: {
    terminal: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:155; skills/shared/references/harness-capabilities.md:10",
    },
    filesystem: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:156; skills/shared/references/harness-capabilities.md:10",
    },
    git: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:158; skills/shared/references/harness-capabilities.md:13",
    },
    mcp: {
      state: "supported",
      source: "docs/investigations/descoberta-de-capacidades.md:159",
    },
    browser: {
      state: "unknown",
      source: "docs/investigations/descoberta-de-capacidades.md:157",
    },
    subagents: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:160; wiki/Contrato-de-Capacidades.md:25",
    },
    background: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:161; wiki/Contrato-de-Capacidades.md:29",
    },
    resumable: {
      state: "supported",
      source: "docs/investigations/descoberta-de-capacidades.md:162",
    },
    isolatedWorktree: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:163; wiki/Contrato-de-Capacidades.md:27",
    },
  },
};
