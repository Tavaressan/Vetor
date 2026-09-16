import { assertEquals } from "@std/assert";

Deno.test("code-review documentation uses Fowler's code smell terminology for architecture findings", async () => {
  const baseDir = Deno.cwd();
  const agentsPath = `${baseDir}/agents/code-review.md`;
  const opencodeAgentPath = `${baseDir}/opencode/agent/code-review.md`;

  // Read both files
  const agentsContent = await Deno.readTextFile(agentsPath);
  const opencodeContent = await Deno.readTextFile(opencodeAgentPath);

  // Fowler code smells that should be mentioned in the documentation
  const expectedSmells = [
    "Duplicated Code",
    "Primitive Obsession",
    "Data Clumps",
    "Mysterious Name",
    "Shotgun Surgery",
    "Divergent Change",
    "Speculative Generality",
    "Message Chains",
    "Middle Man",
    "Repeated Switches",
    "Refused Bequest",
  ];

  // Check agents/code-review.md
  for (const smell of expectedSmells) {
    assertEquals(
      agentsContent.includes(smell),
      true,
      `agents/code-review.md should mention "${smell}" in architecture findings section`,
    );
  }

  // Check opencode/agent/code-review.md
  for (const smell of expectedSmells) {
    assertEquals(
      opencodeContent.includes(smell),
      true,
      `opencode/agent/code-review.md should mention "${smell}" in architecture findings section`,
    );
  }

  // Check for [Smell] prefix format documentation in agents/code-review.md
  assertEquals(
    agentsContent.includes("[Smell]"),
    true,
    `agents/code-review.md should document the optional [Smell] prefix format`,
  );

  // Check for [Smell] prefix format documentation in opencode/agent/code-review.md
  assertEquals(
    opencodeContent.includes("[Smell]"),
    true,
    `opencode/agent/code-review.md should document the optional [Smell] prefix format`,
  );

  // Verify Long Method is NOT used as a smell name (kept as heuristic only)
  const longMethodSnellMatch = agentsContent.match(/\*\*Long Method\*\*:/);
  assertEquals(
    longMethodSnellMatch,
    null,
    `agents/code-review.md should not map Long Method to a code smell name (>30 lines is a heuristic, not a smell)`,
  );

  // Verify Data Clumps and Feature Envy are both mentioned as options
  assertEquals(
    agentsContent.includes("Data Clumps") && agentsContent.includes("Feature Envy"),
    true,
    `agents/code-review.md should mention both Data Clumps and Feature Envy for the 3+ props heuristic`,
  );
});
