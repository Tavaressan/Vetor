import { assertEquals } from "@std/assert";
import { detectGraphify, parseGraphReport, saveGraphSummary } from "../graph-report.ts";

Deno.test("parseGraphReport extracts bounded god nodes and communities", async () => {
  const markdown = await Deno.readTextFile(new URL("./fixtures/graph-report.md", import.meta.url));
  assertEquals(parseGraphReport(markdown, { maxItems: 1 }), {
    godNodes: ["`Router` - 12 edges"],
    communities: ['Community 0 - "HTTP Layer"'],
  });
});

Deno.test("detectGraphify reports installed status from the injected executor", async () => {
  const installed = await detectGraphify((command, args) =>
    Promise.resolve(command === "graphify" && args[0] === "--help")
  );
  const missing = await detectGraphify(() => Promise.resolve(false));
  assertEquals(installed, true);
  assertEquals(missing, false);
});

Deno.test("saveGraphSummary skips KnowledgeProvider writes when knowledge is disabled", async () => {
  const root = await Deno.makeTempDir();
  try {
    const result = await saveGraphSummary("## God Nodes\n1. `Router` - 12 edges\n", "fixture.md", {
      root,
      knowledgeEnabled: false,
    });
    assertEquals(result.knowledgePath, undefined);
    assertEquals(result.summary.godNodes, ["`Router` - 12 edges"]);
    const entries = [];
    for await (const entry of Deno.readDir(root)) entries.push(entry);
    assertEquals(entries, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
