import { assertMatch } from "@std/assert";

// Issue #559: o worker confere o estado terminal como último passo, de forma portátil (comando de
// shell, sem hook), e o coordinator reconcilia o término com status não terminal.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

const worker = await read("agents/issue-worker.md");
const opencodeWorker = await read("opencode/agent/issue-worker.md");
const coordinator = await read("skills/coordinator/SKILL.md");
const monitoring = await read("skills/shared/references/issue-coordinator-monitoring.md");

Deno.test("issue #559: os dois workers rodam verify-status como último passo", () => {
  assertMatch(worker, /### Último passo obrigatório[\s\S]*vetor-checks\.sh" verify-status/);
  assertMatch(opencodeWorker, /Último passo, obrigatório[\s\S]*vetor-checks\.sh" verify-status/);
});

Deno.test("issue #559: a Fase 5 manda reconciliar antes do Pre-Ship", () => {
  const phase5 = coordinator.slice(
    coordinator.indexOf("### 5 — "),
    coordinator.indexOf("### 6 — "),
  );
  assertMatch(phase5, /reconciliação 5\.g/);
});

Deno.test("issue #559: a reconciliação verifica commits e árvore, roda a suíte e registra", () => {
  const section = monitoring.slice(monitoring.indexOf("**5.g"));
  assertMatch(section, /git status --porcelain/);
  assertMatch(section, /rev-list --count/);
  assertMatch(section, /Status: GREEN`, `Tested:/);
  assertMatch(section, /FAILED_MAX_ITERATIONS/);
  assertMatch(section, /Reconciliado pelo coordinator/);
});
