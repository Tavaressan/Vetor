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
    assertEquals(first.backlogIssues, null);
    assertEquals(first.mcps, []);
    assertEquals(await snapshot(), before);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
