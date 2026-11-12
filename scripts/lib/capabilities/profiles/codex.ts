import type { HarnessDescriptor } from "../types.ts";

/**
 * Perfil declarado embutido: Codex.
 * Derivado de wiki/Contrato-de-Capacidades.md:24-30 e
 * docs/investigations/descoberta-de-capacidades.md:183-191 (§4.5, #618).
 */
export const codexProfile: HarnessDescriptor = {
  descriptorVersion: 1,
  id: "codex",
  kind: "cli",
  command: "codex",
  declared: {
    terminal: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:183; skills/shared/references/harness-capabilities.md:10",
    },
    filesystem: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:184; skills/shared/references/harness-capabilities.md:10",
    },
    git: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:186; skills/shared/references/harness-capabilities.md:13",
    },
    mcp: {
      state: "supported",
      source: "docs/investigations/descoberta-de-capacidades.md:187",
    },
    browser: {
      state: "unknown",
      source: "docs/investigations/descoberta-de-capacidades.md:185",
    },
    subagents: {
      state: "supported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:188; wiki/Contrato-de-Capacidades.md:25",
    },
    background: {
      state: "unknown",
      source:
        "docs/investigations/descoberta-de-capacidades.md:189; wiki/Contrato-de-Capacidades.md:29",
    },
    resumable: {
      state: "supported",
      source: "docs/investigations/descoberta-de-capacidades.md:190",
    },
    isolatedWorktree: {
      state: "unsupported",
      source:
        "docs/investigations/descoberta-de-capacidades.md:191; wiki/Contrato-de-Capacidades.md:27",
    },
  },
};
