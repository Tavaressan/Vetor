import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "node:path";
import {
  combineGates,
  evaluateAutoShipGates,
  evaluateCiGate,
  evaluateMergeableGate,
  evaluateMigrationsGate,
  evaluateReviewsGate,
  type GateDeps,
  isReviewExempt,
  type PrComment,
} from "../lib/auto-ship-gates.ts";

const ok = { __typename: "CheckRun", name: "check", status: "COMPLETED", conclusion: "SUCCESS" };

Deno.test("gate ci: sem checks é PENDING, nunca PASS", () => {
  assertEquals(evaluateCiGate([]).status, "PENDING");
  assertEquals(evaluateCiGate(null).status, "PENDING");
});

Deno.test("gate ci: todos SUCCESS passa", () => {
  assertEquals(evaluateCiGate([ok, { ...ok, name: "cli" }]).status, "PASS");
});

Deno.test("gate ci: check em andamento é PENDING; falha definitiva vence a pendência", () => {
  const running = { __typename: "CheckRun", name: "cli", status: "IN_PROGRESS", conclusion: "" };
  assertEquals(evaluateCiGate([ok, running]).status, "PENDING");

  const failed = { ...ok, name: "lint", conclusion: "FAILURE" };
  const res = evaluateCiGate([failed, running]);
  assertEquals(res.status, "FAIL");
  assertStringIncludes(res.detail, "lint=FAILURE");
});

Deno.test("gate ci é estrito: SKIPPED, NEUTRAL e CANCELLED não contam como SUCCESS", () => {
  for (const conclusion of ["SKIPPED", "NEUTRAL", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"]) {
    assertEquals(evaluateCiGate([ok, { ...ok, name: "x", conclusion }]).status, "FAIL", conclusion);
  }
});

Deno.test("gate ci: StatusContext usa state (SUCCESS passa, PENDING espera, FAILURE/ERROR reprova)", () => {
  const ctx = (state: string) => ({ __typename: "StatusContext", context: "ci/legacy", state });
  assertEquals(evaluateCiGate([ok, ctx("SUCCESS")]).status, "PASS");
  assertEquals(evaluateCiGate([ok, ctx("PENDING")]).status, "PENDING");
  assertEquals(evaluateCiGate([ok, ctx("EXPECTED")]).status, "PENDING");
  assertEquals(evaluateCiGate([ok, ctx("FAILURE")]).status, "FAIL");
  assertEquals(evaluateCiGate([ok, ctx("ERROR")]).status, "FAIL");
});

Deno.test("gate mergeable: só MERGEABLE passa; UNKNOWN espera; CONFLICTING reprova", () => {
  assertEquals(evaluateMergeableGate("MERGEABLE").status, "PASS");
  assertEquals(evaluateMergeableGate("UNKNOWN").status, "PENDING");
  assertEquals(evaluateMergeableGate(undefined).status, "PENDING");
  assertEquals(evaluateMergeableGate("CONFLICTING").status, "FAIL");
});

Deno.test("gate migrations: exit 0 passa, exit != 0 reprova com a saída, sem execução é PENDING", () => {
  assertEquals(evaluateMigrationsGate({ code: 0, output: "" }).status, "PASS");
  const failed = evaluateMigrationsGate({ code: 1, output: "FALHA: colisão V14" });
  assertEquals(failed.status, "FAIL");
  assertStringIncludes(failed.detail, "V14");
  assertEquals(evaluateMigrationsGate(null).status, "PENDING");
});

Deno.test("isReviewExempt segue a dispensa do ship 8.5 (docs/wiki .md, .md na raiz, lockfiles)", () => {
  assertEquals(isReviewExempt(["docs/specs/x.md", "wiki/Home.md", "README.md", "deno.lock"]), true);
  assertEquals(isReviewExempt(["cli/package-lock.json"]), true);
  assertEquals(isReviewExempt(["docs/specs/x.md", "skills/ship/SKILL.md"]), false);
  assertEquals(isReviewExempt(["docs/script.ts"]), false);
  assertEquals(isReviewExempt([]), false);
});

const me = "vitor";
const codeReview = (rows: string, login = me): PrComment => ({
  author: { login },
  body:
    `## Code Review (Vetor)\n\n| Severidade | Confiança | Arquivo:Linha | Achado |\n|---|---|---|---|\n${rows}\n`,
});
const blockerRow = "| blocker    | alta      | `a.ts:1`      | bug real |";
const warningRow = "| warning    | média     | `a.ts:2`      | risco |";
const sourceFiles = ["scripts/a.ts"];

Deno.test("gate reviews: PR só de docs dispensa as revisões", () => {
  const res = evaluateReviewsGate({ files: ["docs/x.md"], comments: [], viewer: me });
  assertEquals(res.status, "PASS");
});

Deno.test("gate reviews: code review ausente em PR de código é PENDING; autor desconhecido também", () => {
  assertEquals(
    evaluateReviewsGate({ files: sourceFiles, comments: [], viewer: me }).status,
    "PENDING",
  );
  assertEquals(
    evaluateReviewsGate({ files: sourceFiles, comments: [codeReview(warningRow)], viewer: null })
      .status,
    "PENDING",
  );
});

Deno.test("gate reviews: achado blocker reprova; warning e nit não", () => {
  const blocked = evaluateReviewsGate({
    files: sourceFiles,
    comments: [codeReview(`${blockerRow}\n${warningRow}`)],
    viewer: me,
  });
  assertEquals(blocked.status, "FAIL");
  assertStringIncludes(blocked.detail, "1 achado(s) blocker");

  const clean = evaluateReviewsGate({
    files: sourceFiles,
    comments: [codeReview(warningRow)],
    viewer: me,
  });
  assertEquals(clean.status, "PASS");
});

Deno.test("gate reviews: vale o code review mais recente do próprio usuário", () => {
  const blockedThenFixed = evaluateReviewsGate({
    files: sourceFiles,
    comments: [codeReview(blockerRow), codeReview(warningRow)],
    viewer: me,
  });
  assertEquals(blockedThenFixed.status, "PASS");

  const cleanThenBlocked = evaluateReviewsGate({
    files: sourceFiles,
    comments: [codeReview(warningRow), codeReview(blockerRow)],
    viewer: me,
  });
  assertEquals(cleanThenBlocked.status, "FAIL");
});

Deno.test("gate reviews: comentário de outro autor não vale (anti-forja do 'Code Review (Vetor)')", () => {
  const forgedClean = codeReview(warningRow, "estranho");
  // sozinho não satisfaz o gate
  assertEquals(
    evaluateReviewsGate({ files: sourceFiles, comments: [forgedClean], viewer: me }).status,
    "PENDING",
  );
  // e não apaga o blocker real, mesmo sendo mais recente
  assertEquals(
    evaluateReviewsGate({
      files: sourceFiles,
      comments: [codeReview(blockerRow), forgedClean],
      viewer: me,
    }).status,
    "FAIL",
  );
});

Deno.test("gate reviews: security review com severidade alta/crítica reprova; limpo ou ausente passa", () => {
  const security = (text: string): PrComment => ({
    author: { login: me },
    body: `## Security Review (Vetor)\n\n${text}\n`,
  });
  const base = [codeReview(warningRow)];

  for (
    const text of [
      "# Vuln 1: SQLi\n* Severity: High",
      "| Crítica | injeção |",
      "Severidade: Crítica",
    ]
  ) {
    assertEquals(
      evaluateReviewsGate({ files: sourceFiles, comments: [...base, security(text)], viewer: me })
        .status,
      "FAIL",
      text,
    );
  }
  assertEquals(
    evaluateReviewsGate({
      files: sourceFiles,
      comments: [...base, security("Nenhuma vulnerabilidade encontrada.")],
      viewer: me,
    }).status,
    "PASS",
  );
  assertEquals(
    evaluateReviewsGate({ files: sourceFiles, comments: base, viewer: me }).status,
    "PASS",
  );
});

Deno.test("combineGates: FAIL vence PENDING, que vence PASS", () => {
  const g = (status: "PASS" | "FAIL" | "PENDING") => ({ gate: "ci" as const, status, detail: "" });
  assertEquals(combineGates([g("PASS"), g("PASS")]), "PASS");
  assertEquals(combineGates([g("PASS"), g("PENDING")]), "PENDING");
  assertEquals(combineGates([g("PENDING"), g("FAIL"), g("PASS")]), "FAIL");
});

function fakeDeps(pr: unknown | null, migrationCode: number | null = 0): GateDeps {
  return {
    gh(args) {
      if (args[0] === "pr") {
        return Promise.resolve(
          pr === null ? { ok: false, stdout: "" } : { ok: true, stdout: JSON.stringify(pr) },
        );
      }
      return Promise.resolve({ ok: true, stdout: `${me}\n` });
    },
    migrations() {
      return Promise.resolve(migrationCode === null ? null : { code: migrationCode, output: "" });
    },
  };
}

const opts = { pr: "42", worktree: "/wt", defaultBranch: "master" };
const greenPr = {
  statusCheckRollup: [ok],
  mergeable: "MERGEABLE",
  comments: [codeReview(warningRow)],
  files: [{ path: "scripts/a.ts" }],
};

Deno.test("evaluateAutoShipGates: PR verde nos quatro gates devolve PASS na ordem ci, reviews, migrations, mergeable", async () => {
  const results = await evaluateAutoShipGates(opts, fakeDeps(greenPr));
  assertEquals(results.map((r) => r.gate), ["ci", "reviews", "migrations", "mergeable"]);
  assertEquals(combineGates(results), "PASS");
});

Deno.test("evaluateAutoShipGates: um gate vermelho derruba o veredito mesmo com os outros verdes", async () => {
  const conflicting = { ...greenPr, mergeable: "CONFLICTING" };
  assertEquals(combineGates(await evaluateAutoShipGates(opts, fakeDeps(conflicting))), "FAIL");
  assertEquals(combineGates(await evaluateAutoShipGates(opts, fakeDeps(greenPr, 1))), "FAIL");
});

Deno.test("evaluateAutoShipGates: gh indisponível deixa todos os gates PENDING, nunca PASS", async () => {
  const results = await evaluateAutoShipGates(opts, fakeDeps(null));
  assertEquals(results.map((r) => r.status), ["PENDING", "PENDING", "PENDING", "PENDING"]);
  assertEquals(combineGates(results), "PENDING");
});

Deno.test("auto-ship-gates CLI: argumentos inválidos saem com 2", async () => {
  const script = join(Deno.cwd(), "scripts", "auto-ship-gates.ts");
  for (const args of [[], ["abc", "--worktree=/x"], ["42"]]) {
    const { code, stderr } = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", script, ...args],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(code, 2, args.join(" "));
    assertStringIncludes(new TextDecoder().decode(stderr), "uso:");
  }
});
