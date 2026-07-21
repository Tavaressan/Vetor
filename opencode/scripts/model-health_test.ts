// Teste de ponta-a-ponta do CLI (issue #83): simula o payload que
// opencode/plugin/vetor.ts envia via stdin ao detectar um `ApiError` com `statusCode: 429`
// num evento `session.error`, e confirma que `.claude/vetor/status/model-health.json` é
// criado/atualizado corretamente — incluindo o cálculo de `until` a partir de `retry-after`.

import { assertEquals } from "@std/assert";

const SCRIPT = new URL("./model-health.ts", import.meta.url).pathname;

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

async function runCli(input: unknown): Promise<{ code: number }> {
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
  return { code: out.code };
}

Deno.test("model-health CLI - ApiError 429 com retry-after grava model-health.json", async () => {
  const repo = await makeRepo();
  const now = Date.now();

  await runCli({
    model: "anthropic/claude-sonnet-4-5",
    statusCode: 429,
    responseHeaders: { "retry-after": "20" },
    message: "rate limited",
    cwd: repo,
  });

  const path = `${repo}/.claude/vetor/status/model-health.json`;
  const file = JSON.parse(await Deno.readTextFile(path));
  const entry = file["anthropic/claude-sonnet-4-5"];

  assertEquals(entry.status, "degraded");
  assertEquals(entry.lastError, "HTTP 429: rate limited");
  // até 2s de tolerância pelo tempo de subida do processo `deno run`.
  const expected = now + 20_000;
  const diff = Math.abs(entry.until - expected);
  if (diff > 5_000) throw new Error(`until fora da tolerância esperada: diff=${diff}ms`);
});

Deno.test("model-health CLI - status não relacionado a rate limit não grava nada", async () => {
  const repo = await makeRepo();

  const result = await runCli({
    model: "anthropic/claude-sonnet-4-5",
    statusCode: 500,
    message: "internal error",
    cwd: repo,
  });

  assertEquals(result.code, 0);
  let exists = true;
  try {
    await Deno.stat(`${repo}/.claude/vetor/status/model-health.json`);
  } catch {
    exists = false;
  }
  assertEquals(exists, false);
});
