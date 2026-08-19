import { assertEquals } from "@std/assert";
import {
  isTerminal,
  prepareFailedMarkerPath,
  readStatus,
  resolveWorktree,
  statusFilePath,
} from "../lib/status.ts";

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

Deno.test("resolveWorktree resolve a raiz do repositório com isLinked:false (issue #57)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await new Deno.Command("git", { args: ["init", "-q", "-b", "chore/vetor-init"], cwd: dir })
      .output();
    await new Deno.Command("git", { args: ["config", "user.email", "t@e.com"], cwd: dir })
      .output();
    await new Deno.Command("git", { args: ["config", "user.name", "t"], cwd: dir }).output();
    await new Deno.Command("git", {
      args: ["commit", "-q", "--allow-empty", "-m", "init"],
      cwd: dir,
    }).output();

    const wt = await resolveWorktree(dir);

    // Confirma a causa raiz: a raiz do projeto resolve como WorktreeInfo válido, só que
    // com isLinked:false — não null. Chamadores que não checam isLinked tratam a raiz como
    // se fosse um worktree de worker.
    assertEquals(wt?.isLinked, false);
    assertEquals(wt?.branch, "chore/vetor-init");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
