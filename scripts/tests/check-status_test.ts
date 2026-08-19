import { assertEquals, assertStringIncludes } from "@std/assert";

const SCRIPT = new URL("../check-status.ts", import.meta.url).pathname;

async function run(cmd: string, args: string[], cwd: string): Promise<void> {
  const { code, stderr } = await new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  })
    .output();
  if (code !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} falhou: ${new TextDecoder().decode(stderr)}`);
  }
}

async function makeRepo(branch: string): Promise<string> {
  const dir = await Deno.makeTempDir();
  await run("git", ["init", "-q", "-b", branch], dir);
  await run("git", ["config", "user.email", "test@example.com"], dir);
  await run("git", ["config", "user.name", "Test"], dir);
  await run("git", ["commit", "-q", "--allow-empty", "-m", "init"], dir);
  return dir;
}

/** Repo raiz + um worktree linkado de fato, para simular o cenário real do hook. */
async function makeLinkedWorktree(
  branch: string,
): Promise<{ root: string; worktreePath: string }> {
  const root = await makeRepo("main");
  const worktreePath = `${root}/.claude/worktrees/${branch.replaceAll("/", "-")}`;
  await run("git", ["worktree", "add", "-b", branch, worktreePath], root);
  return { root, worktreePath };
}

async function runHook(
  cwd: string,
  agentId = "agent-1",
): Promise<{ code: number; stdout: string; stderr: string }> {
  const command = new Deno.Command("deno", {
    args: ["run", "-A", SCRIPT],
    cwd,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify({ cwd, agent_id: agentId })));
  await writer.close();
  const out = await child.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

Deno.test("check-status reporta o marcador de prepare-failed ao bloquear", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("test-branch");
  try {
    await Deno.mkdir(`${worktreePath}/.claude/vetor`, { recursive: true });
    await Deno.writeTextFile(
      `${worktreePath}/.claude/vetor/prepare-failed`,
      "npm install falhou no worktree: boom\n",
    );

    const { stdout } = await runHook(worktreePath);

    assertStringIncludes(stdout, "decision");
    assertStringIncludes(stdout, "preparação de dependências deste worktree falhou");
    assertStringIncludes(stdout, "npm install falhou no worktree: boom");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("check-status avisa em stderr sobre prepare-failed mesmo quando status é terminal", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("test-branch");
  try {
    await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
    await Deno.writeTextFile(`${root}/.claude/vetor/status/test-branch.md`, "Status: GREEN\n");
    await Deno.mkdir(`${worktreePath}/.claude/vetor`, { recursive: true });
    await Deno.writeTextFile(
      `${worktreePath}/.claude/vetor/prepare-failed`,
      "npm install falhou no worktree: boom\n",
    );

    const { stdout, stderr } = await runHook(worktreePath);

    assertStringIncludes(stdout, "");
    assertStringIncludes(stderr, "preparação de dependências falhou neste worktree");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("check-status ignora cwd fora de um worktree linkado (raiz do projeto) — issue #57", async () => {
  const root = await makeRepo("chore/vetor-init");
  try {
    const { code, stdout, stderr } = await runHook(root);

    assertEquals(code, 0);
    assertEquals(stdout.trim(), "");
    assertStringIncludes(stderr, "cwd fora de um worktree linkado");

    let stopguardExists = true;
    try {
      await Deno.stat(`${root}/.claude/vetor/status/chore-vetor-init.md.stopguard`);
    } catch {
      stopguardExists = false;
    }
    assertEquals(stopguardExists, false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("check-status grava agent_id e cwd bruto no stopguard, e não bloqueia duas vezes o mesmo agente", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("feat-x");
  try {
    const first = await runHook(worktreePath, "agent-42");
    assertStringIncludes(first.stdout, "decision");

    const sentinelPath = `${root}/.claude/vetor/status/feat-x.md.stopguard`;
    const sentinel = await Deno.readTextFile(sentinelPath);
    assertStringIncludes(sentinel, "agent-42");
    assertStringIncludes(sentinel, worktreePath);

    // Segunda tentativa do mesmo agente: já foi bloqueado uma vez, deixa encerrar.
    const second = await runHook(worktreePath, "agent-42");
    assertEquals(second.code, 0);
    assertEquals(second.stdout.trim(), "");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("check-status bloqueia worker com Status: RUNNING (não terminal) — issue #72", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("fix-bug");
  try {
    await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/.claude/vetor/status/fix-bug.md`,
      "Status: RUNNING\nIteration: 1/5 (Issue #72)\n",
    );

    const { stdout } = await runHook(worktreePath);

    assertStringIncludes(stdout, "decision");
    assertStringIncludes(stdout, "Status: RUNNING");
    assertStringIncludes(stdout, "não está em estado terminal");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("check-status permite worker com Status: GREEN (terminal) — issue #72", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("fix-ok");
  try {
    await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/.claude/vetor/status/fix-ok.md`,
      "Status: GREEN\nIteration: 3/5 (Issue #99)\n",
    );

    const { code, stdout } = await runHook(worktreePath);

    assertEquals(code, 0);
    assertEquals(stdout.trim(), "");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
