import { assertStringIncludes } from "@std/assert";

const SCRIPT = new URL("./check-status.ts", import.meta.url).pathname;

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

async function makeRepo(): Promise<string> {
  const dir = await Deno.makeTempDir();
  await run("git", ["init", "-q", "-b", "test-branch"], dir);
  await run("git", ["config", "user.email", "test@example.com"], dir);
  await run("git", ["config", "user.name", "Test"], dir);
  await run("git", ["commit", "-q", "--allow-empty", "-m", "init"], dir);
  return dir;
}

async function runHook(
  cwd: string,
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
  await writer.write(new TextEncoder().encode(JSON.stringify({ cwd, agent_id: "agent-1" })));
  await writer.close();
  const out = await child.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

Deno.test("check-status reporta o marcador de prepare-failed ao bloquear", async () => {
  const dir = await makeRepo();
  try {
    await Deno.mkdir(`${dir}/.claude/vetor`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/.claude/vetor/prepare-failed`,
      "npm install falhou no worktree: boom\n",
    );

    const { stdout } = await runHook(dir);

    assertStringIncludes(stdout, "decision");
    assertStringIncludes(stdout, "preparação de dependências deste worktree falhou");
    assertStringIncludes(stdout, "npm install falhou no worktree: boom");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("check-status avisa em stderr sobre prepare-failed mesmo quando status é terminal", async () => {
  const dir = await makeRepo();
  try {
    await Deno.mkdir(`${dir}/.claude/vetor/status`, { recursive: true });
    await Deno.writeTextFile(`${dir}/.claude/vetor/status/test-branch.md`, "Status: GREEN\n");
    await Deno.mkdir(`${dir}/.claude/vetor`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/.claude/vetor/prepare-failed`,
      "npm install falhou no worktree: boom\n",
    );

    const { stdout, stderr } = await runHook(dir);

    assertStringIncludes(stdout, "");
    assertStringIncludes(stderr, "preparação de dependências falhou neste worktree");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
