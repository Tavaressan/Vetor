import { assertEquals, assertStringIncludes } from "@std/assert";

const SCRIPT = new URL("./safety-check.ts", import.meta.url).pathname;

async function git(args: string[], cwd: string): Promise<void> {
  const { code, stderr } = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  })
    .output();
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} falhou: ${new TextDecoder().decode(stderr)}`);
  }
}

async function makeRepo(branch: string): Promise<string> {
  // realPath: no macOS, Deno.makeTempDir() devolve um path sob /var, que é symlink para
  // /private/var — `git rev-parse --show-toplevel` resolve para o path real, então sem isso
  // a comparação de path do guard não bateria.
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await git(["init", "-q", "-b", branch], dir);
  await git(["config", "user.email", "test@example.com"], dir);
  await git(["config", "user.name", "Test"], dir);
  await git(["commit", "-q", "--allow-empty", "-m", "init"], dir);
  return dir;
}

async function makeLinkedWorktree(
  branch: string,
): Promise<{ root: string; worktreePath: string }> {
  const root = await makeRepo("main");
  const worktreePath = `${root}/.claude/worktrees/${branch.replaceAll("/", "-")}`;
  await git(["worktree", "add", "-b", branch, worktreePath], root);
  return { root, worktreePath };
}

async function runHook(input: unknown): Promise<{ code: number; stderr: string }> {
  const command = new Deno.Command("deno", {
    args: ["run", "-A", SCRIPT],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(input)));
  await writer.close();
  const out = await child.output();
  return { code: out.code, stderr: new TextDecoder().decode(out.stderr) };
}

Deno.test("issue-worker escrevendo fora de um worktree linkado (cwd = raiz) é bloqueado — issue #57", async () => {
  const root = await makeRepo("main");
  try {
    const { code, stderr } = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${root}/README.md` },
      cwd: root,
      agent_type: "vetor:issue-worker",
    });

    assertEquals(code, 2);
    assertStringIncludes(stderr, "fora de um worktree linkado");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("sessão normal (sem agent_type) escrevendo na raiz não é afetada", async () => {
  const root = await makeRepo("main");
  try {
    const { code } = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${root}/README.md` },
      cwd: root,
    });

    assertEquals(code, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("issue-worker escrevendo dentro do seu próprio worktree continua permitido", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("feat-x");
  try {
    const { code } = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${worktreePath}/README.md` },
      cwd: worktreePath,
      agent_type: "vetor:issue-worker",
    });

    assertEquals(code, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("issue-worker escrevendo fora do próprio worktree (outro diretório) continua bloqueado", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("feat-x");
  try {
    const { code, stderr } = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${root}/README.md` },
      cwd: worktreePath,
      agent_type: "vetor:issue-worker",
    });

    assertEquals(code, 2);
    assertStringIncludes(stderr, "escrita fora do worktree bloqueada");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
