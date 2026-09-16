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
    "Long Method",
    "Duplicate Code",
    "Primitive Obsession",
    "Data Clumps",
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
});
