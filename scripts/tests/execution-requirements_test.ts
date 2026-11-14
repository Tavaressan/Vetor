import { assertEquals } from "@std/assert";
import { CORE_REQUIREMENTS, deriveRequirements } from "../lib/execution/requirements.ts";
import type { TaskProfile } from "../lib/execution/types.ts";

function profile(requirements: { browser: boolean; mcp: boolean }): TaskProfile {
  return {
    profileVersion: 1,
    taskId: "t",
    operations: [],
    domains: [],
    complexity: "unknown",
    risk: "unknown",
    requirements,
    dataSensitivity: "public",
    provenance: {
      operations: "derived",
      domains: "derived",
      complexity: "derived",
      risk: "derived",
      requirements: "explicit",
      dataSensitivity: "default",
    },
    evidence: {
      labels: [],
      acceptanceCriteriaCount: 0,
      resolvedModules: [],
      specProvided: false,
      microSpecProvided: false,
    },
  };
}

Deno.test("deriveRequirements: núcleo sempre exigido", () => {
  assertEquals([...CORE_REQUIREMENTS], ["terminal", "filesystem", "git"]);
  assertEquals(deriveRequirements(profile({ browser: false, mcp: false })), [
    { name: "terminal" },
    { name: "filesystem" },
    { name: "git" },
  ]);
});

Deno.test("deriveRequirements: browser/mcp só por restrição explícita do perfil", () => {
  assertEquals(deriveRequirements(profile({ browser: true, mcp: false })), [
    { name: "terminal" },
    { name: "filesystem" },
    { name: "git" },
    { name: "browser" },
  ]);
  assertEquals(deriveRequirements(profile({ browser: false, mcp: true })), [
    { name: "terminal" },
    { name: "filesystem" },
    { name: "git" },
    { name: "mcp" },
  ]);
  assertEquals(deriveRequirements(profile({ browser: true, mcp: true })), [
    { name: "terminal" },
    { name: "filesystem" },
    { name: "git" },
    { name: "browser" },
    { name: "mcp" },
  ]);
});
