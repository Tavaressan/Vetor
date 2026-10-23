import { assertEquals } from "@std/assert";
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

Deno.test("AletheAdapter - dispatch, check e release com teto seguro de 50s", async () => {
  const adapter = new AletheAdapter();
  const recordedCalls: { name: string; args: Record<string, unknown> }[] = [];

  const mockToolCaller: ToolCaller = (name, args) => {
    recordedCalls.push({ name, args });
    if (name === "mcp__alethe__alethe_delegate") {
      return Promise.resolve({ job_id: "alethe-job-999" });
    }
    if (name === "mcp__alethe__alethe_check") {
      return Promise.resolve({
        status: "COMPLETED",
        summary: "Concluído sem erros",
      });
    }
    if (name === "mcp__alethe__alethe_release") {
      return Promise.resolve({ ok: true });
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

  assertEquals(handle.jobId, "alethe-job-999");
  assertEquals(recordedCalls[0].name, "mcp__alethe__alethe_delegate");
  assertEquals(recordedCalls[0].args.backend, "codex");

  // Checagem com timeout solicitado de 90s deve ser clampado para 50s (50000ms)
  const checkRes = await adapter.check(handle, { timeoutMs: 90000 }, mockToolCaller);
  assertEquals(checkRes.status, "completed");
  assertEquals(recordedCalls[1].name, "mcp__alethe__alethe_check");
  assertEquals(recordedCalls[1].args.timeoutMs, 50000);

  // Liberação de recursos
  await adapter.release(handle, mockToolCaller);
  assertEquals(recordedCalls[2].name, "mcp__alethe__alethe_release");
  assertEquals(recordedCalls[2].args.job_id, "alethe-job-999");
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
