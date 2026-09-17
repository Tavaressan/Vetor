import { assertEquals } from "@std/assert";

Deno.test("BLOCKED_WAITING escalation references the Evidence State vocabulary (issue #215)", async () => {
  const baseDir = Deno.cwd();
  const templatePath = `${baseDir}/skills/shared/references/agent-status.template.md`;
  const fixLoopPath = `${baseDir}/skills/fix-loop-agent/SKILL.md`;

  const templateContent = await Deno.readTextFile(templatePath);
  const fixLoopContent = await Deno.readTextFile(fixLoopPath);

  assertEquals(
    templateContent.includes("evidence-state.md"),
    true,
    "agent-status.template.md should reference evidence-state.md in the BLOCKED_WAITING block",
  );

  assertEquals(
    fixLoopContent.includes("evidence-state.md"),
    true,
    "fix-loop-agent/SKILL.md should reference evidence-state.md when guiding BLOCKED_WAITING escalation",
  );

  // Vocabulário mínimo esperado ao qualificar o motivo do bloqueio.
  const expectedVocabulary = ["OPEN_QUESTION", "ASSUMED", "Evidence Conflict"];
  for (const term of expectedVocabulary) {
    assertEquals(
      templateContent.includes(term),
      true,
      `agent-status.template.md should mention "${term}" as part of the Evidence State vocabulary`,
    );
  }
});
