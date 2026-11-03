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
