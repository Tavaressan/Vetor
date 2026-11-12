import type { HarnessDescriptor } from "../types.ts";

/**
 * Perfil declarado embutido: Claude Code.
 * Derivado de wiki/Contrato-de-Capacidades.md:24-30 e
 * docs/investigations/descoberta-de-capacidades.md:127-135 (§4.1, #618).
 */
export const claudeCodeProfile: HarnessDescriptor = {
  descriptorVersion: 1,
  id: "claude-code",
  kind: "cli",
  command: "claude",
  declared: {
    terminal: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:127; skills/shared/references/harness-capabilities.md:10",
    },
    filesystem: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:128; skills/shared/references/harness-capabilities.md:10",
    },
    git: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:130; skills/shared/references/harness-capabilities.md:13",
    },
    mcp: {
      state: "supported",
      source: "docs/investigations/descoberta-de-capacidades.md:131",
    },
    browser: {
      state: "unknown",
      source: "docs/investigations/descoberta-de-capacidades.md:129",
    },
    subagents: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:132; wiki/Contrato-de-Capacidades.md:25",
    },
    background: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:133; wiki/Contrato-de-Capacidades.md:29",
    },
    resumable: {
      state: "supported",
      source: "docs/investigations/descoberta-de-capacidades.md:134",
    },
    isolatedWorktree: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:135; wiki/Contrato-de-Capacidades.md:27",
    },
  },
};
