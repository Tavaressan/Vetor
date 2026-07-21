import { assertEquals } from "@std/assert";

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
    await Deno.writeTextFile(`${repo}/app.ts`, 'console.log("existing");\nexport const value = 1;\n');

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

    await Deno.writeTextFile(`${source}/app.ts`, 'export const value = 1;\nconsole.log("shared");\n');
    await git(["add", "app.ts"], source);
    await git(["commit", "-q", "-m", "remote debug line"], source);
    await git(["push", "-q"], source);
    await git(["fetch", "-q", "origin", "main"], worker);
    await Deno.writeTextFile(`${worker}/app.ts`, 'export const value = 1;\nconsole.log("shared");\nexport const feature = true;\n');

    // SKILL.md passes origin/$DEFAULT_BRANCH, so test must use origin/main
    const result = await runVetorChecks(worker, "debug-scan", "origin/main");
    assertEquals(result.code, 0, result.stderr);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
