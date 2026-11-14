import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  appendRoutingRecord,
  readRoutingLog,
  routingLogPath,
  sanitizeRoutingRecord,
} from "./routing-log.ts";
import type { ExecutionOutcome, RoutingDecision } from "./types.ts";

function decision(attempt = 0): RoutingDecision {
  return {
    decisionVersion: 1,
    decisionId: `656#${attempt}`,
    decidedAt: "2026-11-13T00:00:00.000Z",
    taskId: "656",
    attempt,
    policyMode: "assisted",
    action: "delegate",
    selected: { executorId: "claude", mode: "cli" },
    profile: {
      operations: ["edit"],
      domains: ["scripts"],
      dataSensitivity: "unknown",
      requirements: { browser: false, mcp: false },
      provenance: {
        operations: "derived",
        domains: "derived",
        complexity: "derived",
        risk: "derived",
        requirements: "default",
        dataSensitivity: "default",
      },
    },
    candidates: [
      { executorId: "claude", verdict: "selected", detail: "ok", evidence: { mcp: "declared" } },
      {
        executorId: "codex",
        verdict: "rejected",
        rejectedBy: "authorization",
        detail: "fora de authorizedExecutors",
        evidence: {},
      },
    ],
    restrictions: ["dataSensitivity=unknown"],
    reasons: ["sem restrições"],
  };
}

function outcome(): ExecutionOutcome {
  return {
    outcomeVersion: 1,
    decisionId: "656#0",
    finishedAt: "2026-11-13T00:01:00.000Z",
    status: "succeeded",
    durationMs: 60000,
    retryCount: 0,
    fallbackUsed: false,
    humanIntervention: false,
    validation: "passed",
  };
}

function statusEntries(root: string): string[] {
  return Array.from(Deno.readDirSync(`${root}/.claude/vetor/status`)).map((e) => e.name);
}

Deno.test("routingLogPath aponta para .claude/vetor/status/routing-log.jsonl", () => {
  assertEquals(routingLogPath("/r"), "/r/.claude/vetor/status/routing-log.jsonl");
});

Deno.test("append grava uma linha por registro, ligados por decisionId", () => {
  const root = Deno.makeTempDirSync();
  try {
    const path = routingLogPath(root);
    appendRoutingRecord(path, decision());
    appendRoutingRecord(path, outcome());
    const records = readRoutingLog(path);
    assertEquals(records.length, 2);
    assertEquals(records[0], decision());
    assertEquals(records[1], outcome());
    assertEquals(records[0].decisionId, records[1].decisionId);
    assertEquals(statusEntries(root), ["routing-log.jsonl"]);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("leitura de log inexistente devolve lista vazia", () => {
  assertEquals(readRoutingLog("/nao/existe/routing-log.jsonl"), []);
});

Deno.test("duas escritas concorrentes não perdem nem misturam linhas", async () => {
  const root = Deno.makeTempDirSync();
  try {
    const path = routingLogPath(root);
    const url = new URL("./routing-log.ts", import.meta.url).href;
    const script = `
      import { appendRoutingRecord } from ${JSON.stringify(url)};
      const [path, prefix] = Deno.args;
      for (let i = 0; i < 25; i++) {
        appendRoutingRecord(path, {
          outcomeVersion: 1, decisionId: prefix + "#" + i, finishedAt: "x",
          status: "succeeded", retryCount: 0, fallbackUsed: false, humanIntervention: false,
          model: "m".repeat(5000),
        });
      }`;
    const run = (prefix: string) =>
      new Deno.Command(Deno.execPath(), {
        args: ["eval", "--ext=ts", script, path, prefix],
        stdout: "null",
        stderr: "piped",
      }).output();
    const results = await Promise.all([run("a"), run("b")]);
    for (const r of results) {
      assert(r.success, new TextDecoder().decode(r.stderr));
    }
    const lines = Deno.readTextFileSync(path).trim().split("\n");
    assertEquals(lines.length, 50);
    const ids = new Set(lines.map((l) => JSON.parse(l).decisionId));
    assertEquals(ids.size, 50);
    assertEquals(statusEntries(root), ["routing-log.jsonl"]);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("campos proibidos e paths absolutos nunca são gravados", () => {
  const root = Deno.makeTempDirSync();
  try {
    const path = routingLogPath(root);
    const dirty = {
      ...decision(),
      prompt: "SEGREDO-PROMPT",
      cwd: "/home/alguem/projeto",
      issueBody: "SEGREDO-CORPO",
      body: "SEGREDO-CORPO",
      reasons: ["rodou em /home/alguem/projeto/x e C:\\Users\\a\\b"],
    } as RoutingDecision;
    dirty.candidates[0].detail = "cwd=/home/alguem/projeto";
    (dirty.candidates[0] as unknown as Record<string, unknown>).prompt = "SEGREDO-PROMPT";
    (dirty.profile as unknown as Record<string, unknown>).body = "SEGREDO-CORPO";
    const dirtyOutcome = {
      ...outcome(),
      model: "/opt/modelos/x",
      cwd: "/home/alguem",
      prompt: "SEGREDO-PROMPT",
    } as ExecutionOutcome;
    appendRoutingRecord(path, dirty);
    appendRoutingRecord(path, dirtyOutcome);
    const raw = Deno.readTextFileSync(path);
    for (const forbidden of ["SEGREDO", "/home/", "/opt/", "Users", '"cwd"', '"prompt"']) {
      assertFalse(raw.includes(forbidden), `contém ${forbidden}`);
    }
    const [d] = readRoutingLog(path);
    assertFalse("issueBody" in d);
    assert(raw.includes("[path-redacted]"));
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("sanitize preserva campos opcionais ausentes como ausentes", () => {
  const d = decision();
  delete d.selected;
  const s = sanitizeRoutingRecord(d) as RoutingDecision;
  assertFalse("selected" in s);
  assertFalse("rejectedBy" in s.candidates[0]);
});
