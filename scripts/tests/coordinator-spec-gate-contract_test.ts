import { assert, assertEquals } from "@std/assert";

// Issue #561: a classificação do gate de Spec/design resolve os 4 casos de label × Critério de
// Aceite sem ambiguidade. A tabela de decisão é a fonte; o teste lê as linhas dela.

const root = new URL("../../", import.meta.url);
const skill = await Deno.readTextFile(new URL("skills/coordinator/SKILL.md", root));

const start = skill.indexOf("#### Gate de Spec/design");
const end = skill.indexOf("3. **Spec associada**", start);
const gate = skill.slice(start, end);

const rows = gate
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("| `"))
  .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));

const classify = (featLike: boolean, hasCriteria: boolean) => {
  const row = rows.find(([label, criteria]) =>
    label.includes("`enhancement`") === featLike && criteria.startsWith(hasCriteria ? "sim" : "não")
  );
  assert(row, `linha ausente: featLike=${featLike}, critério=${hasCriteria}`);
  return row[2];
};

Deno.test("issue #561: a tabela de decisão cobre os 4 casos de label × critério de aceite", () => {
  assertEquals(rows.length, 4);
});

Deno.test("issue #561: enhancement com critério de aceite em checklist é trivial", () => {
  assertEquals(classify(true, true), "`trivial`");
  assertEquals(classify(false, true), "`trivial`");
});

Deno.test("issue #561: sem critério de aceite a issue é não-trivial, qualquer que seja a label", () => {
  assertEquals(classify(true, false), "não-trivial");
  assertEquals(classify(false, false), "não-trivial");
});

Deno.test("issue #561: múltiplos módulos continuam tornando a issue não-trivial", () => {
  assert(/2 ou mais módulos tocados, a issue é não-trivial/.test(gate));
});
