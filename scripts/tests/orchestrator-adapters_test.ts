import { assertEquals, assertRejects } from "@std/assert";
import { AletheAdapter } from "../lib/orchestrator/adapters/alethe.ts";
import type { ToolCaller } from "../lib/orchestrator/types.ts";

Deno.test("AletheAdapter - isAvailable só pelo namespace mcp__alethe__*", () => {
  const adapter = new AletheAdapter();

  assertEquals(adapter.isAvailable({ tools: [] }), false);
  assertEquals(
    adapter.isAvailable({ tools: ["mcp__alethe__alethe_delegate"] }),
    true,
  );
  assertEquals(
    adapter.isAvailable({ tools: ["mcp__plugin_vetor_alethe__alethe_delegate"] }),
    true,
  );
  // Nenhuma variável ALETHE* foi observada num worker Codex do Alethe em 2026-10-23
  assertEquals(
    adapter.isAvailable({
      tools: [],
      env: { ALETHE_ORCHESTRATOR: "1", ALETHE_SESSION_ID: "sessao-1" },
    }),
    false,
  );
});

// Respostas no formato observado numa sonda real ao Alethe em 2026-10-23 (job-67)
Deno.test("AletheAdapter - dispatch, check e release no formato real com teto seguro de 50s", async () => {
  const adapter = new AletheAdapter();
  const recordedCalls: { name: string; args: Record<string, unknown> }[] = [];

  const mockToolCaller: ToolCaller = (name, args) => {
    recordedCalls.push({ name, args });
    if (name === "mcp__alethe__alethe_delegate") {
      return Promise.resolve(JSON.stringify({
        accepted: 1,
        runId: "run-51",
        jobs: [{ id: "job-67", spec: "Tarefa Alethe", worktree: null }],
        next: "call alethe_check with wait true",
      }));
    }
    if (name === "mcp__alethe__alethe_check") {
      return Promise.resolve(JSON.stringify({
        deliveries: [{
          seq: 2,
          type: "worker_done",
          jobId: "job-67",
          outcome: "succeeded",
          text: "OK",
        }],
        workersStillBusy: 0,
        note: "every worker settled",
      }));
    }
    if (name === "mcp__alethe__alethe_release") {
      return Promise.resolve(JSON.stringify({ released: ["job-67"] }));
    }
    return Promise.reject(new Error(`Tool inesperada: ${name}`));
  };

  const handle = await adapter.dispatch(
    {
      prompt: "Tarefa Alethe",
      cwd: "C:/worktree/test",
      preferredWorker: "codex",
    },
    mockToolCaller,
  );

  assertEquals(handle.jobId, "job-67");
  assertEquals(recordedCalls[0].name, "mcp__alethe__alethe_delegate");
  assertEquals(recordedCalls[0].args, {
    tasks: ["Tarefa Alethe"],
    cwd: "C:/worktree/test",
    agent: "codex",
  });

  // Checagem com timeout solicitado de 90s deve ser clampado para 50s (50000ms)
  const checkRes = await adapter.check(handle, { timeoutMs: 90000 }, mockToolCaller);
  assertEquals(checkRes.status, "completed");
  assertEquals(checkRes.summary, "OK");
  assertEquals(recordedCalls[1].name, "mcp__alethe__alethe_check");
  assertEquals(recordedCalls[1].args, { wait: true, untilAllSettled: false, timeoutMs: 50000 });

  // Liberação de recursos
  await adapter.release(handle, mockToolCaller);
  assertEquals(recordedCalls[2].name, "mcp__alethe__alethe_release");
  assertEquals(recordedCalls[2].args, { jobIds: ["job-67"] });
});

Deno.test("AletheAdapter - entrega de outro job fica guardada até o check e o release dele", async () => {
  const adapter = new AletheAdapter();
  const handleA = { orchestratorId: "alethe", jobId: "job-a", cwd: "C:/wt/a", dispatchedAt: 0 };
  const handleB = { orchestratorId: "alethe", jobId: "job-b", cwd: "C:/wt/b", dispatchedAt: 0 };
  const checkResponses = [
    { deliveries: [{ type: "worker_done", jobId: "job-b", outcome: "succeeded", text: "B ok" }] },
    { deliveries: [] },
    { deliveries: [] },
    { deliveries: [{ type: "worker_done", jobId: "job-a", outcome: "failed", text: "A falhou" }] },
    { deliveries: [] },
  ];
  const mockToolCaller: ToolCaller = (name) => {
    if (name === "mcp__alethe__alethe_check") return Promise.resolve(checkResponses.shift());
    if (name === "mcp__alethe__alethe_release") return Promise.resolve({ released: ["job-a"] });
    return Promise.reject(new Error(`Tool inesperada: ${name}`));
  };

  // O check de A consome a entrega de B, que não pode se perder
  assertEquals((await adapter.check(handleA, {}, mockToolCaller)).status, "running");
  assertEquals((await adapter.check(handleB, {}, mockToolCaller)).status, "completed");
  assertEquals((await adapter.check(handleB, {}, mockToolCaller)).status, "completed");

  const failed = await adapter.check(handleA, {}, mockToolCaller);
  assertEquals(failed.status, "failed");
  assertEquals(failed.error, "A falhou");

  await adapter.release(handleA, mockToolCaller);
  assertEquals((await adapter.check(handleA, {}, mockToolCaller)).status, "running");
});

Deno.test("AletheAdapter - dispatch rejeita worker fora de supportedWorkers", async () => {
  const adapter = new AletheAdapter();
  const recordedCalls: string[] = [];
  const mockToolCaller: ToolCaller = (name) => {
    recordedCalls.push(name);
    return Promise.resolve({});
  };

  await assertRejects(
    () =>
      adapter.dispatch(
        { prompt: "Tarefa", cwd: "C:/wt", preferredWorker: "haiku" },
        mockToolCaller,
      ),
    Error,
    'Alethe não suporta o worker "haiku"',
  );
  assertEquals(recordedCalls, []);
});

Deno.test("AletheAdapter - cancel chama alethe_cancel com jobIds", async () => {
  const adapter = new AletheAdapter();
  const recordedCalls: { name: string; args: Record<string, unknown> }[] = [];
  const mockToolCaller: ToolCaller = (name, args) => {
    recordedCalls.push({ name, args });
    return Promise.resolve({});
  };

  await adapter.cancel(
    { orchestratorId: "alethe", jobId: "job-c", cwd: "C:/wt/c", dispatchedAt: 0 },
    mockToolCaller,
  );
  assertEquals(recordedCalls, [{
    name: "mcp__alethe__alethe_cancel",
    args: { jobIds: ["job-c"] },
  }]);
});
