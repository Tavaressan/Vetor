import { assert } from "@std/assert";

// Issue #533: o --prepare do ship exige gravar corpos (PR e Security Review) com a
// ferramenta Write; a allowlist do ship-worker precisa cobri-la.
const root = new URL("../../", import.meta.url);

async function workerTools(): Promise<string[]> {
  const text = await Deno.readTextFile(new URL("agents/ship-worker.md", root));
  const m = text.match(/^tools:\s*\[([^\]]*)\]/m);
  assert(m, "ship-worker sem tools no frontmatter");
  return m[1].split(",").map((s) => s.trim());
}

Deno.test("issue #533: ship exige Write e ship-worker inclui Write na allowlist", async () => {
  const ship = await Deno.readTextFile(new URL("skills/ship/SKILL.md", root));
  assert(/ferramenta Write/.test(ship), "ship deve documentar o uso da ferramenta Write");
  assert((await workerTools()).includes("Write"), "ship-worker precisa de Write na allowlist");
});

Deno.test("issue #533: allowlist do ship-worker não inclui Agent nem plan mode", async () => {
  const tools = await workerTools();
  for (const t of ["Agent", "EnterPlanMode", "ExitPlanMode"]) assert(!tools.includes(t), t);
});
