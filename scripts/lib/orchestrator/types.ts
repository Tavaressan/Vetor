/**
 * Tipos e interfaces normativos para runtimes orquestradores (issue #482).
 *
 * Define o contrato polimórfico para orquestradores de agentes externos (como Alethe, Orca
 * e servidores MCP genéricos), ampliando a capacidade de delegação além de CLIs síncronos
 * efêmeros (issue #247) com suporte a tarefas assíncronas com isolamento de worktree.
 */

/**
 * Estado padronizado de execução de um job assíncrono em qualquer orquestrador.
 */
export type JobExecutionStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Capacidades e limites operacionais declarados pelo orquestrador.
 */
export interface OrchestratorCapabilities {
  /** Nome amigável de exibição (ex.: "Alethe Multiplexer", "Orca Agent Swarm") */
  readonly displayName: string;
  /** Teto seguro para timeoutMs em chamadas de polling (ex.: 50_000ms para evitar timeout de transporte MCP) */
  readonly safePollTimeoutMs: number;
  /** Se o orquestrador exige chamada explícita de liberação de recursos antes do cleanup do worktree */
  readonly requiresExplicitRelease: boolean;
  /** Lista de runtimes/modelos suportados pelo orquestrador (ex.: ["codex", "claude", "gemini"]) */
  readonly supportedWorkers: string[];
  /** Se o orquestrador suporta cancelamento ativo de tarefas */
  readonly supportsCancellation: boolean;
}

/**
 * Dados de entrada enviados para despacho de uma tarefa isolada.
 */
export interface OrchestratorDispatchInput {
  /** Prompt autocontido com requisitos da issue, critérios de aceite e instruções */
  prompt: string;
  /** Caminho absoluto do worktree isolado da tarefa (obrigatório para isolamento) */
  cwd: string;
  /** Modelo ou worker sugerido (ex.: "codex", "claude", "haiku") */
  preferredWorker?: string;
  /** Metadados contextuais adicionais (ex.: issue numbers, branch, labels) */
  metadata?: Record<string, unknown>;
}

/**
 * Identificador opaco retornado após despacho bem-sucedido.
 */
export interface OrchestratorJobHandle {
  /** Identificador do orquestrador de origem (ex.: "alethe", "orca") */
  readonly orchestratorId: string;
  /** ID único do job retornado pelo orquestrador (ex.: job_id, task_id) */
  readonly jobId: string;
  /** Worktree associado a esta execução */
  readonly cwd: string;
  /** Timestamp (epoch ms) do despacho */
  readonly dispatchedAt: number;
}

/**
 * Resultado da checagem de progresso de um job.
 */
export interface OrchestratorCheckResult {
  /** Estado canônico normalizado */
  status: JobExecutionStatus;
  /** Resumo textual de progresso ou conclusão */
  summary?: string;
  /** Mensagem de erro reportada em caso de falha */
  error?: string;
  /** Saída bruta retornada pelo servidor MCP/orquestrador para auditoria */
  rawOutput?: unknown;
}

/**
 * Função de injeção de dependência para execução de ferramentas (ex.: chamadas MCP).
 * Desacopla o adaptador do runtime do harness, viabilizando testes unitários determinísticos.
 */
export type ToolCaller = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Contexto de sondagem para verificação de disponibilidade estática.
 */
export interface OrchestratorProbeContext {
  /** Ferramentas MCP ativas na sessão atual (namespace canônico mcp__<server>__<tool>) */
  tools: string[];
  /** Variáveis de ambiente visíveis ao processo */
  env?: Record<string, string | undefined>;
}

/**
 * Interface soberana que qualquer adaptador de orquestrador deve implementar.
 */
export interface OrchestratorAdapter {
  /** Identificador estável do orquestrador (kebab-case, ex.: "alethe", "orca") */
  readonly id: string;
  /** Matriz de capacidades declaradas */
  readonly capabilities: OrchestratorCapabilities;

  /**
   * Verifica estaticamente se este orquestrador está disponível na sessão:
   * checagem no namespace de ferramentas MCP ou variáveis de ambiente.
   * Nunca dispara chamadas de rede ou subprocessos "para ver se funciona" (mcp-availability.md).
   */
  isAvailable(context: OrchestratorProbeContext): boolean;

  /**
   * Despacha uma tarefa isolada para o orquestrador em seu worktree exclusivo.
   */
  dispatch(
    input: OrchestratorDispatchInput,
    toolCaller: ToolCaller,
  ): Promise<OrchestratorJobHandle>;

  /**
   * Consulta o estado do job com polling seguro, respeitando safePollTimeoutMs.
   */
  check(
    handle: OrchestratorJobHandle,
    options: { timeoutMs?: number },
    toolCaller: ToolCaller,
  ): Promise<OrchestratorCheckResult>;

  /**
   * Libera handles de arquivo, locks e recursos alocados pelo orquestrador.
   */
  release(
    handle: OrchestratorJobHandle,
    toolCaller: ToolCaller,
  ): Promise<void>;

  /**
   * Cancela ou aborta a execução do job, se suportado.
   */
  cancel?(
    handle: OrchestratorJobHandle,
    toolCaller: ToolCaller,
  ): Promise<void>;
}

/**
 * Ação decidida pelo algoritmo de seleção de orquestrador.
 */
export type OrchestratorAction = "orchestrate" | "native" | "ask";

/**
 * Resultado da seleção de orquestrador.
 */
export interface OrchestratorSelection {
  action: OrchestratorAction;
  /** Adaptador selecionado (presente apenas quando action === "orchestrate") */
  adapter?: OrchestratorAdapter;
  /** Motivo descritivo da decisão */
  reason: string;
}

/**
 * Configuração de delegação para orquestradores em .claude/vetor/config.json.
 */
export interface OrchestratorConfig {
  preferred?: string | null;
  fallbackToNative?: boolean;
  maxPollTimeoutMs?: number;
  pollIntervalSeconds?: number;
  custom?: Record<
    string,
    {
      dispatchTool: string;
      checkTool: string;
      releaseTool: string;
      maxTimeoutMs?: number;
    }
  >;
}
