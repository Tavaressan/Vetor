import { assertEquals } from "@std/assert";
import { isTerminal, prepareFailedMarkerPath, readStatus, statusFilePath } from "./status.ts";

Deno.test("branch com barra vira nome de arquivo plano", () => {
  assertEquals(
    statusFilePath("/repo", "feat/issue-42"),
    "/repo/.claude/vetor/status/feat-issue-42.md",
  );
});

Deno.test("estados terminais x RUNNING x ausente", () => {
  assertEquals(isTerminal("GREEN"), true);
  assertEquals(isTerminal("FAILED_MAX_ITERATIONS"), true);
  assertEquals(isTerminal("BLOCKED_WAITING"), true);
  assertEquals(isTerminal("RUNNING"), false);
  assertEquals(isTerminal(null), false);
});

Deno.test("prepareFailedMarkerPath aponta para dentro do worktree, não da raiz", () => {
  assertEquals(
    prepareFailedMarkerPath("/repo/.claude/worktrees/feat-x"),
    "/repo/.claude/worktrees/feat-x/.claude/vetor/prepare-failed",
  );
});

Deno.test("readStatus distingue arquivo ausente de arquivo sem Status", async (t) => {
  const dir = await Deno.makeTempDir();

  await t.step("ausente", () => {
    assertEquals(readStatus(`${dir}/nao-existe.md`), null);
  });

  await t.step("com Status", () => {
    const file = `${dir}/green.md`;
    Deno.writeTextFileSync(file, "# Worker\n\nStatus: GREEN\n");
    assertEquals(readStatus(file), "GREEN");
  });

  await t.step("sem linha de Status", () => {
    const file = `${dir}/vazio.md`;
    Deno.writeTextFileSync(file, "# Worker\n");
    assertEquals(readStatus(file), "");
  });

  await Deno.remove(dir, { recursive: true });
});
