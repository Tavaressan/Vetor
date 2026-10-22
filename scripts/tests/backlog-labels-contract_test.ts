import { assertFalse, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const backlogSkill = await Deno.readTextFile(
  new URL("skills/backlog/SKILL.md", root),
);
const readme = await Deno.readTextFile(new URL("README.md", root));

Deno.test("issue #452: skills/backlog/SKILL.md não cria labels nem exige backlog/ai-generated", () => {
  // Não cria labels
  assertFalse(
    backlogSkill.includes("gh label create"),
    "SKILL.md não deve conter 'gh label create'",
  );

  // Não referencia ai-generated
  assertFalse(
    backlogSkill.includes("ai-generated"),
    "SKILL.md não deve conter 'ai-generated'",
  );

  // Seção 6.a.1 de criação obrigatória de labels foi removida
  assertFalse(
    backlogSkill.includes("6.a.1"),
    "SKILL.md não deve conter subseção 6.a.1",
  );

  // Frase defasada sobre despacho por backlog foi removida
  assertFalse(
    backlogSkill.includes("O coordinator despacha por backlog"),
    "SKILL.md não deve conter a frase defasada 'O coordinator despacha por backlog'",
  );

  // Não deve listar backlog como label sugerido ou na flag --label
  assertFalse(
    backlogSkill.includes("backlog, ai-generated"),
    "SKILL.md não deve sugerir backlog e ai-generated como labels",
  );
  assertFalse(
    backlogSkill.includes('--label "backlog'),
    "SKILL.md não deve aplicar label backlog no comando de criação",
  );
  assertFalse(
    backlogSkill.includes("labels: backlog"),
    "SKILL.md não deve confirmar labels backlog",
  );
});

Deno.test("issue #452: skills/backlog/SKILL.md mapeia apenas labels existentes e documenta omissão", () => {
  // Mapeamento e consumo apenas de labels existentes
  assertStringIncludes(
    backlogSkill,
    "labels de tipo e de módulo",
  );
  assertStringIncludes(
    backlogSkill,
    "documenta a omissão quando não existem",
  );
  assertStringIncludes(
    backlogSkill,
    "omita",
  );

  // Rodapé obrigatório de origem para o coordinator
  assertStringIncludes(
    backlogSkill,
    "🤖 Gerado por `/vetor:backlog`",
  );
  assertStringIncludes(
    backlogSkill,
    "obrigatório",
  );
});

Deno.test("issue #452: README.md deixa de citar ai-generated", () => {
  assertFalse(
    readme.includes("ai-generated"),
    "README.md não deve conter 'ai-generated'",
  );
  assertStringIncludes(
    readme,
    "/vetor:backlog",
  );
  assertStringIncludes(
    readme,
    "/vetor:coordinator",
  );
});
