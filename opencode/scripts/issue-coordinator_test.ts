import { assert, assertFalse, assertMatch, assertNotMatch } from "@std/assert";
import { measureSkill } from "../../scripts/skill-budget.ts";

// Issue #478: `opencode/agent/issue-coordinator.md` é um agent fino. O fluxo do coordinator mora em
// `skills/coordinator/SKILL.md` e nas referências de `skills/shared/references/`; o agent só carrega
// a skill pela ferramenta `skill` e registra o que muda ao executar no OpenCode. Desde a #569 estes
// testes conferem só estrutura (frontmatter, duplicação e links), nunca a redação do agent.

const root = new URL("../../", import.meta.url);

function readText(path: string): Promise<string> {
  return Deno.readTextFile(new URL(path, root));
}

const agent = await readText("opencode/agent/issue-coordinator.md");
const budget = measureSkill(new URL(".", root).pathname.replace(/\/$/, ""), "coordinator");
const coordinatorBundle = (
  await Promise.all(
    [budget.skill, ...budget.mandatory, ...budget.onDemand].map((c) => readText(c.path)),
  )
).join("\n");

function extractFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert(match !== null, "frontmatter YAML ausente");
  return match[1];
}

Deno.test("issue-coordinator carrega a skill coordinator pela ferramenta skill, com permissão explícita — issue #478", () => {
  const frontmatter = extractFrontmatter(agent);

  assertMatch(frontmatter, /^mode:\s*primary\s*$/m);
  // `"*": deny` primeiro e `coordinator: allow` depois: no OpenCode vale a última regra que casa.
  assertMatch(frontmatter, /^ {2}skill:\r?\n {4}"\*":\s*deny\r?\n {4}coordinator:\s*allow\s*$/m);
});

Deno.test("issue-coordinator não repete as fases nem as regras da skill — issue #478", () => {
  // As fases podem morar no SKILL.md ou nas referências que ele alcança (issue #569).
  const phaseHeadings = coordinatorBundle.match(/^### \d — .+$/gm) ?? [];
  assert(phaseHeadings.length >= 7, "a skill deveria ter as fases 0 a 7");
  for (const heading of phaseHeadings) {
    assertFalse(agent.includes(heading), `o agent repete o cabeçalho da skill: ${heading}`);
  }

  // Trechos operacionais que pertencem à skill e às referências compartilhadas.
  for (
    const duplicated of [
      "Gerado por",
      "ai-generated",
      "Checkpoint de fechamento de onda",
      "SKIPPED (aguardando",
      "Ondas de despacho",
      "Circuit Breaker",
      "defaultDispatchLabel",
    ]
  ) {
    assertFalse(agent.includes(duplicated), `o agent repete "${duplicated}", que é da skill`);
  }

  // Tamanho em caracteres, não em linhas: re-quebrar a prosa não muda o que o agent carrega.
  assert(
    agent.length < 14_000,
    "o agent fino deveria ter menos de 14 000 caracteres (eram 593 linhas antes da #478)",
  );
});

// Tudo que o agent cita precisa existir: nas referências compartilhadas (instaladas em
// `.opencode/skills/shared/references/`) e nos scripts que o instalador gera em `.opencode/scripts/`.
Deno.test("issue-coordinator só cita referências e scripts que o instalador entrega — issue #478", async () => {
  const references = new Set(
    [...agent.matchAll(/\.\.\/shared\/references\/([A-Za-z0-9._-]+\.md)/g)].map((m) => m[1]),
  );
  assert(references.size > 0, "o agent deveria apontar para as referências da skill");
  for (const name of references) {
    await Deno.stat(new URL(`skills/shared/references/${name}`, root));
  }

  const scripts = new Set(
    [...agent.matchAll(/\.opencode\/scripts\/([A-Za-z0-9._/-]+\.(?:ts|sh))/g)].map((m) => m[1]),
  );
  assert(scripts.size > 0, "o agent deveria citar os scripts do OpenCode");
  for (const name of scripts) {
    const canonical = await exists(new URL(`scripts/${name}`, root));
    const exclusive = await exists(new URL(`opencode/scripts/${name}`, root));
    assert(canonical || exclusive, `.opencode/scripts/${name} não tem fonte no repositório`);
  }
});

async function exists(url: URL): Promise<boolean> {
  try {
    await Deno.stat(url);
    return true;
  } catch {
    return false;
  }
}

Deno.test("nenhum agente em opencode/agent/ fixa model: no frontmatter — issue #395", async () => {
  const agentFiles = [
    "issue-coordinator.md",
    "issue-worker.md",
    "code-review.md",
  ];

  for (const file of agentFiles) {
    const document = await readText(`opencode/agent/${file}`);
    const frontmatter = extractFrontmatter(document);
    assertNotMatch(
      frontmatter,
      /^model:\s*\S+/m,
      `${file} fixa model: no frontmatter YAML; modelos devem vir de config.json ou inherit`,
    );
  }
});
