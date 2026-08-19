import { assertEquals, assertStringIncludes } from "@std/assert";

const SCRIPT = new URL("../vetor-checks.sh", import.meta.url).pathname;

async function runVetorChecks(
  cwd: string,
  ...args: string[]
): Promise<{ code: number; stderr: string }> {
  const cmd = new Deno.Command("bash", {
    args: [SCRIPT, ...args],
    cwd,
    stderr: "piped",
    stdout: "piped",
  });

  const { success, stderr } = await cmd.output();
  const stderrText = new TextDecoder().decode(stderr);

  return { code: success ? 0 : 1, stderr: stderrText };
}

async function git(args: string[], cwd: string): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(`git ${args.join(" ")} falhou: ${new TextDecoder().decode(output.stderr)}`);
  }
  return new TextDecoder().decode(output.stdout).trim();
}

async function makeRepo(): Promise<string> {
  const repo = await Deno.realPath(await Deno.makeTempDir());
  await git(["init", "-q", "-b", "main"], repo);
  await git(["config", "user.email", "test@example.com"], repo);
  await git(["config", "user.name", "Test"], repo);
  return repo;
}

Deno.test("safe-remove-worktree bloqueia remover pai que contém worktree filho", async () => {
  const repo = await makeRepo();
  const parent = `${repo}/parent`;
  const child = `${parent}/child`;

  try {
    await git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
    await git(["worktree", "add", "-q", "-b", "parent", parent], repo);
    await git(["worktree", "add", "-q", "-b", "child", child], repo);

    const result = await runVetorChecks(repo, "safe-remove-worktree", parent);

    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "cleanup bloqueado");
    assertStringIncludes(result.stderr, child);
    await Deno.stat(parent);
    await Deno.stat(child);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("validate-issue-ref rejeita valores não-numéricos", async () => {
  const result = await runVetorChecks(Deno.cwd(), "validate-issue-ref", "016-bdd");
  assertEquals(result.code, 1);
  assertEquals(result.stderr.includes("deve ser um inteiro positivo"), true);
  assertEquals(result.stderr.includes("016-bdd"), true);
});

Deno.test("validate-issue-ref aceita inteiros positivos", async () => {
  const result = await runVetorChecks(Deno.cwd(), "validate-issue-ref", "42");
  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
});

Deno.test("validate-issue-ref aceita inteiros grandes", async () => {
  const result = await runVetorChecks(Deno.cwd(), "validate-issue-ref", "999999");
  assertEquals(result.code, 0);
});

Deno.test("validate-issue-ref rejeita zero", async () => {
  const result = await runVetorChecks(Deno.cwd(), "validate-issue-ref", "0");
  assertEquals(result.code, 1);
});

Deno.test("validate-issue-ref rejeita inteiros negativos", async () => {
  const result = await runVetorChecks(Deno.cwd(), "validate-issue-ref", "-42");
  assertEquals(result.code, 1);
});

Deno.test("validate-issue-ref rejeita valores vazios", async () => {
  const cmd = new Deno.Command("bash", {
    args: [SCRIPT, "validate-issue-ref"],
    cwd: Deno.cwd(),
    stderr: "piped",
    stdout: "piped",
  });

  const { success, stderr } = await cmd.output();
  const stderrText = new TextDecoder().decode(stderr);

  assertEquals(success, false);
  assertEquals(stderrText.includes("uso:"), true);
});

Deno.test("debug-scan ignora padrão existente fora do diff — issue #93", async () => {
  const repo = await makeRepo();
  try {
    await Deno.writeTextFile(`${repo}/app.ts`, 'console.log("existing");\n');
    await git(["add", "app.ts"], repo);
    await git(["commit", "-q", "-m", "initial"], repo);
    await Deno.writeTextFile(
      `${repo}/app.ts`,
      'console.log("existing");\nexport const value = 1;\n',
    );

    const result = await runVetorChecks(repo, "debug-scan", "main");
    assertEquals(result.code, 0, result.stderr);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("debug-scan detecta padrão adicionado no diff — issue #93", async () => {
  const repo = await makeRepo();
  try {
    await Deno.writeTextFile(`${repo}/app.ts`, "export const value = 1;\n");
    await git(["add", "app.ts"], repo);
    await git(["commit", "-q", "-m", "initial"], repo);
    await Deno.writeTextFile(`${repo}/app.ts`, 'export const value = 1;\nconsole.log("debug");\n');

    const result = await runVetorChecks(repo, "debug-scan", "main");
    assertEquals(result.code, 1);
    assertEquals(result.stderr.includes('console.log("debug")'), true);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("debug-scan usa origin quando a branch local está desatualizada — issue #70", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir());
  const source = `${root}/source`;
  const remote = `${root}/remote.git`;
  const worker = `${root}/worker`;
  try {
    await Deno.mkdir(source);
    await git(["init", "-q", "-b", "main"], source);
    await git(["config", "user.email", "test@example.com"], source);
    await git(["config", "user.name", "Test"], source);
    await Deno.writeTextFile(`${source}/app.ts`, "export const value = 1;\n");
    await git(["add", "app.ts"], source);
    await git(["commit", "-q", "-m", "initial"], source);
    await git(["init", "-q", "--bare", remote], source);
    await git(["remote", "add", "origin", remote], source);
    await git(["push", "-q", "-u", "origin", "main"], source);
    await git(["clone", "-q", remote, worker], root);
    await git(["config", "user.email", "test@example.com"], worker);
    await git(["config", "user.name", "Test"], worker);

    await Deno.writeTextFile(
      `${source}/app.ts`,
      'export const value = 1;\nconsole.log("shared");\n',
    );
    await git(["add", "app.ts"], source);
    await git(["commit", "-q", "-m", "remote debug line"], source);
    await git(["push", "-q"], source);
    await git(["fetch", "-q", "origin", "main"], worker);
    await Deno.writeTextFile(
      `${worker}/app.ts`,
      'export const value = 1;\nconsole.log("shared");\nexport const feature = true;\n',
    );

    // SKILL.md passes origin/$DEFAULT_BRANCH, so test must use origin/main
    const result = await runVetorChecks(worker, "debug-scan", "origin/main");
    assertEquals(result.code, 0, result.stderr);
  } finally {
    await Deno.remove(root, { recursive: true });
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
