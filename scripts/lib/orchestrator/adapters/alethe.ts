/**
 * Adaptador para o orquestrador Alethe (issue #451, issue #482).
 *
 * Mapeia as ferramentas canônicas do Alethe (mcp__alethe__*), impondo isolamento
 * de worktree, teto estrito de polling (timeoutMs <= 50s) e liberação prévia
 * obrigatória de recursos.
 *
 * Formato das respostas observado em 2026-10-23 numa sonda real (job-67):
 * - alethe_delegate → { accepted, runId, runningInParallel, concurrencyLimit, isolated,
 *   timeoutSeconds, jobs: [{ id, spec, worktree }], next }
 * - alethe_check → { deliveries: [{ seq, type: "worker_done", jobId, outcome: "succeeded", text }],
 *   workersStillBusy, note }
 * - alethe_release → { released: [id] }
 * O alethe_check é global à sessão e entrega cada resultado uma única vez.
 */

import { matchesMcpServer } from "../../mcp.ts";
import type {
  OrchestratorAdapter,
  OrchestratorCapabilities,
  OrchestratorCheckResult,
  OrchestratorDispatchInput,
  OrchestratorJobHandle,
  OrchestratorProbeContext,
  ToolCaller,
} from "../types.ts";

export const ALETHE_ADAPTER_ID = "alethe";

export const ALETHE_CAPABILITIES: OrchestratorCapabilities = {
  displayName: "Alethe Orchestrator",
  safePollTimeoutMs: 50000, // Teto estrito de 50s para evitar timeout do transporte MCP (Spike #451)
  requiresExplicitRelease: true, // Obrigatório para evitar "Device or resource busy" no worktree
  supportedWorkers: ["codex", "claude"],
  supportsCancellation: true,
};

interface AletheDelivery {
  type: string;
  jobId: string;
  outcome?: string | null;
  text?: string;
}

export class AletheAdapter implements OrchestratorAdapter {
  readonly id = ALETHE_ADAPTER_ID;
  readonly capabilities = ALETHE_CAPABILITIES;
  // Entregas já consumidas do alethe_check, guardadas por job até o release
  private readonly deliveries = new Map<string, AletheDelivery>();

  isAvailable(context: OrchestratorProbeContext): boolean {
    // Só o namespace mcp__alethe__*: nenhuma variável ALETHE* foi observada num worker
    // Codex do Alethe em 2026-10-23, então env não é sinal de presença.
    return context.tools.some((tool) => matchesMcpServer(tool, "alethe"));
  }

  async dispatch(
    input: OrchestratorDispatchInput,
    toolCaller: ToolCaller,
  ): Promise<OrchestratorJobHandle> {
    const agent = input.preferredWorker ?? "codex";
    if (!this.capabilities.supportedWorkers.includes(agent)) {
      throw new Error(
        `Alethe não suporta o worker "${agent}" (aceita: ${
          this.capabilities.supportedWorkers.join(", ")
        })`,
      );
    }

    const raw = parseToolResult(
      await toolCaller("mcp__alethe__alethe_delegate", {
        tasks: [input.prompt],
        cwd: input.cwd,
        agent,
      }),
    );

    const jobId = extractJobId(raw);
    if (!jobId) {
      throw new Error("Alethe delegate não retornou um id de job em jobs[0].id");
    }

    return {
      orchestratorId: this.id,
      jobId,
      cwd: input.cwd,
      dispatchedAt: Date.now(),
    };
  }

  async check(
    handle: OrchestratorJobHandle,
    options: { timeoutMs?: number },
    toolCaller: ToolCaller,
  ): Promise<OrchestratorCheckResult> {
    // Clamping rígido no teto seguro de 50s
    const timeoutMs = Math.min(
      options.timeoutMs ?? this.capabilities.safePollTimeoutMs,
      this.capabilities.safePollTimeoutMs,
    );

    // untilAllSettled: false devolve na primeira entrega, sem esperar os demais jobs
    const raw = parseToolResult(
      await toolCaller("mcp__alethe__alethe_check", {
        wait: true,
        untilAllSettled: false,
        timeoutMs,
      }),
    );

    // Guarda as entregas de outros jobs, que o alethe_check não repete
    for (const delivery of extractDeliveries(raw)) {
      this.deliveries.set(delivery.jobId, delivery);
    }

    const delivery = this.deliveries.get(handle.jobId);
    if (!delivery) return { status: "running", rawOutput: raw };
    if (delivery.type !== "worker_done") {
      return { status: "running", summary: delivery.text, rawOutput: raw };
    }
    if (delivery.outcome === "succeeded") {
      return { status: "completed", summary: delivery.text, rawOutput: raw };
    }
    return {
      status: "failed",
      error: delivery.text ?? `outcome: ${delivery.outcome}`,
      rawOutput: raw,
    };
  }

  async release(
    handle: OrchestratorJobHandle,
    toolCaller: ToolCaller,
  ): Promise<void> {
    await toolCaller("mcp__alethe__alethe_release", {
      jobIds: [handle.jobId],
    });
    this.deliveries.delete(handle.jobId);
  }

  async cancel(
    handle: OrchestratorJobHandle,
    toolCaller: ToolCaller,
  ): Promise<void> {
    await toolCaller("mcp__alethe__alethe_cancel", {
      jobIds: [handle.jobId],
    });
  }
}

// O resultado de uma ferramenta MCP chega como texto JSON
function parseToolResult(output: unknown): unknown {
  return typeof output === "string" ? JSON.parse(output) : output;
}

function extractJobId(output: unknown): string | null {
  const jobs = (output as { jobs?: { id?: unknown }[] } | null)?.jobs;
  const id = Array.isArray(jobs) ? jobs[0]?.id : undefined;
  return typeof id === "string" ? id : null;
}

function extractDeliveries(output: unknown): AletheDelivery[] {
  const deliveries = (output as { deliveries?: unknown } | null)?.deliveries;
  if (!Array.isArray(deliveries)) return [];
  return deliveries.filter((delivery): delivery is AletheDelivery =>
    typeof delivery?.jobId === "string" && typeof delivery?.type === "string"
  );
}
