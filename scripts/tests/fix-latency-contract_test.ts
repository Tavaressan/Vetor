import { assertEquals, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const fixLoop = await Deno.readTextFile(new URL("skills/fix/SKILL.md", root));

/** Trecho do fix/SKILL.md entre dois marcadores. */
function section(startMarker: string, endMarker: string): string {
  const start = fixLoop.indexOf(startMarker);
  const end = fixLoop.indexOf(endMarker, start);
  assertEquals(start >= 0 && end > start, true, `seção ${startMarker} não encontrada`);
  return fixLoop.slice(start, end);
}

Deno.test("issue #514: fix roda o typecheck de Node/TS antes dos testes", () => {
  const run = section("**3.a — Executar testes**", "**3.b — Avaliar resultado**");
  assertStringIncludes(run, "Typecheck antes dos testes");
  assertStringIncludes(run, "script `typecheck` do `package.json`");
  assertStringIncludes(run, "node_modules/.bin/tsc --noEmit");
  assertStringIncludes(run, "hooks.typecheckOnEdit");
});

Deno.test("issue #515: test scoping nas iterações 1 a 4 e suíte completa antes do GREEN", () => {
  const run = section("**3.a — Executar testes**", "**3.b — Avaliar resultado**");
  assertStringIncludes(run, "Test scoping");
  assertStringIncludes(run, "iterações 1 a 4");
  assertStringIncludes(run, "nunca autoriza `GREEN`");
  assertStringIncludes(run, "Na iteração 5 rode sempre a suíte completa");

  const green = section("**3.b — Avaliar resultado**", "Se **vermelho**");
  assertStringIncludes(green, "a suíte completa do módulo passou");
  assertStringIncludes(green, "um teste escopado verde, sozinho, nunca basta");
});
