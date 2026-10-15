import { assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const reference = await Deno.readTextFile(
  new URL("skills/shared/references/memory-gotchas.md", root),
);
const fixLoop = await Deno.readTextFile(new URL("skills/fix/SKILL.md", root));
const issueWorker = await Deno.readTextFile(new URL("agents/issue-worker.md", root));

Deno.test("issue #370: consulta e registro de gotchas são opcionais e não bloqueiam o fluxo", () => {
  assertStringIncludes(reference, "Se não estiver disponível, pule consulta e registro");
  assertStringIncludes(reference, "Se qualquer chamada falhar");
  assertStringIncludes(reference, "No passo Green");
  assertStringIncludes(reference, "memory_write_page");
  assertStringIncludes(fixLoop, "### 1 — Diagnóstico e detectar módulos");
  assertStringIncludes(fixLoop, "indisponibilidade da memória não altera o estado Green");
  assertStringIncludes(issueWorker, "ausência/falha do MCP não bloqueia");
});
