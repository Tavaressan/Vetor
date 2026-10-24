import { assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";
import { isTerminal } from "../lib/status.ts";

const SCRIPT = fileURLToPath(new URL("../vetor-checks.sh", import.meta.url));

function getBashCommand(): string {
  if (Deno.build.os === "windows") {
    const gitBash = "C:/Program Files/Git/bin/bash.exe";
    try {
      if (Deno.statSync(gitBash).isFile) return gitBash;
    } catch {
      // fallback
    }
  }
  return "bash";
}

async function runShipArgs(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  const bashCmd = getBashCommand();
  const cmd = new Deno.Command(bashCmd, {
    args: [SCRIPT, "validate-ship-args", ...args],
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await cmd.output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout).trim(),
    stderr: new TextDecoder().decode(stderr).trim(),
  };
}

Deno.test("validate-ship-args aceita invocação sem argumentos (modo full legado)", async () => {
  const res = await runShipArgs();
  assertEquals(res.code, 0);
  assertEquals(res.stdout, "full");
});

Deno.test("validate-ship-args aceita número de issue isolado (modo full legado com issue)", async () => {
  const res = await runShipArgs("42");
  assertEquals(res.code, 0);
  assertEquals(res.stdout, "full 42");
});

Deno.test("validate-ship-args aceita --prepare sem issue", async () => {
  const res = await runShipArgs("--prepare");
  assertEquals(res.code, 0);
  assertEquals(res.stdout, "prepare");
});

Deno.test("validate-ship-args aceita --prepare com issue em qualquer ordem", async () => {
  const res1 = await runShipArgs("--prepare", "493");
  assertEquals(res1.code, 0);
  assertEquals(res1.stdout, "prepare 493");

  const res2 = await runShipArgs("493", "--prepare");
  assertEquals(res2.code, 0);
  assertEquals(res2.stdout, "prepare 493");
});

Deno.test("validate-ship-args aceita --finalize com PR-number", async () => {
  const res = await runShipArgs("--finalize", "512");
  assertEquals(res.code, 0);
  assertEquals(res.stdout, "finalize 512");
});

Deno.test("validate-ship-args rejeita --finalize sem PR-number", async () => {
  const res = await runShipArgs("--finalize");
  assertEquals(res.code, 1);
  assertStringIncludes(res.stderr, "--finalize exige o número da PR como argumento");
});

Deno.test("validate-ship-args rejeita --finalize com PR-number não-numérico ou zero", async () => {
  const res1 = await runShipArgs("--finalize", "invalid");
  assertEquals(res1.code, 1);
  assertStringIncludes(res1.stderr, "deve ser um inteiro positivo");

  const res2 = await runShipArgs("--finalize", "0");
  assertEquals(res2.code, 1);
  assertStringIncludes(res2.stderr, "deve ser um inteiro positivo");

  const res3 = await runShipArgs("--finalize", "-10");
  assertEquals(res3.code, 1);
  assertStringIncludes(res3.stderr, "deve ser um inteiro positivo");
});

Deno.test("validate-ship-args rejeita --prepare com issue inválida", async () => {
  const res1 = await runShipArgs("--prepare", "0");
  assertEquals(res1.code, 1);
  assertStringIncludes(res1.stderr, "deve ser um inteiro positivo");

  const res2 = await runShipArgs("--prepare", "invalid");
  assertEquals(res2.code, 1);
  assertStringIncludes(res2.stderr, "deve ser um inteiro positivo");
});

Deno.test("validate-ship-args rejeita flags conflitantes --prepare e --finalize juntas", async () => {
  const res1 = await runShipArgs("--prepare", "--finalize", "42");
  assertEquals(res1.code, 1);
  assertStringIncludes(res1.stderr, "flags conflitantes no ship");

  const res2 = await runShipArgs("--finalize", "42", "--prepare");
  assertEquals(res2.code, 1);
  assertStringIncludes(res2.stderr, "flags conflitantes no ship");
});

Deno.test("validate-ship-args rejeita flags desconhecidas", async () => {
  const res = await runShipArgs("--auto-merge");
  assertEquals(res.code, 1);
  assertStringIncludes(res.stderr, "flag desconhecida para /vetor:ship");
});

Deno.test("validate-ship-args rejeita argumentos excessivos", async () => {
  const res = await runShipArgs("--prepare", "42", "extra");
  assertEquals(res.code, 1);
  assertStringIncludes(res.stderr, "argumentos excessivos no ship");
});

Deno.test("isTerminal reconhece PR_STAGED como estado terminal do worker", () => {
  assertEquals(isTerminal("PR_STAGED"), true);
});
