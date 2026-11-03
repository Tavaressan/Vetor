import { assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

const ship = await read("skills/ship/SKILL.md");
const coordinator = await read("skills/coordinator/SKILL.md");
const template = await read("skills/shared/references/agent-status.template.md");
const fix = await read("skills/fix/SKILL.md");
const issueWorker = await read("agents/issue-worker.md");
const shipWorker = await read("agents/ship-worker.md");

Deno.test("#543: ship e coordinator chamam prepare/finalize do vetor-checks.sh e só escalam em falha", () => {
  assertStringIncludes(ship, 'vetor-checks.sh" prepare "<path-do-worktree>"');
  assertStringIncludes(ship, 'vetor-checks.sh" finalize <PR-number> <branch>');
  assertStringIncludes(coordinator, 'vetor-checks.sh" prepare "<path-do-worktree>"');
  assertStringIncludes(coordinator, 'vetor-checks.sh" finalize <PR> <branch>');
  assertStringIncludes(coordinator, "Só em falha");
  assertStringIncludes(shipWorker, "Primeiro rode o caminho determinístico");
});

Deno.test("#542: template define Tested:, o worker o grava no GREEN e o ship documenta o pulo", () => {
  assertStringIncludes(template, "Tested: <sha> <comando> pass");
  assertStringIncludes(fix, "Tested: <sha> <comando> pass");
  assertStringIncludes(issueWorker, "Tested: <sha> <comando> pass");
  assertStringIncludes(ship, "Tested: <sha> <comando> pass");
  assertStringIncludes(ship, "o sync com a default não trouxe commits");
});

const flat = (t: string) => t.replace(/\s+/g, " ");

Deno.test("#541: coordinator revisa o diff local antes do prepare e registra a revisão no PR", async () => {
  const codeReview = await read("agents/code-review.md");
  const i = coordinator.indexOf("Revisão local antes do push (issue #541)");
  const j = coordinator.indexOf("Caminho determinístico primeiro (issue #543)");
  const k = coordinator.indexOf("Registro da revisão no PR (issue #541)");
  if (i < 0 || j < 0 || k < 0 || !(i < j && j < k)) {
    throw new Error("ordem esperada: revisão local, prepare, registro no PR");
  }
  const c = flat(coordinator);
  assertStringIncludes(c, "`blocker` e `warning` de confiança `alta`");
  assertStringIncludes(c, "Limite de 2 rodadas");
  assertStringIncludes(c, "revisão do **HEAD atual**");
  assertStringIncludes(c, "### Resolvidos antes do push");
  assertStringIncludes(c, "<branch-sanitizada>-review.md");
  assertStringIncludes(coordinator, "gh pr comment <PR> --body-file");
  assertStringIncludes(codeReview, "## Modo local (sem PR");
  assertStringIncludes(codeReview, "git -C <worktree> diff");
  assertStringIncludes(flat(ship), "`## Code Review (Vetor)` com uma linha `Reviewed: <sha>`");
  assertStringIncludes(flat(codeReview), "`Reviewed: <sha>`");
  assertStringIncludes(codeReview, "origin/$DEFAULT_BRANCH...HEAD");
});
