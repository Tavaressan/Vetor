import { assertEquals } from "@std/assert";

const SCRIPT = new URL("./stop-recovery.ts", import.meta.url).pathname;

/**
 * Roda o script como subprocesso Deno e envia `input` via stdin, simulando o
 * payload real que o Claude Code passa ao hook Stop.
 */
async function runHook(
  input: Record<string, unknown>,
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
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

Deno.test("stop-recovery não falha com erro de sintaxe/compilação ao rodar", async () => {
  const { code, stderr } = await runHook({});
  assertEquals(code, 0, `stderr inesperado: ${stderr}`);
  assertEquals(
    stderr.includes("error: Uncaught SyntaxError") || stderr.includes("error: The parser expected"),
    false,
    `script falhou por erro de sintaxe/compilação:\n${stderr}`,
  );
});
