import { assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";

// Issue #562: watchdog de workers parados. O comando é determinístico e portátil: o coordinator o
// roda em cada ciclo de monitoramento (ou num watchdog em background, onde o harness oferecer).

const SCRIPT = fileURLToPath(new URL("../stalled-workers.ts", import.meta.url));

async function git(args: string[], cwd: string) {
  const out = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" })
    .output();
  if (out.code !== 0) throw new Error(new TextDecoder().decode(out.stderr));
}

async function makeRepo(): Promise<string> {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await git(["init", "-q", "-b", "main"], dir);
  await git(["config", "user.email", "t@example.com"], dir);
  await git(["config", "user.name", "T"], dir);
  await git(["commit", "-q", "--allow-empty", "-m", "init"], dir);
  return dir;
}

async function addWorker(root: string, branch: string, status: string | null, ageMinutes: number) {
  const path = `${root}/.claude/worktrees/${branch.replaceAll("/", "-")}`;
  await git(["worktree", "add", "-q", "-b", branch, path], root);
  const when = new Date(Date.now() - ageMinutes * 60_000);
  if (status !== null) {
    await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
    const file = `${root}/.claude/vetor/status/${branch.replaceAll("/", "-")}.md`;
    await Deno.writeTextFile(file, `Status: ${status}\n`);
    await Deno.utime(file, when, when);
  }
  await Deno.utime(path, when, when);
}

async function runScript(cwd: string, ...args: string[]) {
  const out = await new Deno.Command("deno", {
    args: ["run", "-A", SCRIPT, ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code: out.code, stdout: new TextDecoder().decode(out.stdout) };
}

Deno.test("stalled-workers: sai 0 quando nenhum worker passou do limite", async () => {
  const root = await makeRepo();
  try {
    await addWorker(root, "feat/1-a", "RUNNING", 2);
    await addWorker(root, "feat/2-b", "GREEN", 120);
    const { code, stdout } = await runScript(root, "--minutes", "20");
    assertEquals(code, 0);
    assertEquals(stdout.trim(), "");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("stalled-workers: lista o worker RUNNING sem atualização e sai 1", async () => {
  const root = await makeRepo();
  try {
    await addWorker(root, "feat/1-a", "RUNNING", 45);
    await addWorker(root, "feat/2-b", "RUNNING", 1);
    const { code, stdout } = await runScript(root, "--minutes", "20");
    assertEquals(code, 1);
    assertStringIncludes(stdout, "STALLED feat/1-a");
    assertEquals(stdout.includes("feat/2-b"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("stalled-workers: worker sem status file conta a idade do worktree", async () => {
  const root = await makeRepo();
  try {
    await addWorker(root, "feat/3-c", null, 30);
    const { code, stdout } = await runScript(root, "--minutes", "20");
    assertEquals(code, 1);
    assertStringIncludes(stdout, "STALLED feat/3-c");
    assertStringIncludes(stdout, "sem status file");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("stalled-workers: lê workerStallMinutes do config quando não há --minutes", async () => {
  const root = await makeRepo();
  try {
    await Deno.mkdir(`${root}/.claude/vetor`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/.claude/vetor/config.json`,
      JSON.stringify({ workerStallMinutes: 60 }),
    );
    await addWorker(root, "feat/1-a", "RUNNING", 45);
    assertEquals((await runScript(root)).code, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("stalled-workers: sem config nem --minutes usa o padrão de 20 minutos", async () => {
  const root = await makeRepo();
  try {
    await addWorker(root, "feat/1-a", "RUNNING", 10);
    assertEquals((await runScript(root)).code, 0);
    await addWorker(root, "feat/2-b", "RUNNING", 25);
    assertEquals((await runScript(root)).code, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("stalled-workers: ignora worktree sem status fora de .claude/worktrees/", async () => {
  const root = await makeRepo();
  const other = await Deno.realPath(await Deno.makeTempDir());
  try {
    await git(["worktree", "add", "-q", "-b", "outra-ferramenta", `${other}/wt`], root);
    const old = new Date(Date.now() - 600 * 60_000);
    await Deno.utime(`${other}/wt`, old, old);
    assertEquals((await runScript(root, "--minutes", "20")).code, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(other, { recursive: true });
  }
});
