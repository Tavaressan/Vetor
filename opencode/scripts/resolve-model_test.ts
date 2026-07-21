// Teste de ponta-a-ponta do CLI (issue #84): com uma entrada `degraded` sintética em
// model-health.json para o modelo preferencial, confirma que a escolha cai para o próximo
// modelo/provedor saudável da lista de fallback — e que, com todos degraded, o script sai com
// código 1 (o issue-coordinator interpreta isso como "mantenha o grupo QUEUED").

import { assertEquals, assertStringIncludes } from "@std/assert";

const SCRIPT = new URL("./resolve-model.ts", import.meta.url).pathname;

async function git(args: string[], cwd: string): Promise<void> {
  await new Deno.Command("git", { args, cwd, stdout: "null", stderr: "null" }).output();
}

async function makeRepo(): Promise<string> {
  const dir = await Deno.makeTempDir();
  await git(["init", "-q", "-b", "main"], dir);
  await git(["config", "user.email", "test@example.com"], dir);
  await git(["config", "user.name", "Test"], dir);
  await git(["commit", "-q", "--allow-empty", "-m", "init"], dir);
  return dir;
}

async function writeModelHealth(repo: string, content: unknown): Promise<void> {
  const dir = `${repo}/.claude/vetor/status`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/model-health.json`, JSON.stringify(content));
}

async function runCli(
  input: unknown,
): Promise<{ code: number; stdout: string; stderr: string }> {
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
    stdout: new TextDecoder().decode(out.stdout).trim(),
    stderr: new TextDecoder().decode(out.stderr).trim(),
  };
}

Deno.test("resolve-model CLI - sem model-health.json escolhe o primeiro da lista", async () => {
  const repo = await makeRepo();
  const result = await runCli({
    fallback: ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-5"],
    cwd: repo,
  });
  assertEquals(result.code, 0);
  assertEquals(result.stdout, "anthropic/claude-haiku-4-5");
});

Deno.test("resolve-model CLI - preferencial degraded (sintético) cai para o próximo", async () => {
  const repo = await makeRepo();
  await writeModelHealth(repo, {
    "anthropic/claude-haiku-4-5": {
      status: "degraded",
      until: Date.now() + 60_000,
      lastError: "HTTP 429",
    },
  });

  const result = await runCli({
    fallback: ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-5"],
    cwd: repo,
  });

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "anthropic/claude-sonnet-4-5");
});

Deno.test("resolve-model CLI - todos degraded sai com código 1 e sem stdout", async () => {
  const repo = await makeRepo();
  const until = Date.now() + 60_000;
  await writeModelHealth(repo, {
    "anthropic/claude-haiku-4-5": { status: "degraded", until, lastError: "HTTP 429" },
    "anthropic/claude-sonnet-4-5": { status: "degraded", until, lastError: "HTTP 429" },
  });

  const result = await runCli({
    fallback: ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-5"],
    cwd: repo,
  });

  assertEquals(result.code, 1);
  assertEquals(result.stdout, "");
  assertStringIncludes(result.stderr, "degraded");
});

Deno.test("resolve-model CLI - usa tier de config.json quando fallback não é passado", async () => {
  const repo = await makeRepo();
  await Deno.mkdir(`${repo}/.claude/vetor`, { recursive: true });
  await Deno.writeTextFile(
    `${repo}/.claude/vetor/config.json`,
    JSON.stringify({
      modelFallback: { simple: ["openai/gpt-5-mini", "anthropic/claude-haiku-4-5"] },
    }),
  );

  const result = await runCli({ tier: "simple", cwd: repo });

  assertEquals(result.code, 0);
  assertEquals(result.stdout, "openai/gpt-5-mini");
});
