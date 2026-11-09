import { assert, assertEquals } from "@std/assert";
import {
  type BudgetConfig,
  citationUnits,
  estimateTokens,
  limitFor,
  measureAll,
  measureSkill,
  overBudget,
} from "../skill-budget.ts";

// Issue #570: orçamento estático de contexto por skill. O último teste mede o repositório real e
// é o que faz o CI falhar quando uma skill passa do limite de scripts/skill-budget.json.

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await Deno.makeTempDir();
  for (const [path, content] of Object.entries(files)) {
    const full = `${root}/${path}`;
    await Deno.mkdir(full.split("/").slice(0, -1).join("/"), { recursive: true });
    await Deno.writeTextFile(full, content);
  }
  return root;
}

Deno.test("skill-budget: separa referência obrigatória da citada só com gatilho", async () => {
  const root = await fixture({
    "skills/a/SKILL.md": [
      "---",
      'compatibility: "ver shared/references/fm.md"',
      "---",
      "Leia `../shared/references/core.md` antes de tudo.",
      "",
      "- `../shared/references/extra.md` — só quando o",
      "  usuário pedir.",
    ].join("\n"),
    "skills/shared/references/core.md": "x".repeat(400) + "\nVer `nested.md`.\n",
    "skills/shared/references/nested.md": "y".repeat(40),
    "skills/shared/references/extra.md": "z".repeat(80),
    "skills/shared/references/fm.md": "w".repeat(4000),
  });
  try {
    const budget = measureSkill(root, "a");
    assertEquals(budget.mandatory.map((c) => c.path.split("/").pop()), ["core.md", "nested.md"]);
    assertEquals(budget.onDemand.map((c) => c.path.split("/").pop()), ["extra.md"]);
    assertEquals(
      budget.mandatoryTokens,
      budget.skill.tokens + budget.mandatory.reduce((t, c) => t + c.tokens, 0),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("skill-budget: o agent soma a leitura obrigatória das skills pré-carregadas", async () => {
  const root = await fixture({
    "skills/a/SKILL.md": "a".repeat(800),
    "agents/w.md": "---\nname: w\nskills: [a]\n---\n" + "b".repeat(400),
  });
  try {
    const { skills, agents } = measureAll(root);
    assertEquals(agents[0].preloads, ["a"]);
    assertEquals(agents[0].mandatoryTokens, agents[0].body.tokens + skills[0].mandatoryTokens);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("skill-budget: unidades de citação juntam linhas do mesmo item", () => {
  assertEquals(citationUnits("- um\n  dois\n- três"), ["- um dois", "- três"]);
  assertEquals(estimateTokens(9), 3);
});

Deno.test("skill-budget: overBudget usa o limite da skill, senão o default", () => {
  const config: BudgetConfig = { limits: { default: 10, big: 100 } };
  const skill = (name: string, mandatoryTokens: number) => ({
    name,
    skill: { path: "", chars: 0, tokens: 0 },
    mandatory: [],
    onDemand: [],
    mandatoryTokens,
    onDemandTokens: 0,
  });
  assertEquals(limitFor(config, "x"), 10);
  assertEquals(
    overBudget([skill("x", 11), skill("big", 99)], config).map((s) => s.name),
    ["x"],
  );
});

Deno.test("skill-budget: nenhuma skill do repositório passa do limite configurado", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(`${repoRoot}/scripts/skill-budget.json`),
  ) as BudgetConfig;
  const over = overBudget(measureAll(repoRoot).skills, config);
  assert(
    over.length === 0,
    over.map((s) => `${s.name}: ${s.mandatoryTokens} > ${limitFor(config, s.name)}`).join("\n") +
      "\nReduza a skill ou registre a decisão de subir o limite em scripts/skill-budget.json.",
  );
});
