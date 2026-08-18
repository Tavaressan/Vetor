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

Deno.test("worktree-audit lista worktree linkado com uncommitted=yes e exclui o root", async () => {
  const repo = await Deno.makeTempDir();
  const linked = `${repo}/linked`;

  try {
    await git(["init", "-q", "-b", "main"], repo);
    await git(["config", "user.email", "test@example.com"], repo);
    await git(["config", "user.name", "Test"], repo);
    await git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
    await git(["worktree", "add", "-q", "-b", "feat/x", linked], repo);
    await Deno.writeTextFile(`${linked}/dirty.txt`, "conteúdo não commitado\n");

    const output = await new Deno.Command("bash", {
      args: [SCRIPT, "worktree-audit"],
      cwd: repo,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout);

    assertEquals(output.code, 0);
    assertStringIncludes(stdout, `${linked}|feat/x|`);
    assertStringIncludes(stdout, "|yes");
    // O root (repo) não deve aparecer na listagem.
    const rootLine = stdout.split("\n").find((l) => l.startsWith(`${repo}|`));
    assertEquals(rootLine, undefined);
  } finally {
    await git(["worktree", "remove", "-f", linked], repo);
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("find-orphan-status detecta status file sem worktree correspondente", async () => {
  const repo = await Deno.makeTempDir();
  const statusDir = `${repo}/.claude/vetor/status`;

  try {
    await git(["init", "-q", "-b", "main"], repo);
    await git(["config", "user.email", "test@example.com"], repo);
    await git(["config", "user.name", "Test"], repo);
    await git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
    await Deno.mkdir(statusDir, { recursive: true });
    const orphanPath = `${statusDir}/feat-orfao.md`;
    await Deno.writeTextFile(orphanPath, "# Agent Status\nStatus: GREEN\n");

    const output = await new Deno.Command("bash", {
      args: [SCRIPT, "find-orphan-status", statusDir],
      cwd: repo,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout);

    assertEquals(output.code, 0);
    assertStringIncludes(stdout, orphanPath);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("find-orphan-status não lista status file com worktree ativo", async () => {
  const repo = await Deno.makeTempDir();
  const linked = `${repo}/linked`;
  const statusDir = `${repo}/.claude/vetor/status`;

  try {
    await git(["init", "-q", "-b", "main"], repo);
    await git(["config", "user.email", "test@example.com"], repo);
    await git(["config", "user.name", "Test"], repo);
    await git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
    await git(["worktree", "add", "-q", "-b", "feat/ativa", linked], repo);
    await Deno.mkdir(statusDir, { recursive: true });
    await Deno.writeTextFile(`${statusDir}/feat-ativa.md`, "# Agent Status\nStatus: RUNNING\n");

    const output = await new Deno.Command("bash", {
      args: [SCRIPT, "find-orphan-status", statusDir],
      cwd: repo,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout);

    assertEquals(output.code, 0);
    assertEquals(stdout, "");
  } finally {
    await git(["worktree", "remove", "-f", linked], repo);
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("archive-orphan-status move o status file para o diretório archive/", async () => {
  const repo = await Deno.makeTempDir();
  const statusDir = `${repo}/.claude/vetor/status`;
  const target = `${statusDir}/feat-orfao.md`;

  try {
    await Deno.mkdir(statusDir, { recursive: true });
    await Deno.writeTextFile(target, "# Agent Status\nStatus: GREEN\n");

    const output = await new Deno.Command("bash", {
      args: [SCRIPT, "archive-orphan-status", target],
      cwd: repo,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout);

    assertEquals(output.code, 0);
    assertStringIncludes(stdout, "Arquivado");
    await Deno.stat(`${statusDir}/archive/feat-orfao.md`);
    let missing = false;
    try {
      await Deno.stat(target);
    } catch {
      missing = true;
    }
    assertEquals(missing, true);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});
