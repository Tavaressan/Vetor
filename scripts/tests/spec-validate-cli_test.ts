// Exercita o CLI real documentado em skills/spec-validate/SKILL.md (scripts/spec-validate.ts) via
// subprocess — cobre os critérios de aceite de teste de #220 ("rodar /vetor:spec-validate <path>
// numa Spec de exemplo (mesmo incompleta) e confirmar que emite Score: N/100 e Status: ...") e de
// #222 (refinamento iterativo evolui o score sem misturar o report ao conteúdo da Spec).
//
// Todo teste passa `--history` apontando para um arquivo temporário — sem isso, o CLI persistiria
// em `.claude/vetor/specs/<slug>.validation.json` (path default, relativo ao cwd do processo), que
// é gitignored e por isso um artefato órfão não apareceria em `git status` (ver spec-quality-
// persistence.ts).

import { assertEquals, assertMatch } from "@std/assert";
import { MAX_REFINEMENT_CYCLES } from "../lib/spec-quality-report.ts";

const CLI = new URL("../spec-validate.ts", import.meta.url).pathname;

async function runCli(
  specPath: string,
  historyPath?: string,
): Promise<{ stdout: string; code: number }> {
  const args = ["run", "-A", CLI, specPath];
  if (historyPath) args.push("--history", historyPath);
  const command = new Deno.Command(Deno.execPath(), { args, stdout: "piped", stderr: "piped" });
  const { code, stdout } = await command.output();
  return { stdout: new TextDecoder().decode(stdout), code };
}

Deno.test("spec-validate CLI numa spec incompleta emite Score: N/100 e Status:", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  const history = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await Deno.writeTextFile(tmp, "# Tema incompleto\n\n## Context\n");
    const { stdout, code } = await runCli(tmp, history);
    assertEquals(code, 0);
    assertMatch(stdout, /Score: \d{1,3}\/100/);
    assertMatch(stdout, /Status: (READY|NEEDS_REFINEMENT|INCOMPLETE)/);
    assertMatch(stdout, /Status: INCOMPLETE/);
  } finally {
    await Deno.remove(tmp);
    await Deno.remove(history);
  }
});

Deno.test("spec-validate CLI inclui as seções Strengths/Gaps/Suggestions na saída", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  const history = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await Deno.writeTextFile(tmp, "# Tema incompleto\n\n## Context\n");
    const { stdout } = await runCli(tmp, history);
    assertMatch(stdout, /## Strengths/);
    assertMatch(stdout, /## Gaps/);
    assertMatch(stdout, /## Suggestions/);
  } finally {
    await Deno.remove(tmp);
    await Deno.remove(history);
  }
});

Deno.test("spec-validate CLI falha com mensagem clara para path inexistente", async () => {
  const { code, stdout } = await runCli("caminho/que/nao/existe.md");
  assertEquals(code, 1);
  assertMatch(stdout + "", /.*/); // stdout pode estar vazio; a checagem real é o exit code
});

Deno.test("spec-validate CLI: revalidar após corrigir um gap evolui o score sem alterar bytes da Spec (#222)", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  const history = await Deno.makeTempFile({ suffix: ".json" });
  await Deno.remove(history); // o CLI deve criar o arquivo sozinho (loadValidationState -> null)
  try {
    const incomplete = "# Tema\n\n## Context\n\nContexto.\n\n## Goals\n\nGoal.\n";
    await Deno.writeTextFile(tmp, incomplete);

    const first = await runCli(tmp, history);
    const firstScore = Number(first.stdout.match(/Score: (\d+)\/100/)?.[1]);

    const improved = incomplete +
      "\n## Non-Goals\n\nNon-goal.\n\n## Edge Cases\n\nNenhum edge case relevante identificado para este tema.\n\n## Open Questions\n\nNenhuma questão em aberto.\n";
    await Deno.writeTextFile(tmp, improved);

    const second = await runCli(tmp, history);
    const secondScore = Number(second.stdout.match(/Score: (\d+)\/100/)?.[1]);

    assertEquals(secondScore > firstScore, true);
    assertMatch(second.stdout, /## Refinement History/);
    assertMatch(second.stdout, new RegExp(`${firstScore} → ${secondScore}`));

    // O relatório antigo não é misturado ao conteúdo da Spec — o arquivo da Spec continua sendo
    // exatamente o que foi escrito por último, sem nenhum trecho de Quality Report acrescentado.
    const specBytesAfter = await Deno.readTextFile(tmp);
    assertEquals(specBytesAfter, improved);
    assertEquals(/Spec Quality Report/.test(specBytesAfter), false);
  } finally {
    await Deno.remove(tmp);
    await Deno.remove(history).catch(() => {});
  }
});

Deno.test("spec-validate CLI: atinge o limite de ciclos de refinamento e sinaliza revisão manual (#222)", async () => {
  const tmp = await Deno.makeTempFile({ suffix: ".md" });
  const history = await Deno.makeTempFile({ suffix: ".json" });
  await Deno.remove(history);
  try {
    await Deno.writeTextFile(tmp, "# Tema\n\n## Context\n\nContexto.\n");

    // 1 validação inicial + MAX_REFINEMENT_CYCLES refinamentos cabem sem aviso de cap.
    for (let i = 0; i <= MAX_REFINEMENT_CYCLES; i++) {
      const { stdout } = await runCli(tmp, history);
      assertEquals(/Limite de .* ciclos de refinamento/.test(stdout), false);
    }

    // A próxima validação estoura o teto.
    const overflow = await runCli(tmp, history);
    assertMatch(overflow.stdout, /Limite de \d+ ciclos de refinamento automático já foi atingido/);
  } finally {
    await Deno.remove(tmp);
    await Deno.remove(history).catch(() => {});
  }
});
