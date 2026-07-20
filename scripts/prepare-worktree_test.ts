import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { prepareDeps } from "./prepare-worktree.ts";
import { prepareFailedMarkerPath } from "./lib/status.ts";

const SCRIPT = new URL("./prepare-worktree.ts", import.meta.url).pathname;

async function git(args: string[], cwd: string): Promise<{ code: number; stdout: string }> {
  const { code, stdout } = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code, stdout: new TextDecoder().decode(stdout) };
}

async function makeRepo(): Promise<string> {
  const dir = await Deno.makeTempDir();
  await git(["init", "-q", "-b", "main"], dir);
  await git(["config", "user.email", "test@example.com"], dir);
  await git(["config", "user.name", "Test"], dir);
  await git(["commit", "-q", "--allow-empty", "-m", "init"], dir);
  return dir;
}

async function runHook(input: unknown): Promise<{ code: number; stdout: string; stderr: string }> {
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
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

Deno.test("prepareDeps grava marcador quando npm ci falha (sem package-lock.json)", async () => {
  const sourceDir = await Deno.makeTempDir();
  const worktreePath = await Deno.makeTempDir();

  try {
    // package.json sem package-lock.json: `npm ci` falha de imediato, sem rede.
    await Deno.writeTextFile(`${sourceDir}/package.json`, JSON.stringify({ name: "fixture" }));

    await prepareDeps(worktreePath, sourceDir);

    const marker = await Deno.readTextFile(prepareFailedMarkerPath(worktreePath));
    assertStringIncludes(marker, "npm install falhou no worktree");
  } finally {
    await Deno.remove(sourceDir, { recursive: true });
    await Deno.remove(worktreePath, { recursive: true });
  }
});

Deno.test("prepareDeps não grava marcador quando não há instalação necessária", async () => {
  const sourceDir = await Deno.makeTempDir();
  const worktreePath = await Deno.makeTempDir();

  try {
    await Deno.writeTextFile(`${sourceDir}/deno.json`, "{}");

    await prepareDeps(worktreePath, sourceDir);

    let markerExists = true;
    try {
      await Deno.stat(prepareFailedMarkerPath(worktreePath));
    } catch {
      markerExists = false;
    }
    assert(!markerExists);
  } finally {
    await Deno.remove(sourceDir, { recursive: true });
    await Deno.remove(worktreePath, { recursive: true });
  }
});

Deno.test("modo hook: payload real do WorktreeCreate (cwd + name) cria o worktree e imprime o path", async () => {
  const repo = await makeRepo();
  try {
    const { code, stdout } = await runHook({ cwd: repo, name: "feature-auth" });
    const expectedPath = `${repo}/.claude/worktrees/feature-auth`;

    assertEquals(code, 0);
    assertStringIncludes(stdout.trim().split("\n").pop() ?? "", expectedPath);

    const branch = await git(["-C", expectedPath, "branch", "--show-current"], expectedPath);
    assertEquals(branch.stdout.trim(), "feature-auth");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("modo hook: payload sem cwd/name falha com erro claro e loga o stdin bruto", async () => {
  const { code, stderr } = await runHook({ worktree_path: "/x", source_dir: "/y", branch: "z" });

  assertEquals(code, 1);
  assertStringIncludes(stderr, "WorktreeCreate stdin bruto");
  assertStringIncludes(stderr, "ERRO: WorktreeCreate sem cwd/name.");
});
