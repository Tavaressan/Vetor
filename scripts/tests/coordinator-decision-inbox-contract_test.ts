import { assert, assertFalse, assertMatch, assertStringIncludes } from "@std/assert";

// Issue #500 (RF-03/RF-04 de docs/specs/autonomia-continua-e-desacoplamento-interativo.md):
// contrato estrutural da Async Decision Inbox no coordinator. O comportamento do código está em
// decision-inbox_test.ts; aqui se protege o texto que instrui o agente a usá-lo.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

const coordinatorSkill = await read("skills/coordinator/SKILL.md");
const dispatch = await read("skills/shared/references/issue-coordinator-dispatch.md");
const report = await read("skills/shared/references/issue-coordinator-report.md");
const statusTemplate = await read("skills/shared/references/agent-status.template.md");
const installSkill = await read("skills/install/SKILL.md");
const gitignore = await read(".gitignore");
const opencodeCoordinator = await read("opencode/agent/issue-coordinator.md");

const slice = (text: string, from: string, to: string) =>
  text.slice(text.indexOf(from), text.indexOf(to));

const phase5 = slice(coordinatorSkill, "### 5 — ", "### 6 — ");
const escalation = slice(phase5, "**5.b", "**5.c");

Deno.test("issue #500: BLOCKED_WAITING vira SUSPENDED na inbox e libera a vaga no teto N", () => {
  assert(escalation.length > 0, "seção 5.b ausente");
  assertStringIncludes(escalation, "Async Decision Inbox");
  assertStringIncludes(escalation, 'scripts/decision-inbox.ts" suspend');
  assertStringIncludes(escalation, "<repo-root>/.claude/vetor/decision-inbox.json");
  assertMatch(escalation, /`SUSPENDED` não conta no teto `N`/);
  assertMatch(escalation, /no mesmo ciclo[^\n]*despache o próximo `QUEUED`/);
});

Deno.test("issue #500: liberar a vaga não mata o worker (regra antiga reescrita)", () => {
  assertFalse(
    escalation.includes("Nunca mate um worker bloqueado para abrir vaga"),
    "a regra antiga contradiz a suspensão",
  );
  assertMatch(escalation, /já encerrou o turno/);
  assertMatch(escalation, /worktree fica intacto/);
});

Deno.test("issue #500: a notificação é texto não bloqueante; AskUserQuestion só sem nada a monitorar", () => {
  assertMatch(escalation, /Notificação \(não bloqueante\)/);
  assertMatch(escalation, /só quando não houver mais nada a monitorar nem a despachar/);
  assertStringIncludes(escalation, "vetor-status.sh");
});

Deno.test("issue #500: avanço otimista é opt-in, com a frase da Spec, tag de checkpoint e marcador", () => {
  assertStringIncludes(escalation, '"optimisticDecisionSeconds": 60');
  assertStringIncludes(
    escalation,
    "Avançando automaticamente com a opção (Recommended) em 60s na ausência de resposta",
  );
  assertStringIncludes(escalation, "_vetor_checkpoint_<branch>_<timestamp>");
  assertStringIncludes(escalation, "[OPTIMISTIC_DECISION]");
  // nenhuma permissão é auto-aprovada, nem pelo temporizador
  assertMatch(escalation, /nunca permissão/);
  assertMatch(escalation, /a cada ciclo de monitoramento/);
});

Deno.test("issue #500: texto do usuário nunca vai na linha de comando", () => {
  assertStringIncludes(escalation, "--option <n>");
  assertStringIncludes(escalation, "--decision-file");
  assertMatch(escalation, /nunca interpole texto do usuário/i);
});

Deno.test("issue #500: a retomada usa o worktree existente, sem vetor:issue-worker, com prioridade sobre QUEUED", () => {
  assertMatch(escalation, /sem `subagent_type`/);
  assertMatch(escalation, /nunca `vetor:issue-worker`/);
  assertMatch(escalation, /prioridade sobre os `QUEUED`/);
  assertStringIncludes(dispatch, "retomada de um grupo `SUSPENDED`");
});

Deno.test("issue #500: o headless suspende, libera a vaga e reporta, sem escalar", () => {
  assertMatch(escalation, /Em `--headless`[\s\S]{0,600}`SUSPENDED`/);
  assertMatch(coordinatorSkill, /\| 5\.b — `BLOCKED_WAITING` \|[^\n]*`SUSPENDED`[^\n]*\|/);
});

Deno.test("issue #500: SUSPENDED entra nas regras de onda, duplicidade e dispatch", () => {
  assertMatch(dispatch, /`FAILED_MAX_ITERATIONS`, `BLOCKED_WAITING` ou `SUSPENDED`/);
  assertMatch(dispatch, /`RUNNING`,\s+`BLOCKED_WAITING`, `SUSPENDED` ou `GREEN`/);
  assertMatch(
    slice(coordinatorSkill, "### 4 — ", "### 5 — "),
    /atingir `GREEN`, `FAILED_MAX_ITERATIONS`, for suspenso/,
  );
});

Deno.test("issue #500: o template do status file documenta SUSPENDED como estado só do coordinator", () => {
  assertMatch(statusTemplate, /Status: RUNNING \| BLOCKED_WAITING \| SUSPENDED \|/);
  assertMatch(statusTemplate, /\*\*`SUSPENDED`\*\*[^\n]*apenas pelo coordinator/);
  for (const line of ["Suspended at:", "Worktree:", "Timeout:"]) {
    assertStringIncludes(statusTemplate, line);
  }
});

Deno.test("issue #500: o relatório tem SUSPENDED entre os resultados válidos dos dois modos", () => {
  const modes = report.match(/`SUSPENDED`/g) ?? [];
  assert(modes.length >= 2, "SUSPENDED deve constar na lista do modo interativo e do headless");
});

Deno.test("issue #500: o JSON da inbox não é versionado (repo e passo de instalação)", () => {
  assertMatch(gitignore, /^\.claude\/vetor\/decision-inbox\.json$/m);
  assertStringIncludes(installSkill, ".claude/vetor/decision-inbox.json");
});

Deno.test("issue #500: o espelho OpenCode avisa que a Decision Inbox não se aplica lá", () => {
  assertMatch(opencodeCoordinator, /Decision Inbox[\s\S]{0,200}não se aplica/);
  assert(opencodeCoordinator.split(/\r?\n/).length < 150);
});
