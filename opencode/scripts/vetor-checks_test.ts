import { assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./vetor-checks.sh", import.meta.url));

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

async function runDebugScan(cwd: string): Promise<{ code: number; stderr: string }> {
  const output = await new Deno.Command("bash", {
    args: [SCRIPT, "debug-scan", "main"],
    cwd,
    stderr: "piped",
    stdout: "piped",
  }).output();
  return { code: output.success ? 0 : 1, stderr: new TextDecoder().decode(output.stderr) };
}

async function withRepo(test: (repo: string) => Promise<void>): Promise<void> {
  const repo = await makeRepo();
  try {
    await Deno.writeTextFile(`${repo}/app.ts`, "export const value = 1;\n");
    await git(["add", "app.ts"], repo);
    await git(["commit", "-q", "-m", "initial"], repo);
    await test(repo);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
}

Deno.test("debug-scan aceita console.log(JSON.stringify(...)) como saída de CLI — issue #245", async () => {
  await withRepo(async (repo) => {
    await Deno.writeTextFile(
      `${repo}/app.ts`,
      "export const value = 1;\nconsole.log(JSON.stringify(result, null, 2));\n",
    );
    const result = await runDebugScan(repo);
    assertEquals(result.code, 0, result.stderr);
  });
});

Deno.test("debug-scan rejeita console.log com string solta — issue #245", async () => {
  await withRepo(async (repo) => {
    await Deno.writeTextFile(`${repo}/app.ts`, 'console.log("debug");\n');
    const result = await runDebugScan(repo);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, 'console.log("debug")');
  });
});

Deno.test("debug-scan detecta it.only na mesma linha da saída JSON — issue #245", async () => {
  await withRepo(async (repo) => {
    await Deno.writeTextFile(
      `${repo}/app.ts`,
      'console.log(JSON.stringify(x)); it.only("t", () => {});\n',
    );
    const result = await runDebugScan(repo);
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "it.only");
  });
});
