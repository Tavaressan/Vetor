import type { HarnessDescriptor } from "../types.ts";

/**
 * Perfil declarado embutido: Alethe (orquestrador MCP).
 * Derivado de docs/investigations/modos-de-execucao.md:101-104 e
 * scripts/lib/orchestrator/adapters/alethe.ts:33-49,54-58.
 */
export const aletheProfile: HarnessDescriptor = {
  descriptorVersion: 1,
  id: "alethe",
  kind: "orchestrator",
  declared: {
    terminal: {
      state: "supported",
      source:
        "skills/shared/references/harness-capabilities.md:10; docs/investigations/modos-de-execucao.md:101",
    },
    filesystem: {
      state: "supported",
      source:
        "skills/shared/references/harness-capabilities.md:10; docs/investigations/modos-de-execucao.md:101",
    },
    git: {
      state: "supported",
      source:
        "skills/shared/references/harness-capabilities.md:13; docs/investigations/modos-de-execucao.md:101",
    },
    mcp: {
      state: "supported",
      source:
        "docs/investigations/modos-de-execucao.md:101; scripts/lib/orchestrator/adapters/alethe.ts:54",
    },
    browser: {
      state: "unknown",
      source: "docs/investigations/modos-de-execucao.md:101",
    },
    subagents: {
      state: "unsupported",
      source:
        "docs/investigations/modos-de-execucao.md:103; scripts/lib/orchestrator/adapters/alethe.ts:38",
    },
    background: {
      state: "supported",
      source: "docs/investigations/modos-de-execucao.md:104; scripts/lib/orchestrator/types.ts:52",
    },
    resumable: {
      state: "supported",
      source: "docs/investigations/modos-de-execucao.md:104; scripts/lib/orchestrator/types.ts:52",
    },
    isolatedWorktree: {
      state: "supported",
      source: "docs/investigations/modos-de-execucao.md:104; scripts/lib/orchestrator/types.ts:38",
    },
  },
};
