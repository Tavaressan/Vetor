import { assertMatch, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

const coordinatorSkill = await read("skills/coordinator/SKILL.md");
const gatesReference = await read("skills/shared/references/auto-ship-gates.md");
const report = await read("skills/shared/references/issue-coordinator-report.md");
const shipSkill = await read("skills/ship/SKILL.md");
const codeReviewAgent = await read("agents/code-review.md");
const gatesLib = await read("scripts/lib/auto-ship-gates.ts");
const wiki = await read("wiki/Decisoes-de-Design.md");
const opencodeCoordinator = await read("opencode/agent/issue-coordinator.md");

const phase6 = coordinatorSkill.slice(
  coordinatorSkill.indexOf("### 6 — "),
  coordinatorSkill.indexOf("### 7 — "),
);

Deno.test("issue #497: --auto-ship e autoShipHeadless habilitam a Fase 6 em --headless", () => {
  assertStringIncludes(coordinatorSkill, "/vetor:coordinator [label] --headless --auto-ship");
  assertMatch(coordinatorSkill, /- `--auto-ship`: só tem efeito com `--headless`/);
  assertStringIncludes(coordinatorSkill, '"autoShipHeadless": true');
  // matriz e lista do modo headless
  assertMatch(coordinatorSkill, /\| 6 — entrega \|[^\n]*autoShipHeadless: true/);
  assertMatch(coordinatorSkill, /\*\*A Fase 6 \(entrega\) só roda com opt-in\.\*\*/);
  // a fase não é mais "inteira pulada" incondicionalmente
  assertMatch(phase6, /só roda com `--auto-ship` ou `autoShipHeadless: true`/);
});

Deno.test("issue #497: Fase 6.d exige os quatro gates e o script que os avalia", () => {
  assertStringIncludes(phase6, "6.d — Entrega autônoma em `--headless`");
  assertStringIncludes(phase6, '"$SKILL_DIR/../../scripts/vetor-checks.sh" auto-ship-gates <PR>');
  assertMatch(phase6, /CI 100% `SUCCESS`/);
  assertMatch(phase6, /0 apontamentos impeditivos \(`blocker`\)/);
  assertMatch(phase6, /0 colisões em `vetor-checks\.sh migrations`/);
  assertMatch(phase6, /`mergeable == MERGEABLE`/);
  assertStringIncludes(coordinatorSkill, "../shared/references/auto-ship-gates.md");
});

Deno.test("issue #497: gate reprovado deixa o PR aberto e é registrado, sem abortar nem perguntar", () => {
  assertMatch(phase6, /\*\*o PR fica aberto\*\*/);
  assertMatch(phase6, /Não aborte a sessão/);
  assertMatch(phase6, /sem `AskUserQuestion`/);
  assertStringIncludes(report, "`Gate failed`");
  assertMatch(report, /\| #52 \| 🚧 Gate failed \|/);
  assertStringIncludes(gatesReference, "**o PR fica aberto**");
});

Deno.test("issue #497: restrições do headless foram atualizadas junto (skill, wiki e espelho OpenCode)", () => {
  assertMatch(
    coordinatorSkill,
    /nunca faz merge\/ship \(exceto sob\s+`--auto-ship`\/`autoShipHeadless`/,
  );
  assertStringIncludes(wiki, "Entrega autônoma em `--headless` como opt-in (issue #497)");
  assertMatch(opencodeCoordinator, /`--auto-ship` e\s+`autoShipHeadless` não se aplicam/);
});

Deno.test("issue #497: os cabeçalhos que os gates procuram são os que os produtores publicam", () => {
  // o code-review publica o comentário com este cabeçalho; o gate procura exatamente ele
  assertStringIncludes(codeReviewAgent, "## Code Review (Vetor)");
  assertStringIncludes(gatesLib, "Code Review \\(Vetor\\)");
  // o ship publica o security review com o cabeçalho que o gate procura
  assertStringIncludes(shipSkill, "## Security Review (Vetor)");
  assertStringIncludes(gatesLib, "Security Review \\(Vetor\\)");
});

Deno.test("issue #497: a referência documenta o gate estrito, o anti-forja e a heurística de severidade", () => {
  assertMatch(gatesReference, /inclusive\*\* `SKIPPED` e `NEUTRAL`/);
  assertStringIncludes(gatesReference, "gh api user");
  assertStringIncludes(gatesReference, "vetor-checks.sh migrations --against origin/<default>");
  assertMatch(gatesReference, /heurística/);
  assertMatch(gatesReference, /20 minutos/);
});
