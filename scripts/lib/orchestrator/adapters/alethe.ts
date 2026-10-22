/**
 * Adaptador para o orquestrador Alethe (issue #451, issue #482).
 *
 * Mapeia as ferramentas canônicas do Alethe (mcp__alethe__*), impondo isolamento
 * de worktree, teto estrito de polling (timeoutMs <= 50s) e liberação prévia
 * obrigatória de recursos.
 */

import { matchesMcpServer } from "../../mcp.ts";
import type {
  JobExecutionStatus,
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

export class AletheAdapter implements OrchestratorAdapter {
  readonly id = ALETHE_ADAPTER_ID;
  readonly capabilities = ALETHE_CAPABILITIES;

  isAvailable(context: OrchestratorProbeContext): boolean {
    // 1. In-harness: presença de qualquer ferramenta do servidor MCP 'alethe'
    const hasTool = context.tools.some((tool) => matchesMcpServer(tool, "alethe"));
    if (hasTool) return true;

    // 2. Out-of-harness: presença de variáveis de ambiente injetadas pelo Alethe
    const env = context.env ?? {};
    return Boolean(env.ALETHE_ORCHESTRATOR || env.ALETHE_SESSION_ID);
  }

  async dispatch(
    input: OrchestratorDispatchInput,
    toolCaller: ToolCaller,
  ): Promise<OrchestratorJobHandle> {
    const rawResult = await toolCaller("mcp__alethe__alethe_delegate", {
      prompt: input.prompt,
      cwd: input.cwd,
      backend: input.preferredWorker ?? "codex",
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });

    const jobId = extractJobId(rawResult);
    if (!jobId) {
      throw new Error("Alethe delegate não retornou um job_id válido");
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

    const raw = await toolCaller("mcp__alethe__alethe_check", {
      job_id: handle.jobId,
      timeoutMs,
    });

    const status = normalizeAletheStatus(raw);
    const summary = extractSummary(raw);
    const error = extractError(raw);

    return {
      status,
      summary,
      error,
      rawOutput: raw,
    };
  }

  async release(
    handle: OrchestratorJobHandle,
    toolCaller: ToolCaller,
  ): Promise<void> {
    await toolCaller("mcp__alethe__alethe_release", {
      job_id: handle.jobId,
    });
  }

  async cancel(
    handle: OrchestratorJobHandle,
    toolCaller: ToolCaller,
  ): Promise<void> {
    // Alethe release também encerra/cancela jobs ativos associados
    await this.release(handle, toolCaller);
  }
}

function extractJobId(output: unknown): string | null {
  if (typeof output === "string") {
    // Pode vir como JSON serializado ou string direta
    try {
      const parsed = JSON.parse(output);
      if (typeof parsed?.job_id === "string") return parsed.job_id;
      if (typeof parsed?.id === "string") return parsed.id;
    } catch {
      if (output.trim()) return output.trim();
    }
  }

  if (typeof output === "object" && output !== null) {
    const record = output as Record<string, unknown>;
    if (typeof record.job_id === "string") return record.job_id;
    if (typeof record.id === "string") return record.id;
  }

  return null;
}

function normalizeAletheStatus(output: unknown): JobExecutionStatus {
  if (typeof output !== "object" || output === null) {
    return "running";
  }

  const record = output as Record<string, unknown>;
  const rawStatus = String(record.status ?? record.state ?? "").toLowerCase().trim();

  switch (rawStatus) {
    case "completed":
    case "done":
    case "finished":
    case "success":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
    case "aborted":
      return "cancelled";
    case "running":
    case "in_progress":
      return "running";
    case "queued":
    case "pending":
      return "queued";
    default:
      return "running";
  }
}

function extractSummary(output: unknown): string | undefined {
  if (typeof output === "object" && output !== null) {
    const record = output as Record<string, unknown>;
    if (typeof record.summary === "string") return record.summary;
    if (typeof record.message === "string") return record.message;
    if (typeof record.output === "string") return record.output;
  }
  return undefined;
}

function extractError(output: unknown): string | undefined {
  if (typeof output === "object" && output !== null) {
    const record = output as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    if (typeof record.details === "string") return record.details;
  }
  return undefined;
}
