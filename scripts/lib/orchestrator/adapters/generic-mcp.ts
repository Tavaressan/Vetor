/**
 * Adaptador configurável para servidores MCP genéricos (issue #482).
 *
 * Permite que novos orquestradores MCP sejam consumidos pelo Vetor
 * através de declarações de ferramentas no .claude/vetor/config.json.
 */

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

export interface GenericMcpAdapterOptions {
  id: string;
  displayName?: string;
  dispatchTool: string;
  checkTool: string;
  releaseTool: string;
  cancelTool?: string;
  maxTimeoutMs?: number;
  requiresExplicitRelease?: boolean;
}

export class GenericMcpAdapter implements OrchestratorAdapter {
  readonly id: string;
  readonly capabilities: OrchestratorCapabilities;
  readonly options: GenericMcpAdapterOptions;

  constructor(options: GenericMcpAdapterOptions) {
    this.id = options.id;
    this.options = options;
    this.capabilities = {
      displayName: options.displayName ?? `MCP Orchestrator (${options.id})`,
      safePollTimeoutMs: options.maxTimeoutMs ?? 50000,
      requiresExplicitRelease: options.requiresExplicitRelease ?? true,
      supportedWorkers: ["default"],
      supportsCancellation: Boolean(options.cancelTool),
    };
  }

  isAvailable(context: OrchestratorProbeContext): boolean {
    return context.tools.includes(this.options.dispatchTool);
  }

  async dispatch(
    input: OrchestratorDispatchInput,
    toolCaller: ToolCaller,
  ): Promise<OrchestratorJobHandle> {
    const rawResult = await toolCaller(this.options.dispatchTool, {
      prompt: input.prompt,
      cwd: input.cwd,
      ...(input.preferredWorker ? { worker: input.preferredWorker } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });

    const jobId = extractGenericJobId(rawResult);
    if (!jobId) {
      throw new Error(
        `Generic MCP orchestrator '${this.id}' não retornou um ID de tarefa válido na chamada a ${this.options.dispatchTool}`,
      );
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

    const raw = await toolCaller(this.options.checkTool, {
      job_id: handle.jobId,
      id: handle.jobId,
      timeout_ms: timeoutMs,
      timeoutMs,
    });

    return {
      status: normalizeGenericStatus(raw),
      summary: extractGenericSummary(raw),
      error: extractGenericError(raw),
      rawOutput: raw,
    };
  }

  async release(
    handle: OrchestratorJobHandle,
    toolCaller: ToolCaller,
  ): Promise<void> {
    await toolCaller(this.options.releaseTool, {
      job_id: handle.jobId,
      id: handle.jobId,
    });
  }

  async cancel(
    handle: OrchestratorJobHandle,
    toolCaller: ToolCaller,
  ): Promise<void> {
    if (this.options.cancelTool) {
      await toolCaller(this.options.cancelTool, {
        job_id: handle.jobId,
        id: handle.jobId,
      });
    } else {
      await this.release(handle, toolCaller);
    }
  }
}

function extractGenericJobId(output: unknown): string | null {
  if (typeof output === "string") {
    try {
      const parsed = JSON.parse(output);
      if (typeof parsed?.job_id === "string") return parsed.job_id;
      if (typeof parsed?.task_id === "string") return parsed.task_id;
      if (typeof parsed?.id === "string") return parsed.id;
    } catch {
      if (output.trim()) return output.trim();
    }
  }

  if (typeof output === "object" && output !== null) {
    const record = output as Record<string, unknown>;
    if (typeof record.job_id === "string") return record.job_id;
    if (typeof record.task_id === "string") return record.task_id;
    if (typeof record.id === "string") return record.id;
  }

  return null;
}

function normalizeGenericStatus(output: unknown): JobExecutionStatus {
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
      return "failed";
    case "cancelled":
    case "canceled":
    case "aborted":
      return "cancelled";
    case "running":
    case "active":
      return "running";
    case "queued":
    case "pending":
      return "queued";
    default:
      return "running";
  }
}

function extractGenericSummary(output: unknown): string | undefined {
  if (typeof output === "object" && output !== null) {
    const record = output as Record<string, unknown>;
    if (typeof record.summary === "string") return record.summary;
    if (typeof record.message === "string") return record.message;
  }
  return undefined;
}

function extractGenericError(output: unknown): string | undefined {
  if (typeof output === "object" && output !== null) {
    const record = output as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
  }
  return undefined;
}
