import { assertEquals } from "@std/assert";
import { type CommandExecutor, probeNow } from "../now-probe.ts";

Deno.test("now probe tolera repo sem MCP e gh e é idempotente", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const init = new Deno.Command("git", { args: ["init", dir], stdout: "null", stderr: "null" });
    await init.output();
    const fail: CommandExecutor = () => Promise.reject(new Error("comando indisponível"));
    const snapshot = async () => {
      const entries = [];
      for await (const entry of Deno.readDir(dir)) entries.push(entry.name);
      return entries.sort();
    };
    const before = await snapshot();
    const first = await probeNow(dir, fail);
    const second = await probeNow(dir, fail);
    assertEquals(first, second);
    assertEquals(first.branch, null);
    assertEquals(first.clean, null);
    assertEquals(first.worktrees, []);
    assertEquals(first.initialized, false);
    assertEquals(first.defaultDispatchLabel, null);
    assertEquals(first.openIssuesTotal, null);
    assertEquals(first.backlogIssues, null);
    assertEquals(first.mcps, []);
    assertEquals(await snapshot(), before);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("now probe detecta inicialização, defaultDispatchLabel e contagens de issues", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const init = new Deno.Command("git", { args: ["init", dir], stdout: "null", stderr: "null" });
    await init.output();

    await Deno.mkdir(`${dir}/.claude/vetor`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/.claude/vetor/config.json`,
      JSON.stringify({ defaultDispatchLabel: "feature" }),
    );

    const mockExecutor: CommandExecutor = (_command, args) => {
      if (args.includes("--label") && args.includes("backlog")) {
        return Promise.resolve(JSON.stringify([{ number: 1 }, { number: 2 }]));
      }
      if (args.includes("issue") && args.includes("list")) {
        return Promise.resolve(
          JSON.stringify([{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }]),
        );
      }
      return Promise.reject(new Error("mock fallback"));
    };

    const probed = await probeNow(dir, mockExecutor);
    assertEquals(probed.initialized, true);
    assertEquals(probed.defaultDispatchLabel, "feature");
    assertEquals(probed.openIssuesTotal, 4);
    assertEquals(probed.backlogIssues, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
