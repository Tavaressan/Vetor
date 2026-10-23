import { assertEquals, assertRejects } from "@std/assert";
import { AletheAdapter } from "../lib/orchestrator/adapters/alethe.ts";
import { OrcaAdapter } from "../lib/orchestrator/adapters/orca.ts";
import { GenericMcpAdapter } from "../lib/orchestrator/adapters/generic-mcp.ts";
import type { ToolCaller } from "../lib/orchestrator/types.ts";

Deno.test("AletheAdapter - isAvailable por namespace e env", () => {
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
  assertEquals(
    adapter.isAvailable({ tools: [], env: { ALETHE_ORCHESTRATOR: "1" } }),
    true,
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

Deno.test("OrcaAdapter - isAvailable por namespace e env", () => {
  const adapter = new OrcaAdapter();

  assertEquals(adapter.isAvailable({ tools: [] }), false);
  assertEquals(
    adapter.isAvailable({ tools: ["mcp__orca__task_dispatch"] }),
    true,
  );
  assertEquals(
    adapter.isAvailable({ tools: [], env: { ORCA_ACTIVE: "1" } }),
    true,
  );
});

Deno.test("OrcaAdapter - dispatch, check e release", async () => {
  const adapter = new OrcaAdapter();
  const recordedCalls: { name: string; args: Record<string, unknown> }[] = [];

  const mockToolCaller: ToolCaller = (name, args) => {
    recordedCalls.push({ name, args });
    if (name === "mcp__orca__task_dispatch") {
      return Promise.resolve({ task_id: "orca-task-777" });
    }
    if (name === "mcp__orca__task_check") {
      return Promise.resolve({
        status: "success",
        message: "Orca finalizou a tarefa",
      });
    }
    if (name === "mcp__orca__task_release") {
      return Promise.resolve({ released: true });
    }
    return Promise.reject(new Error(`Tool inesperada: ${name}`));
  };

  const handle = await adapter.dispatch(
    {
      prompt: "Tarefa Orca",
      cwd: "C:/worktree/orca",
      preferredWorker: "claude",
    },
    mockToolCaller,
  );

  assertEquals(handle.jobId, "orca-task-777");
  assertEquals(recordedCalls[0].name, "mcp__orca__task_dispatch");

  const checkRes = await adapter.check(handle, {}, mockToolCaller);
  assertEquals(checkRes.status, "completed");
  assertEquals(checkRes.summary, "Orca finalizou a tarefa");

  await adapter.release(handle, mockToolCaller);
  assertEquals(recordedCalls[2].name, "mcp__orca__task_release");
});

Deno.test("GenericMcpAdapter - configuração arbitrária e execução", async () => {
  const generic = new GenericMcpAdapter({
    id: "custom-swarm",
    dispatchTool: "mcp__custom__dispatch",
    checkTool: "mcp__custom__poll",
    releaseTool: "mcp__custom__destroy",
  });

  assertEquals(generic.isAvailable({ tools: [] }), false);
  assertEquals(generic.isAvailable({ tools: ["mcp__custom__dispatch"] }), true);

  const recordedCalls: { name: string; args: Record<string, unknown> }[] = [];
  const mockToolCaller: ToolCaller = (name, args) => {
    recordedCalls.push({ name, args });
    if (name === "mcp__custom__dispatch") return Promise.resolve({ id: "custom-job-1" });
    if (name === "mcp__custom__poll") return Promise.resolve({ state: "running" });
    if (name === "mcp__custom__destroy") return Promise.resolve({ ok: true });
    return Promise.reject(new Error("Unknown tool"));
  };

  const handle = await generic.dispatch(
    { prompt: "Tarefa custom", cwd: "C:/worktree/custom" },
    mockToolCaller,
  );
  assertEquals(handle.jobId, "custom-job-1");

  const checkRes = await generic.check(handle, {}, mockToolCaller);
  assertEquals(checkRes.status, "running");

  await generic.release(handle, mockToolCaller);
  assertEquals(recordedCalls[2].name, "mcp__custom__destroy");
});
