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
  assertEquals(isTerminal("PR_STAGED"), true);
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

async function git(args: string[], cwd: string): Promise<void> {
  const out = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" })
    .output();
  if (!out.success) {
    throw new Error(`git ${args.join(" ")} falhou: ${new TextDecoder().decode(out.stderr)}`);
  }
}

async function initRepo(branch: string): Promise<string> {
  // realPath: no macOS o temp dir fica sob um symlink, e o git resolve o path real.
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await git(["init", "-q", "-b", branch], dir);
  await git(["config", "user.email", "t@e.com"], dir);
  await git(["config", "user.name", "t"], dir);
  await git(["commit", "-q", "--allow-empty", "-m", "init"], dir);
  return dir;
}

/** O git devolve `/`; no Windows o Deno devolve `\` — compara os dois no mesmo formato. */
const slashes = (path: string | undefined) => path?.replaceAll("\\", "/");

Deno.test("resolveWorktree: subdiretório do checkout principal não é worktree linkado (issue #490)", async () => {
  const dir = await initRepo("feat-x");
  try {
    await Deno.mkdir(`${dir}/sub/deep`, { recursive: true });

    // Num subdiretório, `git rev-parse --git-dir` volta absoluto e `--git-common-dir` relativo
    // (`../.git`): comparados como string, o checkout principal parecia um worktree linkado.
    for (const cwd of [dir, `${dir}/sub`, `${dir}/sub/deep`]) {
      const wt = await resolveWorktree(cwd);

      assertEquals(wt?.isLinked, false, cwd);
      assertEquals(wt?.branch, "feat-x");
      assertEquals(slashes(wt?.root), slashes(dir));
      assertEquals(slashes(wt?.toplevel), slashes(dir));
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("resolveWorktree: worktree linkado continua detectado, inclusive a partir de um subdiretório (issue #490)", async () => {
  const dir = await initRepo("main");
  try {
    const worktreePath = `${dir}/wt-feat`;
    await git(["worktree", "add", "-q", "-b", "feat-y", worktreePath], dir);
    await Deno.mkdir(`${worktreePath}/sub/deep`, { recursive: true });

    for (const cwd of [worktreePath, `${worktreePath}/sub`, `${worktreePath}/sub/deep`]) {
      const wt = await resolveWorktree(cwd);

      assertEquals(wt?.isLinked, true, cwd);
      assertEquals(wt?.branch, "feat-y");
      assertEquals(slashes(wt?.root), slashes(dir));
      assertEquals(slashes(wt?.toplevel), slashes(worktreePath));
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
