// Teste de integração do hook safety-check.ts: sobe repositórios git reais em diretórios
// temporários e invoca o script como subprocesso (mesma via do PreToolUse real), verificando
// o exit code — 0 libera, 2 bloqueia (contrato descrito no topo de safety-check.ts).

import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";

const SCRIPT = new URL("./safety-check.ts", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

async function git(args: string[], cwd: string): Promise<string> {
  const out = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" })
    .output();
  if (!out.success) {
    throw new Error(`git ${args.join(" ")} falhou: ${new TextDecoder().decode(out.stderr)}`);
  }
  return new TextDecoder().decode(out.stdout).trim();
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

async function runHook(
  input: Record<string, unknown>,
): Promise<{ code: number; stderr: string }> {
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

Deno.test("safety-check.ts (integração): worktree válido dentro de .claude/worktrees passa", async () => {
  const repo = await makeRepo("main");
  const wt = `${repo}/.claude/worktrees/valid-wt`;
  await git(["worktree", "add", "-q", "-b", "valid-branch", wt], repo);

  const result = await runHook({
    tool_name: "Bash",
    tool_input: { command: "echo hi" },
    cwd: wt,
  });

  assertEquals(result.code, 0, result.stderr);
  await Deno.remove(repo, { recursive: true });
});

Deno.test("safety-check.ts (integração): worktree fora de .claude/worktrees é bloqueado", async () => {
  const repo = await makeRepo("main");
  const outside = `${repo}-outside-wt`;
  await git(["worktree", "add", "-q", "-b", "outside-branch", outside], repo);

  const result = await runHook({
    tool_name: "Bash",
    tool_input: { command: "echo hi" },
    cwd: outside,
  });

  assertEquals(result.code, 2);
  assertMatch(result.stderr, /worktree fora de/i);

  await Deno.remove(repo, { recursive: true });
  await Deno.remove(outside, { recursive: true });
});

Deno.test("safety-check.ts (integração): worktree movido no disco sem atualizar o registro (stale) é bloqueado", async () => {
  const repo = await makeRepo("main");
  const original = `${repo}/.claude/worktrees/stale-wt`;
  const moved = `${repo}/.claude/worktrees/stale-wt-moved`;
  await git(["worktree", "add", "-q", "-b", "stale-branch", original], repo);

  // Move só no filesystem — git worktree list continua apontando para o path antigo.
  await Deno.rename(original, moved);

  const result = await runHook({
    tool_name: "Bash",
    tool_input: { command: "echo hi" },
    cwd: moved,
  });

  assertEquals(result.code, 2);
  assertMatch(result.stderr, /stale/i);

  await Deno.remove(repo, { recursive: true });
});

Deno.test("cwd contaminado: mesmo agent_id, worktree diferente na segunda chamada é bloqueado — issue #63", async () => {
  const { root, worktreePath: worktreeA } = await makeLinkedWorktree("worker-a");
  const worktreeB = `${root}/.claude/worktrees/worker-b`;
  await git(["worktree", "add", "-q", "-b", "worker-b", worktreeB], root);
  try {
    const first = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${worktreeA}/README.md` },
      cwd: worktreeA,
      agent_type: "vetor:issue-worker",
      agent_id: "agent-123",
    });
    assertEquals(first.code, 0, first.stderr);

    // Mesmo agent_id da primeira chamada, mas agora o cwd resolve para o worktree de
    // OUTRO worker — reprodução do cenário real relatado na issue #63.
    const second = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${worktreeB}/README.md` },
      cwd: worktreeB,
      agent_type: "vetor:issue-worker",
      agent_id: "agent-123",
    });

    assertEquals(second.code, 2);
    assertStringIncludes(second.stderr, "cwd contaminado");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cwd contaminado: mesmo agent_id e mesmo worktree em chamadas repetidas continua liberado", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("worker-a");
  try {
    for (let i = 0; i < 3; i++) {
      const { code, stderr } = await runHook({
        tool_name: "Edit",
        tool_input: { file_path: `${worktreePath}/README.md` },
        cwd: worktreePath,
        agent_type: "vetor:issue-worker",
        agent_id: "agent-stable",
      });
      assertEquals(code, 0, stderr);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cwd contaminado: sem agent_id no payload, a checagem de binding não se aplica (sem regressão)", async () => {
  const { root, worktreePath: worktreeA } = await makeLinkedWorktree("worker-a");
  const worktreeB = `${root}/.claude/worktrees/worker-b`;
  await git(["worktree", "add", "-q", "-b", "worker-b", worktreeB], root);
  try {
    await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${worktreeA}/README.md` },
      cwd: worktreeA,
      agent_type: "vetor:issue-worker",
    });

    const { code } = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${worktreeB}/README.md` },
      cwd: worktreeB,
      agent_type: "vetor:issue-worker",
    });

    assertEquals(code, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("safety-check.ts (integração): sem regressão — raiz do repositório principal continua liberada", async () => {
  const repo = await makeRepo("main");

  const result = await runHook({
    tool_name: "Bash",
    tool_input: { command: "echo hi" },
    cwd: repo,
  });

  assertEquals(result.code, 0, result.stderr);
  await Deno.remove(repo, { recursive: true });
});
