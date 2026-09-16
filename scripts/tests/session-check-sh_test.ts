import { assertEquals, assertStringIncludes } from "@std/assert";

// No Windows, .pathname devolve "/C:/..." — bash não resolve esse formato (exit 127,
// "No such file or directory"). Remove a barra líder antes da letra de unidade.
const SCRIPT = new URL("../session-check.sh", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

/**
 * No Windows, `clearEnv: true` + `PATH` em formato POSIX (necessário para o script enxergar
 * um PATH sem deno) impede o próprio Deno.Command de localizar "bash" via busca nativa —
 * falha com "Failed to spawn 'bash': entity not found". Resolve o caminho absoluto nativo
 * (fora do ambiente controlado) uma vez, para spawnar bash sem depender de busca em PATH.
 */
async function resolveBashCommand(): Promise<string> {
  if (Deno.build.os !== "windows") return "bash";

  const posix = await new Deno.Command("bash", {
    args: ["-c", "command -v bash"],
    stdout: "piped",
  }).output();
  const posixPath = new TextDecoder().decode(posix.stdout).trim();

  const win = await new Deno.Command("cygpath", { args: ["-w", posixPath], stdout: "piped" })
    .output();
  return new TextDecoder().decode(win.stdout).trim();
}

const BASH = await resolveBashCommand();

Deno.test("session-check.sh avisa quando deno não está no PATH, sem tentar rodar deno", async () => {
  const output = await new Deno.Command(BASH, {
    args: [SCRIPT],
    env: { "PATH": "/usr/bin:/bin" },
    clearEnv: true,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();

  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);

  assertEquals(output.code, 0);
  assertStringIncludes(stderr, "");
  const parsed = JSON.parse(stdout);
  assertStringIncludes(
    parsed.hookSpecificOutput.additionalContext,
    "Deno não foi encontrado no PATH",
  );
  assertStringIncludes(
    parsed.hookSpecificOutput.additionalContext,
    "curl -fsSL https://deno.land/install.sh | sh",
  );
  assertStringIncludes(parsed.hookSpecificOutput.additionalContext, "DENO_INSTALL");
  assertEquals(parsed.hookSpecificOutput.hookEventName, "SessionStart");
});

Deno.test("session-check.sh delega ao session-check.ts quando deno está no PATH", async () => {
  const denoPath = await new Deno.Command("bash", {
    args: ["-c", "command -v deno"],
    stdout: "piped",
  }).output();
  const denoBin = new TextDecoder().decode(denoPath.stdout).trim();
  const denoDir = denoBin.slice(0, denoBin.lastIndexOf("/"));

  const output = await new Deno.Command(BASH, {
    args: [SCRIPT],
    env: { "PATH": `${denoDir}:/usr/bin:/bin` },
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const writer = output.stdin.getWriter();
  await writer.write(new TextEncoder().encode("{}"));
  await writer.close();

  const result = await output.output();
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);

  assertEquals(result.code, 0, stderr);
  // Sem PATH e sem stdin JSON válido de verdade (cwd sem config), session-check.ts
  // ainda deve rodar (não é bloqueado pela ausência de deno) — não deve conter a
  // mensagem de "deno não encontrado".
  if (stdout.trim().length > 0) {
    const parsed = JSON.parse(stdout);
    const ctx = parsed?.hookSpecificOutput?.additionalContext ?? "";
    assertEquals(ctx.includes("Deno não foi encontrado no PATH"), false);
  }
});
