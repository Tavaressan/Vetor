import { assertEquals, assertStringIncludes } from "@std/assert";

const SCRIPT = new URL("./vetor-status.sh", import.meta.url).pathname;

async function run(
  cmd: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const out = await new Deno.Command(cmd, { args, cwd, env, stdout: "piped", stderr: "piped" }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

async function createMockGh(mockPrData: string): Promise<string> {
  const tmpDir = await Deno.makeTempDir();
  const ghPath = `${tmpDir}/gh`;
  const scriptContent = `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  printf '%b\n' "${mockPrData}"
  exit 0
fi
exit 1
`;
  await Deno.writeTextFile(ghPath, scriptContent);
  await Deno.chmod(ghPath, 0o755);
  return tmpDir;
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

Deno.test("vetor-status.sh anota status GREEN com PR aberta ou mergeada via gh pr list", async () => {
  const root = await makeRepo("main");
  const mockBinDir = await createMockGh("fix-open=42=OPEN\nfix-merged=99=MERGED");
  const pathEnv = `${mockBinDir}:${Deno.env.get("PATH") || ""}`;
  try {
    const wtOpen = `${root}/.claude/worktrees/fix-open`;
    const wtMerged = `${root}/.claude/worktrees/fix-merged`;
    const wtNone = `${root}/.claude/worktrees/fix-none`;
    await run("git", ["worktree", "add", "-b", "fix-open", wtOpen], root);
    await run("git", ["worktree", "add", "-b", "fix-merged", wtMerged], root);
    await run("git", ["worktree", "add", "-b", "fix-none", wtNone], root);

    await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/.claude/vetor/status/fix-open.md`,
      "Status: GREEN\nIteration: 1/5 (Issue #42)\n",
    );
    await Deno.writeTextFile(
      `${root}/.claude/vetor/status/fix-merged.md`,
      "Status: GREEN\nIteration: 1/5 (Issue #99)\n",
    );
    await Deno.writeTextFile(
      `${root}/.claude/vetor/status/fix-none.md`,
      "Status: GREEN\nIteration: 1/5 (Issue #100)\n",
    );

    const { stdout } = await run("bash", [SCRIPT], root, { PATH: pathEnv });

    assertStringIncludes(stdout, "GREEN (PR #42 aberta)");
    assertStringIncludes(stdout, "GREEN (já mergeado via #99)");
    assertStringIncludes(stdout, "| fix-none | GREEN |");
  } finally {
    await Deno.remove(mockBinDir, { recursive: true });
    await Deno.remove(root, { recursive: true });
  }
});
