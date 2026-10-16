import { assert, assertStringIncludes } from "@std/assert";

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
  assertStringIncludes(document, "não pergunte");
  assertStringIncludes(document, "nem redespache");
});
