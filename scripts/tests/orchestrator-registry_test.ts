import { assertEquals } from "@std/assert";
import { OrchestratorRegistry } from "../lib/orchestrator/registry.ts";
import type {
  OrchestratorAdapter,
  OrchestratorCheckResult,
  OrchestratorDispatchInput,
  OrchestratorJobHandle,
  OrchestratorProbeContext,
  ToolCaller,
} from "../lib/orchestrator/types.ts";

function createMockAdapter(
  id: string,
  displayName: string,
  matcher: (ctx: OrchestratorProbeContext) => boolean,
): OrchestratorAdapter {
  return {
    id,
    capabilities: {
      displayName,
      safePollTimeoutMs: 50000,
      requiresExplicitRelease: true,
      supportedWorkers: ["codex", "claude"],
      supportsCancellation: true,
    },
    isAvailable(ctx: OrchestratorProbeContext): boolean {
      return matcher(ctx);
    },
    dispatch(
      input: OrchestratorDispatchInput,
      _toolCaller: ToolCaller,
    ): Promise<OrchestratorJobHandle> {
      return Promise.resolve({
        orchestratorId: id,
        jobId: `job-${id}-123`,
        cwd: input.cwd,
        dispatchedAt: Date.now(),
      });
    },
    check(
      _handle: OrchestratorJobHandle,
      _options: { timeoutMs?: number },
      _toolCaller: ToolCaller,
    ): Promise<OrchestratorCheckResult> {
      return Promise.resolve({
        status: "completed",
        summary: "Mock job concluído com sucesso",
      });
    },
    release(_handle: OrchestratorJobHandle, _toolCaller: ToolCaller): Promise<void> {
      return Promise.resolve();
    },
  };
}

Deno.test("OrchestratorRegistry - cadastro e busca de adaptadores", () => {
  const registry = new OrchestratorRegistry();
  const alethe = createMockAdapter("alethe", "Alethe", () => false);
  const other = createMockAdapter("outro", "Outro", () => false);

  registry.register(alethe).register(other);

  assertEquals(registry.list().length, 2);
  assertEquals(registry.get("alethe")?.id, "alethe");
  assertEquals(registry.get("outro")?.id, "outro");
  assertEquals(registry.get("desconhecido"), undefined);
});

Deno.test("OrchestratorRegistry - detectAvailable filtra adaptadores ativos", () => {
  const registry = new OrchestratorRegistry();
  const alethe = createMockAdapter(
    "alethe",
    "Alethe",
    (ctx) => ctx.tools.includes("mcp__alethe__alethe_delegate"),
  );
  const other = createMockAdapter(
    "outro",
    "Outro",
    (ctx) => ctx.tools.includes("mcp__outro__dispatch"),
  );

  registry.register(alethe).register(other);

  // Nenhum ativo
  assertEquals(
    registry.detectAvailable({ tools: [], env: {} }),
    [],
  );

  // Alethe via tool
  const detectedTool = registry.detectAvailable({
    tools: ["mcp__alethe__alethe_delegate"],
    env: {},
  });
  assertEquals(detectedTool.map((a) => a.id), ["alethe"]);

  // Outro orquestrador via tool
  const detectedOther = registry.detectAvailable({
    tools: ["mcp__outro__dispatch"],
    env: {},
  });
  assertEquals(detectedOther.map((a) => a.id), ["outro"]);

  // Ambos ativos
  const detectedBoth = registry.detectAvailable({
    tools: ["mcp__alethe__alethe_delegate", "mcp__outro__dispatch"],
    env: {},
  });
  assertEquals(detectedBoth.map((a) => a.id), ["alethe", "outro"]);
});

Deno.test("OrchestratorRegistry.select - nenhum disponível -> native", () => {
  const registry = new OrchestratorRegistry();
  const result = registry.select({ available: [], interactive: true });

  assertEquals(result.action, "native");
  assertEquals(result.adapter, undefined);
  assertEquals(
    result.reason,
    "nenhum orquestrador externo disponível; fallback para subagentes nativos",
  );
});

Deno.test("OrchestratorRegistry.select - único disponível sem preferência -> orchestrate direto", () => {
  const registry = new OrchestratorRegistry();
  const alethe = createMockAdapter("alethe", "Alethe", () => true);

  const result = registry.select({ available: [alethe], interactive: false });

  assertEquals(result.action, "orchestrate");
  assertEquals(result.adapter?.id, "alethe");
  assertEquals(result.reason, "único orquestrador disponível");
});

Deno.test("OrchestratorRegistry.select - múltiplos disponíveis sem preferência, interativo -> ask", () => {
  const registry = new OrchestratorRegistry();
  const alethe = createMockAdapter("alethe", "Alethe", () => true);
  const other = createMockAdapter("outro", "Outro", () => true);

  const result = registry.select({
    available: [alethe, other],
    interactive: true,
  });

  assertEquals(result.action, "ask");
  assertEquals(result.adapter, undefined);
  assertEquals(
    result.reason,
    "múltiplos orquestradores disponíveis sem preferência configurada",
  );
});

Deno.test("OrchestratorRegistry.select - múltiplos disponíveis sem preferência, headless -> native", () => {
  const registry = new OrchestratorRegistry();
  const alethe = createMockAdapter("alethe", "Alethe", () => true);
  const other = createMockAdapter("outro", "Outro", () => true);

  const result = registry.select({
    available: [alethe, other],
    interactive: false,
  });

  assertEquals(result.action, "native");
  assertEquals(result.adapter, undefined);
  assertEquals(
    result.reason,
    "múltiplos orquestradores sem preferência em sessão headless; sem anuência possível",
  );
});

Deno.test("OrchestratorRegistry.select - preferência configurada e disponível -> seleciona a preferência", () => {
  const registry = new OrchestratorRegistry();
  const alethe = createMockAdapter("alethe", "Alethe", () => true);
  const other = createMockAdapter("outro", "Outro", () => true);

  const result = registry.select({
    available: [alethe, other],
    preferred: "outro",
    interactive: true,
  });

  assertEquals(result.action, "orchestrate");
  assertEquals(result.adapter?.id, "outro");
  assertEquals(result.reason, "preferência configurada e disponível");
});

Deno.test("OrchestratorRegistry.select - preferência configurada mas indisponível -> fallback nativo seguro", () => {
  const registry = new OrchestratorRegistry();
  const alethe = createMockAdapter("alethe", "Alethe", () => true);

  const result = registry.select({
    available: [alethe],
    preferred: "outro",
    interactive: true,
  });

  assertEquals(result.action, "native");
  assertEquals(result.adapter, undefined);
  assertEquals(
    result.reason,
    "preferência configurada indisponível; fallback nativo sem substituição silenciosa",
  );
});

Deno.test("OrchestratorAdapter - contrato de toolCaller em dispatch, check e release", async () => {
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  const mockToolCaller: ToolCaller = (name, args) => {
    toolCalls.push({ name, args });
    return Promise.resolve({ ok: true });
  };

  const adapter = createMockAdapter("test-orc", "Test Orchestrator", () => true);

  const handle = await adapter.dispatch(
    {
      prompt: "Implemente a issue #482",
      cwd: "C:/Projetos/Vetor/.claude/worktrees/feat-482",
      preferredWorker: "codex",
    },
    mockToolCaller,
  );

  assertEquals(handle.orchestratorId, "test-orc");
  assertEquals(handle.jobId, "job-test-orc-123");
  assertEquals(handle.cwd, "C:/Projetos/Vetor/.claude/worktrees/feat-482");

  const checkRes = await adapter.check(handle, { timeoutMs: 50000 }, mockToolCaller);
  assertEquals(checkRes.status, "completed");

  await adapter.release(handle, mockToolCaller);
});
