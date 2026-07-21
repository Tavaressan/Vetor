import { assertEquals, assertStringIncludes } from "@std/assert";

const SCRIPT = new URL("./vetor-status.sh", import.meta.url).pathname;

async function run(cmd: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const out = await new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "piped" }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

async function makeRepo(branch: string): Promise<string> {
  const dir = await Deno.makeTempDir();
  await run("git", ["init", "-q", "-b", branch], dir);
  await run("git", ["config", "user.email", "test@example.com"], dir);
  await run("git", ["config", "user.name", "Test"], dir);
  await run("git", ["commit", "-q", "--allow-empty", "-m", "init"], dir);
  return dir;
}

async function makeLinkedWorktree(
  branch: string,
): Promise<{ root: string; worktreePath: string }> {
  const root = await makeRepo("main");
  const worktreePath = `${root}/.claude/worktrees/${branch.replaceAll("/", "-")}`;
  await run("git", ["worktree", "add", "-b", branch, worktreePath], root);
  return { root, worktreePath };
}

Deno.test("vetor-status.sh detecta worktree sem status file (falha anômala — issue #72)", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("fix-orphan");
  try {
    // Nenhum status file criado — worktree existe mas sem rastro
    const { stdout } = await run("bash", [SCRIPT], root);

    assertStringIncludes(stdout, "ALERTA");
    assertStringIncludes(stdout, "sem status file");
    assertStringIncludes(stdout, "fix-orphan");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("vetor-status.sh não alerta quando todos os worktrees têm status file", async () => {
  const { root } = await makeLinkedWorktree("fix-tracked");
  try {
    await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/.claude/vetor/status/fix-tracked.md`,
      "Status: GREEN\nIteration: 1/5 (Issue #10)\n",
    );

    const { stdout } = await run("bash", [SCRIPT], root);

    assertStringIncludes(stdout, "fix-tracked");
    assertStringIncludes(stdout, "GREEN");
    assertEquals(stdout.includes("ALERTA"), false);
    assertEquals(stdout.includes("sem status file"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("vetor-status.sh lista worktree com status file e worktree sem status — issue #72", async () => {
  const root = await makeRepo("main");
  try {
    // Dois worktrees: um com status, um sem
    const wtTracked = `${root}/.claude/worktrees/fix-tracked`;
    const wtOrphan = `${root}/.claude/worktrees/fix-orphan`;
    await run("git", ["worktree", "add", "-b", "fix-tracked", wtTracked], root);
    await run("git", ["worktree", "add", "-b", "fix-orphan", wtOrphan], root);

    await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/.claude/vetor/status/fix-tracked.md`,
      "Status: GREEN\nIteration: 1/5 (Issue #10)\n",
    );
    // fix-orphan sem nenhum status file

    const { stdout } = await run("bash", [SCRIPT], root);

    // Ambos devem aparecer
    assertStringIncludes(stdout, "fix-tracked");
    assertStringIncludes(stdout, "fix-orphan");
    // O alerta deve ser para o orphan
    assertStringIncludes(stdout, "ALERTA");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
