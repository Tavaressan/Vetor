import type { HarnessDescriptor } from "../types.ts";
import { aletheProfile } from "./alethe.ts";
import { antigravityProfile } from "./antigravity.ts";
import { claudeCodeProfile } from "./claude-code.ts";
import { codexProfile } from "./codex.ts";
import { opencodeProfile } from "./opencode.ts";

/** Perfis declarados embutidos (Claude Code, OpenCode, Antigravity, Codex, Alethe). */
export const embeddedProfiles: readonly HarnessDescriptor[] = [
  claudeCodeProfile,
  opencodeProfile,
  antigravityProfile,
  codexProfile,
  aletheProfile,
];

export { aletheProfile, antigravityProfile, claudeCodeProfile, codexProfile, opencodeProfile };
