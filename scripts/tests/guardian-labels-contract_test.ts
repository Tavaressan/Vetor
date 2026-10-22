import { assertFalse, assertMatch, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const skill = await Deno.readTextFile(new URL("skills/guardian/SKILL.md", root));

Deno.test("issue #455: guardian não cita nem aplica a label ai-generated no SKILL.md", () => {
  assertFalse(
    skill.includes("ai-generated"),
    "skills/guardian/SKILL.md não deve citar a label ai-generated",
  );
});

Deno.test("issue #455: corpo das issues criadas pelo guardian termina com rodapé de origem", () => {
  assertStringIncludes(
    skill,
    "🤖 Gerado por /vetor:guardian",
    "skills/guardian/SKILL.md deve conter o rodapé 🤖 Gerado por /vetor:guardian",
  );
  assertMatch(
    skill,
    /corpo\s+das\s+issues\s+criadas\s+pelo\s+guardian\s+termina\s+com\s+o\s+rodapé\s+[`"]?🤖 Gerado por \/vetor:guardian/i,
  );
  assertMatch(
    skill,
    /---\r?\n🤖 Gerado por \/vetor:guardian\r?\nEOF/,
  );
});

Deno.test("issue #455: labels de tipo/módulo só são aplicadas se já existirem no repositório", () => {
  assertMatch(
    skill,
    /labels\s+de\s+tipo\/módulo\s+só\s+se\s+já\s+existirem\s+no\s+repo\s+\(nunca\s+cria/i,
  );
});

Deno.test("issue #455: plano de auto-fix recomenda criação de issue sem menção a ai-generated", () => {
  assertMatch(
    skill,
    /Criar\s+issue\s+de\s+revisão\s+de\s+design\s+para\s+`<módulo>`\s+\(fan-in\s+alto\s+—\s+deletion\s+test\)/,
  );
});
