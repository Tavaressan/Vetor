import { assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../vetor-status.sh", import.meta.url));

async function run(
  cmd: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const out = await new Deno.Command(cmd, { args, cwd, env, stdout: "piped", stderr: "piped" })
    .output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

/** `gh` falso; com `callLog`, cada invocação acrescenta uma linha ao arquivo. */
async function writeMockGh(tmpDir: string, mockPrData: string, callLog?: string): Promise<void> {
  const ghPath = `${tmpDir}/gh`;
  const record = callLog ? `echo "$@" >> "${callLog.replaceAll("\\", "/")}"\n` : "";
  const scriptContent = `#!/bin/sh
${record}if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  printf '%b\n' "${mockPrData}"
  exit 0
fi
exit 1
`;
  await Deno.writeTextFile(ghPath, scriptContent);
  await Deno.chmod(ghPath, 0o755);
}

async function createMockGh(mockPrData: string, callLog?: string): Promise<string> {
  const tmpDir = await Deno.makeTempDir();
  await writeMockGh(tmpDir, mockPrData, callLog);
  return tmpDir;
}

async function ghCalls(callLog: string): Promise<number> {
  try {
    return (await Deno.readTextFile(callLog)).split("\n").filter(Boolean).length;
  } catch {
    return 0;
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

async function makeLinkedWorktree(
  branch: string,
): Promise<{ root: string; worktreePath: string }> {
  const root = await makeRepo("main");
  const worktreePath = `${root}/.claude/worktrees/${branch.replaceAll("/", "-")}`;
  await run("git", ["worktree", "add", "-b", branch, worktreePath], root);
  return { root, worktreePath };
}

Deno.test("vetor-status.sh detecta worktree sem status file (falha anômala — issue #72)", async () => {
  const { root, worktreePath: _worktreePath } = await makeLinkedWorktree("fix-orphan");
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

Deno.test("vetor-status.sh destaca Iteration acima do orçamento de 5 — issue #156", async () => {
  const { root } = await makeLinkedWorktree("fix-overshot");
  try {
    await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/.claude/vetor/status/fix-overshot.md`,
      "Status: RUNNING\nIteration: 8/5 (Issue #10)\n",
    );

    const { stdout } = await run("bash", [SCRIPT], root);

    assertStringIncludes(stdout, "fix-overshot");
    assertStringIncludes(stdout, "⚠️ 8/5");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("vetor-status.sh não destaca Iteration dentro do orçamento de 5", async () => {
  const { root } = await makeLinkedWorktree("fix-ok");
  try {
    await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/.claude/vetor/status/fix-ok.md`,
      "Status: RUNNING\nIteration: 3/5 (Issue #10)\n",
    );

    const { stdout } = await run("bash", [SCRIPT], root);

    assertStringIncludes(stdout, "3/5");
    assertEquals(stdout.includes("⚠️ 3/5"), false);
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

Deno.test("vetor-status.sh anota status PR_STAGED com PR aberta via gh pr list (issue #493)", async () => {
  const root = await makeRepo("main");
  const mockBinDir = await createMockGh("fix-staged=123=OPEN");
  const pathEnv = `${mockBinDir}:${Deno.env.get("PATH") || ""}`;
  try {
    const wtStaged = `${root}/.claude/worktrees/fix-staged`;
    await run("git", ["worktree", "add", "-b", "fix-staged", wtStaged], root);

    await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/.claude/vetor/status/fix-staged.md`,
      "Status: PR_STAGED\nIteration: 1/5 (Issue #123)\n",
    );

    const { stdout } = await run("bash", [SCRIPT], root, { PATH: pathEnv });

    assertStringIncludes(stdout, "PR_STAGED (PR #123 aberta)");
  } finally {
    await Deno.remove(mockBinDir, { recursive: true });
    await Deno.remove(root, { recursive: true });
  }
});

// --- Issue #515: gh só quando algum worker terminou, e listagem de PRs em cache de 15 s ---

async function makeWorkerRepo(statuses: Record<string, string>): Promise<string> {
  const root = await makeRepo("main");
  await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
  for (const [branch, status] of Object.entries(statuses)) {
    await run(
      "git",
      ["worktree", "add", "-b", branch, `${root}/.claude/worktrees/${branch}`],
      root,
    );
    await Deno.writeTextFile(
      `${root}/.claude/vetor/status/${branch}.md`,
      `Status: ${status}\nIteration: 1/5 (Issue #1)\n`,
    );
  }
  return root;
}

Deno.test("vetor-status.sh não chama gh quando nenhum status file está GREEN ou PR_STAGED", async () => {
  const root = await makeWorkerRepo({ "fix-run": "RUNNING", "fix-blocked": "BLOCKED_WAITING" });
  const callLog = `${root}/gh-calls.log`;
  const mockBinDir = await createMockGh("fix-run=1=OPEN", callLog);
  const pathEnv = `${mockBinDir}:${Deno.env.get("PATH") || ""}`;
  try {
    const { stdout } = await run("bash", [SCRIPT], root, { PATH: pathEnv });

    assertStringIncludes(stdout, "| fix-run | RUNNING |");
    assertStringIncludes(stdout, "| fix-blocked | BLOCKED_WAITING |");
    assertEquals(await ghCalls(callLog), 0);
  } finally {
    await Deno.remove(mockBinDir, { recursive: true });
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("vetor-status.sh chama gh quando há status file GREEN ou PR_STAGED", async () => {
  for (const status of ["GREEN", "PR_STAGED"]) {
    const root = await makeWorkerRepo({ "fix-done": status });
    const callLog = `${root}/gh-calls.log`;
    const mockBinDir = await createMockGh("fix-done=7=OPEN", callLog);
    const pathEnv = `${mockBinDir}:${Deno.env.get("PATH") || ""}`;
    try {
      await run("bash", [SCRIPT], root, { PATH: pathEnv });
      assertEquals(await ghCalls(callLog), 1, status);
    } finally {
      await Deno.remove(mockBinDir, { recursive: true });
      await Deno.remove(root, { recursive: true });
    }
  }
});

Deno.test("vetor-status.sh lê o mtime do cache com stat BSD (-f %m) quando o -c não existe", async () => {
  const root = await makeWorkerRepo({ "fix-done": "GREEN" });
  const callLog = `${root}/gh-calls.log`;
  const mockBinDir = await createMockGh("fix-done=7=OPEN", callLog);
  // O stat do macOS rejeita -c e só entende -f %m; o falso delega ao stat GNU para obter o mtime.
  await Deno.writeTextFile(
    `${mockBinDir}/stat`,
    `#!/bin/sh
if [ "$1" = "-f" ] && [ "$2" = "%m" ]; then exec /usr/bin/stat -c %Y "$3"; fi
exit 1
`,
  );
  await Deno.chmod(`${mockBinDir}/stat`, 0o755);
  const pathEnv = `${mockBinDir}:${Deno.env.get("PATH") || ""}`;
  try {
    await run("bash", [SCRIPT], root, { PATH: pathEnv });
    const cached = await run("bash", [SCRIPT], root, { PATH: pathEnv });

    assertStringIncludes(cached.stdout, "GREEN (PR #7 aberta)");
    assertEquals(await ghCalls(callLog), 1);
  } finally {
    await Deno.remove(mockBinDir, { recursive: true });
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("vetor-status.sh reaproveita a listagem de PRs por 15 s, num cache que se auto-ignora", async () => {
  const root = await makeWorkerRepo({ "fix-done": "GREEN" });
  const callLog = `${root}/gh-calls.log`;
  const mockBinDir = await createMockGh("fix-done=7=OPEN", callLog);
  const pathEnv = `${mockBinDir}:${Deno.env.get("PATH") || ""}`;
  const cacheDir = `${root}/.claude/vetor/cache`;
  try {
    const first = await run("bash", [SCRIPT], root, { PATH: pathEnv });
    assertStringIncludes(first.stdout, "GREEN (PR #7 aberta)");
    assertEquals(await Deno.readTextFile(`${cacheDir}/.gitignore`), "*\n");

    // Dentro do TTL: o merge acontece, mas a anotação ainda vem do cache (atraso de até 15 s).
    await writeMockGh(mockBinDir, "fix-done=7=MERGED", callLog);
    const cached = await run("bash", [SCRIPT], root, { PATH: pathEnv });
    assertStringIncludes(cached.stdout, "GREEN (PR #7 aberta)");
    assertEquals(await ghCalls(callLog), 1);

    // Cache vencido: o merge recente aparece.
    const old = new Date(Date.now() - 60_000);
    await Deno.utime(`${cacheDir}/pr-list-cache.txt`, old, old);
    const refreshed = await run("bash", [SCRIPT], root, { PATH: pathEnv });
    assertStringIncludes(refreshed.stdout, "GREEN (já mergeado via #7)");
    assertEquals(await ghCalls(callLog), 2);
  } finally {
    await Deno.remove(mockBinDir, { recursive: true });
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("vetor-status.sh avisa sobre decisões SUSPENDED sem tirar nada da tabela — issue #500", async () => {
  const root = await makeWorkerRepo({ "fix-run": "RUNNING", "fix-wait": "SUSPENDED" });
  try {
    await Deno.writeTextFile(
      `${root}/.claude/vetor/status/fix-wait.md`,
      "Status: SUSPENDED\nIteration: 2/5 (Issue #9)\nBlocked on: Ambiguidade no driver\n",
    );

    const { stdout } = await run("bash", [SCRIPT], root);

    // a tabela continua completa, com o worktree do suspenso ainda ativo
    assertStringIncludes(stdout, "| fix-run | RUNNING |");
    assertStringIncludes(stdout, "| fix-wait | SUSPENDED |");
    assertStringIncludes(stdout, "Decision Inbox");
    assertStringIncludes(stdout, "- fix-wait: Ambiguidade no driver");
    assertEquals(stdout.includes("- fix-run:"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("vetor-status.sh não imprime o aviso da Decision Inbox sem workers SUSPENDED — issue #500", async () => {
  const root = await makeWorkerRepo({ "fix-run": "RUNNING" });
  try {
    const { stdout } = await run("bash", [SCRIPT], root);
    assertEquals(stdout.includes("Decision Inbox"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("vetor-status.sh mostra EJECTED como worktree removido de propósito, não como cancelado — issue #501", async () => {
  const root = await makeWorkerRepo({ "fix-run": "RUNNING" });
  try {
    // a ejeção limpa o worktree: o status file sobra sem worktree correspondente
    await Deno.writeTextFile(
      `${root}/.claude/vetor/status/fix-ejected.md`,
      "Status: EJECTED\nIteration: 5/5 (Issue #9)\n",
    );

    const { stdout } = await run("bash", [SCRIPT], root);

    assertStringIncludes(stdout, "| fix-ejected | EJECTED |");
    assertStringIncludes(stdout, "ejetado (worktree removido; branch preservada)");
    assertEquals(stdout.includes("cancelled (worktree removed)"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
