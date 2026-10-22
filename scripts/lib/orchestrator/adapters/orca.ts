/**
 * Adaptador para o orquestrador Orca (issue #482).
 *
 * Mapeia as ferramentas do ecossistema Orca (mcp__orca__*), normalizando a execução
 * de tarefas assíncronas com isolamento de diretório, polling seguro e liberação de recursos.
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

export const ORCA_ADAPTER_ID = "orca";

export const ORCA_CAPABILITIES: OrchestratorCapabilities = {
  displayName: "Orca Orchestrator",
  safePollTimeoutMs: 50000,
  requiresExplicitRelease: true,
  supportedWorkers: ["claude", "gpt", "codex", "gemini"],
  supportsCancellation: true,
};

export class OrcaAdapter implements OrchestratorAdapter {
  readonly id = ORCA_ADAPTER_ID;
  readonly capabilities = ORCA_CAPABILITIES;

  isAvailable(context: OrchestratorProbeContext): boolean {
    // 1. In-harness: presença de qualquer ferramenta do servidor MCP 'orca'
    const hasTool = context.tools.some((tool) => matchesMcpServer(tool, "orca"));
    if (hasTool) return true;

    // 2. Out-of-harness: variáveis de ambiente injetadas pelo runtime Orca
    const env = context.env ?? {};
    return Boolean(env.ORCA_ACTIVE || env.ORCA_ORCHESTRATOR_ACTIVE || env.ORCA_TASK_ID);
  }

  async dispatch(
    input: OrchestratorDispatchInput,
    toolCaller: ToolCaller,
  ): Promise<OrchestratorJobHandle> {
    const rawResult = await toolCaller("mcp__orca__task_dispatch", {
      instruction: input.prompt,
      workdir: input.cwd,
      worker: input.preferredWorker ?? "claude",
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });

    const jobId = extractOrcaTaskId(rawResult);
    if (!jobId) {
      throw new Error("Orca task_dispatch não retornou um task_id/job_id válido");
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
    const timeoutMs = Math.min(
      options.timeoutMs ?? this.capabilities.safePollTimeoutMs,
      this.capabilities.safePollTimeoutMs,
    );

    const raw = await toolCaller("mcp__orca__task_check", {
      task_id: handle.jobId,
      timeout_ms: timeoutMs,
    });

    return {
      status: normalizeOrcaStatus(raw),
      summary: extractSummary(raw),
      error: extractError(raw),
      rawOutput: raw,
    };
  }

  async release(
    handle: OrchestratorJobHandle,
    toolCaller: ToolCaller,
  ): Promise<void> {
    await toolCaller("mcp__orca__task_release", {
      task_id: handle.jobId,
    });
  }

  async cancel(
    handle: OrchestratorJobHandle,
    toolCaller: ToolCaller,
  ): Promise<void> {
    await toolCaller("mcp__orca__task_abort", {
      task_id: handle.jobId,
    }).catch(() => {
      // Se não houver task_abort específico, executa task_release
      return this.release(handle, toolCaller);
    });
  }
}

function extractOrcaTaskId(output: unknown): string | null {
  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output);
      if (typeof parsed?.task_id === "string") return parsed.task_id;
      if (typeof parsed?.job_id === "string") return parsed.job_id;
      if (typeof parsed?.id === "string") return parsed.id;
    } catch {
      if (output.trim()) return output.trim();
    }
  }

  if (typeof output === "object" && output !== null) {
    const record = output as Record<string, unknown>;
    if (typeof record.task_id === "string") return record.task_id;
    if (typeof record.job_id === "string") return record.job_id;
    if (typeof record.id === "string") return record.id;
  }

  return null;
}

function normalizeOrcaStatus(output: unknown): JobExecutionStatus {
  if (typeof output !== "object" || output === null) {
    return "running";
  }

  const record = output as Record<string, unknown>;
  const rawStatus = String(record.status ?? record.state ?? "").toLowerCase().trim();

  switch (rawStatus) {
    case "completed":
    case "done":
    case "success":
    case "finished":
      return "completed";
    case "failed":
    case "error":
    case "crashed":
      return "failed";
    case "cancelled":
    case "aborted":
      return "cancelled";
    case "running":
    case "active":
    case "processing":
      return "running";
    case "queued":
    case "pending":
    case "waiting":
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
    if (typeof record.result === "string") return record.result;
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
