import { assertEquals, assertStringIncludes } from "@std/assert";

const SCRIPT = new URL("./vetor-checks.sh", import.meta.url).pathname;

async function git(args: string[], cwd: string): Promise<{ code: number; stderr: string }> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code: output.code, stderr: new TextDecoder().decode(output.stderr) };
}

Deno.test("safe-remove-worktree bloqueia remover pai que contém worktree filho", async () => {
  const repo = await Deno.makeTempDir();
  const parent = `${repo}/parent`;
  const child = `${parent}/child`;

  try {
    await git(["init", "-q", "-b", "main"], repo);
    await git(["config", "user.email", "test@example.com"], repo);
    await git(["config", "user.name", "Test"], repo);
    await git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
    await git(["worktree", "add", "-q", "-b", "parent", parent], repo);
    await git(["worktree", "add", "-q", "-b", "child", child], repo);

    const output = await new Deno.Command("bash", {
      args: [SCRIPT, "safe-remove-worktree", parent],
      cwd: repo,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stderr = new TextDecoder().decode(output.stderr);

    assertEquals(output.code, 1);
    assertStringIncludes(stderr, "cleanup bloqueado");
    assertStringIncludes(stderr, child);
    await Deno.stat(parent);
    await Deno.stat(child);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});
