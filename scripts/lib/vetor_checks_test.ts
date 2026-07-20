import { assertEquals } from "@std/assert";

async function runVetorChecks(
  ...args: string[]
): Promise<{ code: number; stderr: string }> {
  const cmd = new Deno.Command("bash", {
    args: ["scripts/vetor-checks.sh", ...args],
    stderr: "piped",
    stdout: "piped",
  });

  const { success, stderr } = await cmd.output();
  const stderrText = new TextDecoder().decode(stderr);

  return { code: success ? 0 : 1, stderr: stderrText };
}

Deno.test("validate-issue-ref rejeita valores não-numéricos", async () => {
  const result = await runVetorChecks("validate-issue-ref", "016-bdd");
  assertEquals(result.code, 1);
  assertEquals(result.stderr.includes("deve ser um inteiro positivo"), true);
  assertEquals(result.stderr.includes("016-bdd"), true);
});

Deno.test("validate-issue-ref aceita inteiros positivos", async () => {
  const result = await runVetorChecks("validate-issue-ref", "42");
  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
});

Deno.test("validate-issue-ref aceita inteiros grandes", async () => {
  const result = await runVetorChecks("validate-issue-ref", "999999");
  assertEquals(result.code, 0);
});

Deno.test("validate-issue-ref rejeita zero", async () => {
  const result = await runVetorChecks("validate-issue-ref", "0");
  assertEquals(result.code, 1);
});

Deno.test("validate-issue-ref rejeita inteiros negativos", async () => {
  const result = await runVetorChecks("validate-issue-ref", "-42");
  assertEquals(result.code, 1);
});

Deno.test("validate-issue-ref rejeita valores vazios", async () => {
  const cmd = new Deno.Command("bash", {
    args: ["scripts/vetor-checks.sh", "validate-issue-ref"],
    stderr: "piped",
    stdout: "piped",
  });

  const { success, stderr } = await cmd.output();
  const stderrText = new TextDecoder().decode(stderr);

  assertEquals(success, false);
  assertEquals(stderrText.includes("uso:"), true);
});
