// Teste de integração do hook safety-check.ts: sobe repositórios git reais em diretórios
// temporários e invoca o script como subprocesso (mesma via do PreToolUse real), verificando
// o exit code — 0 libera, 2 bloqueia (contrato descrito no topo de safety-check.ts).

import { assertEquals, assertMatch } from "@std/assert";

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

/** Prepara um repositório git real com um commit inicial, pronto para `git worktree add`. */
async function makeRepo(): Promise<string> {
  const dir = await Deno.makeTempDir();
  await git(["init", "-q", "-b", "main"], dir);
  await git(["config", "user.email", "test@vetor.local"], dir);
  await git(["config", "user.name", "Vetor Test"], dir);
  await Deno.writeTextFile(`${dir}/README.md`, "repo de teste\n");
  await git(["add", "README.md"], dir);
  await git(["commit", "-q", "-m", "inicial"], dir);
  return dir;
}

Deno.test("safety-check.ts (integração): worktree válido dentro de .claude/worktrees passa", async () => {
  const repo = await makeRepo();
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
  const repo = await makeRepo();
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
  const repo = await makeRepo();
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

Deno.test("safety-check.ts (integração): sem regressão — raiz do repositório principal continua liberada", async () => {
  const repo = await makeRepo();

  const result = await runHook({
    tool_name: "Bash",
    tool_input: { command: "echo hi" },
    cwd: repo,
  });

  assertEquals(result.code, 0, result.stderr);
  await Deno.remove(repo, { recursive: true });
});
