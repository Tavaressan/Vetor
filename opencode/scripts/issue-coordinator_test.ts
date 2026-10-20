import { assert, assertNotMatch, assertStringIncludes } from "@std/assert";

function extractFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert(match !== null, "frontmatter YAML ausente");
  return match[1];
}

Deno.test("issue-coordinator documenta o checkpoint de fechamento de onda — issue #335", async () => {
  const document = await Deno.readTextFile(
    new URL("../agent/issue-coordinator.md", import.meta.url),
  );
  const reportHeading = document.indexOf("## Coordinator Report (OpenCode)");
  const checkpoint = document.indexOf("Checkpoint de fechamento de onda (issue #246)");
  const headlessInstructions = document.indexOf("Em `--headless`, o relatório é a única saída");

  assert(reportHeading >= 0);
  assert(checkpoint > reportHeading);
  assert(headlessInstructions > checkpoint);
  assertStringIncludes(document, "`Review required`");
  assertStringIncludes(document, "`GREEN (pronto para ship)`");
  assertStringIncludes(document, "`SKIPPED (aguardando insumo do usuário)`");
  assertStringIncludes(document, "`SKIPPED (fora deste repositório)`");
  assertStringIncludes(document, "`SKIPPED (épico/acompanhamento)`");
  assertStringIncludes(document, "não pergunte");
  assertStringIncludes(document, "nem redespache");
});

Deno.test("issue-coordinator documenta escalação simple -> complex após FAILED_MAX_ITERATIONS e sem default embutido — issue #395", async () => {
  const document = await Deno.readTextFile(
    new URL("../agent/issue-coordinator.md", import.meta.url),
  );

  assertNotMatch(
    document,
    /default embutido[\s\S]{0,40}resolve-model\.ts/,
    "issue-coordinator.md não deve citar default embutido em resolve-model.ts (removido na #312)",
  );

  const redispatchIndex = document.indexOf("Redespacho de worktree existente");
  assert(redispatchIndex >= 0, "seção de redespacho de worktree existente ausente");
  const redispatchSection = document.slice(redispatchIndex, redispatchIndex + 1500);

  assertStringIncludes(redispatchSection, "FAILED_MAX_ITERATIONS");
  assertStringIncludes(redispatchSection, "simple");
  assertStringIncludes(redispatchSection, "complex");
  assertStringIncludes(redispatchSection, "uma vez");
  assertStringIncludes(redispatchSection, "resolve-model.ts");
  assertStringIncludes(redispatchSection, "não escala");
});

Deno.test("nenhum agente em opencode/agent/ fixa model: no frontmatter — issue #395", async () => {
  const agentFiles = [
    "issue-coordinator.md",
    "issue-worker.md",
    "code-review.md",
  ];

  for (const file of agentFiles) {
    const document = await Deno.readTextFile(
      new URL(`../agent/${file}`, import.meta.url),
    );
    const frontmatter = extractFrontmatter(document);
    assertNotMatch(
      frontmatter,
      /^model:\s*\S+/m,
      `${file} fixa model: no frontmatter YAML; modelos devem vir de config.json ou inherit`,
    );
  }
});
