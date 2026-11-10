import { assertEquals, assertStringIncludes } from "@std/assert";
import { labelRuns, signatureOf, summarizeLog } from "../collect-real-failures.ts";

function run(over: Record<string, unknown>) {
  return {
    databaseId: 1,
    workflowName: "CI",
    headBranch: "feat/x",
    headSha: "aaa",
    event: "pull_request",
    createdAt: "2026-11-01T00:00:00Z",
    attempt: 1,
    conclusion: "failure",
    status: "completed",
    url: "https://example.invalid/run",
    ...over,
  };
}
const neverCalled = () => {
  throw new Error("não deveria consultar tentativas");
};

Deno.test("labelRuns: run posterior com o mesmo commit que passou → retry_operation", async () => {
  const cases = await labelRuns("o/r", [
    run({ databaseId: 1 }),
    run({ databaseId: 2, createdAt: "2026-11-01T01:00:00Z", conclusion: "success" }),
  ], neverCalled);
  assertEquals(cases.map((c) => c.expected), ["retry_operation"]);
});

Deno.test("labelRuns: próximo sucesso com outro commit → inspect_failure", async () => {
  const cases = await labelRuns("o/r", [
    run({ databaseId: 1 }),
    run({
      databaseId: 2,
      createdAt: "2026-11-01T01:00:00Z",
      headSha: "bbb",
      conclusion: "failure",
    }),
    run({
      databaseId: 3,
      createdAt: "2026-11-01T02:00:00Z",
      headSha: "ccc",
      conclusion: "success",
    }),
  ], neverCalled);
  assertEquals(cases.map((c) => c.expected), ["inspect_failure", "inspect_failure"]);
});

Deno.test("labelRuns: nada passou depois → unresolved", async () => {
  const cases = await labelRuns("o/r", [run({})], neverCalled);
  assertEquals(cases.map((c) => c.expected), ["unresolved"]);
});

Deno.test("labelRuns: tentativa falha de um run que passou no re-run → retry_operation", async () => {
  const cases = await labelRuns(
    "o/r",
    [run({ attempt: 2, conclusion: "success" })],
    () => Promise.resolve("failure"),
  );
  assertEquals(cases.map((c) => [c.attempt, c.expected]), [[1, "retry_operation"]]);
});

Deno.test("labelRuns: branches e workflows diferentes não se misturam", async () => {
  const cases = await labelRuns("o/r", [
    run({ databaseId: 1 }),
    run({
      databaseId: 2,
      createdAt: "2026-11-01T01:00:00Z",
      headBranch: "outra",
      conclusion: "success",
    }),
  ], neverCalled);
  assertEquals(cases.map((c) => c.expected), ["unresolved"]);
});

Deno.test("summarizeLog tira o prefixo do gh, o timestamp e as cores, e mascara segredo", () => {
  const log = [
    "build\tRun tests\t2026-11-01T00:00:00.000Z \x1b[31merror: boom\x1b[0m",
    "build\tRun tests\t2026-11-01T00:00:01.000Z ^[[1mtoken=abc123def456^[[0m failed",
    "build\tRun tests\t2026-11-01T00:00:02.000Z ##[error]Process completed with exit code 1.",
  ].join("\n");
  const summary = summarizeLog(log);
  assertEquals(summary.includes("\x1b"), false);
  assertEquals(summary.includes("^[["), false);
  assertEquals(summary.includes("2026-11-01T"), false);
  assertStringIncludes(summary, "error: boom");
  assertStringIncludes(summary, "[REDACTED]");
});

Deno.test("signatureOf ignora a linha genérica de exit code e normaliza números", () => {
  assertEquals(
    signatureOf(
      "error: Found 6 not formatted files in 164 files\n##[error]Process completed with exit code 1.",
    ),
    "error: Found N not formatted files in N files",
  );
  assertEquals(
    signatureOf("##[error]Could not resolve host: github.com"),
    "Could not resolve host: github.com",
  );
});
