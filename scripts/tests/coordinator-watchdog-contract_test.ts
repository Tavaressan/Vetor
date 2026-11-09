import { assertMatch } from "@std/assert";

// Issue #562: o coordinator arma o watchdog de workers parados e deixa explícito como a espera
// conta no maxSessionMinutes.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const coordinator = await read("skills/coordinator/SKILL.md");
const monitoring = await read("skills/shared/references/issue-coordinator-monitoring.md");

Deno.test("issue #562: a Fase 5 arma o watchdog e o trata como bloqueio da 5.b", () => {
  const phase5 = coordinator.slice(
    coordinator.indexOf("### 5 — "),
    coordinator.indexOf("### 6 — "),
  );
  assertMatch(phase5, /watchdog de workers parados \(5\.h/);
  assertMatch(phase5, /bloqueio da 5\.b/);
});

Deno.test("issue #562: o watchdog tem caminho portátil e orienta checar permissões", () => {
  const section = monitoring.slice(monitoring.indexOf("**5.h"));
  assertMatch(section, /vetor-checks\.sh" stalled-workers/);
  assertMatch(section, /\*\*Portátil \(todo harness\):\*\*/);
  assertMatch(section, /prompt de permissão pendente/);
});

Deno.test("issue #562: o orçamento diz se a espera por workers conta no maxSessionMinutes", () => {
  const budgets = coordinator.slice(coordinator.indexOf("## Orçamentos e hard caps"));
  assertMatch(budgets, /A espera por workers\s+ativos conta/);
  assertMatch(budgets, /workerStallMinutes/);
});
