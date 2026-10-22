import { assertFalse, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const retroSkill = await Deno.readTextFile(
  new URL("skills/retro/SKILL.md", root),
);

Deno.test("issue #449: template da retro inclui checklist de critério de aceite", () => {
  assertStringIncludes(retroSkill, "## Critério de aceite");
  assertStringIncludes(retroSkill, "- [ ] <critério 1 verificável>");
  assertStringIncludes(retroSkill, "- [ ] <critério 2 verificável>");
  assertStringIncludes(
    retroSkill,
    "Critério de aceite com checklist é obrigatório",
  );
});

Deno.test(
  "issue #449: §5 aplica só label de tipo existente, nunca cria labels e não aplica ai-generated",
  () => {
    assertStringIncludes(
      retroSkill,
      "Aplica só a label de tipo existente no repo",
    );
    assertStringIncludes(retroSkill, "Nunca cria labels");
    assertFalse(
      retroSkill.includes("gh label create"),
      "Retro skill não deve conter gh label create",
    );
    assertStringIncludes(retroSkill, "Não aplica `ai-generated`");
    assertFalse(
      retroSkill.includes("--label retro"),
      "Retro skill não deve passar --label retro",
    );
  },
);

Deno.test(
  "issue #449: rodapé 🤖 Gerado por /vetor:retro permanece obrigatório",
  () => {
    assertStringIncludes(retroSkill, "🤖 Gerado por `/vetor:retro`");
    assertStringIncludes(
      retroSkill,
      "O rodapé `🤖 Gerado por /vetor:retro` permanece **obrigatório**",
    );
    assertStringIncludes(
      retroSkill,
      "O rodapé `🤖 Gerado por /vetor:retro` permanece obrigatório em toda issue criada",
    );
  },
);
