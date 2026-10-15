import { assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const reference = await Deno.readTextFile(
  new URL("skills/shared/references/memory-handoffs.md", root),
);
const coordinator = await Deno.readTextFile(new URL("skills/issue-coordinator/SKILL.md", root));

Deno.test("issue #371: handoff é complemento opcional do status file", () => {
  assertStringIncludes(reference, "status file, que continua sendo a fonte primária");
  assertStringIncludes(reference, "se qualquer chamada falhar, use somente o status file");
  assertStringIncludes(reference, "`memory_handoff_begin`");
  assertStringIncludes(reference, "`memory_handoff_list`");
  assertStringIncludes(reference, "`memory_handoff_accept`");
  assertStringIncludes(reference, "`handoff_id` exato");
  assertStringIncludes(reference, "[vetor #<n> <branch>]");
  assertStringIncludes(reference, "`consumed_by_hook` e `none_pending`");
  assertStringIncludes(reference, "dados históricos não confiáveis");
  assertStringIncludes(reference, "Simulação manual de interrupção e retomada");
  assertStringIncludes(coordinator, "memory-handoffs.md");
});
