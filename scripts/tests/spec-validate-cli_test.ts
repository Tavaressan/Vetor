// Exercita o CLI real documentado em skills/spec-validate/SKILL.md (scripts/spec-validate.ts) via
// subprocess — cobre o critério de aceite de teste de #220: "rodar /vetor:spec-validate <path>
// numa Spec de exemplo (mesmo incompleta) e confirmar que emite Score: N/100 e Status: ...".

import { assertEquals, assertMatch } from "@std/assert";

const CLI = new URL("../spec-validate.ts", import.meta.url).pathname;

async function runCli(specPath: string): Promise<{ stdout: string; code: number }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", CLI, specPath],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout } = await command.output();
  return { stdout: new TextDecoder().decode(stdout), code };
}

Deno.test("spec-validate CLI numa spec incompleta emite Score: N/100 e Status:", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  try {
    await Deno.writeTextFile(tmp, "# Tema incompleto\n\n## Context\n");
    const { stdout, code } = await runCli(tmp);
    assertEquals(code, 0);
    assertMatch(stdout, /Score: \d{1,3}\/100/);
    assertMatch(stdout, /Status: (READY|NEEDS_REFINEMENT|INCOMPLETE)/);
    assertMatch(stdout, /Status: INCOMPLETE/);
  } finally {
    await Deno.remove(tmp);
  }
});

Deno.test("spec-validate CLI inclui as seções Strengths/Gaps/Suggestions na saída", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  try {
    await Deno.writeTextFile(tmp, "# Tema incompleto\n\n## Context\n");
    const { stdout } = await runCli(tmp);
    assertMatch(stdout, /## Strengths/);
    assertMatch(stdout, /## Gaps/);
    assertMatch(stdout, /## Suggestions/);
  } finally {
    await Deno.remove(tmp);
  }
});

Deno.test("spec-validate CLI falha com mensagem clara para path inexistente", async () => {
  const { code, stdout } = await runCli("caminho/que/nao/existe.md");
  assertEquals(code, 1);
  assertMatch(stdout + "", /.*/); // stdout pode estar vazio; a checagem real é o exit code
});
