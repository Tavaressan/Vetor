import { assert, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const install = await Deno.readTextFile(new URL("skills/install/SKILL.md", root));

Deno.test("issue #503: a skill install não grava caminho pessoal do usuário", () => {
  assert(
    !/[A-Za-z]:\\Users\\/.test(install),
    "SKILL.md distribuída não pode conter caminho de usuário do Windows",
  );
  assert(
    !/\/(?:Users|home)\/[^\s/]+\//.test(install),
    "SKILL.md distribuída não pode conter caminho home de usuário",
  );
});

Deno.test("issue #503: o install oferece o .ai-memory.toml com consentimento e sem sobrescrever", () => {
  assertStringIncludes(install, "### 2.c");
  assertStringIncludes(install, "AskUserQuestion");
  assertStringIncludes(install, 'workspace = "<workspace>"');
  assertStringIncludes(install, 'project = "<project>"');
  // O escopo declarado pertence ao usuário: arquivo existente nunca é tocado.
  assertStringIncludes(install, "não toque");
  assertStringIncludes(install, ".ai-memory.toml");
});

Deno.test("issue #503: o install aponta para a receita docker-compose e para a wiki de MCPs", () => {
  assertStringIncludes(install, "`templates/docker-compose.ai-memory.yml`");
  assertStringIncludes(install, "`wiki/MCPs.md`");
});
