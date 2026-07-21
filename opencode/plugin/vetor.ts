// Safety gate do Vetor para o OpenCode (hooks tool.execute.before / tool.execute.after).
//
// Ao contrário do Claude Code e do Codex, o OpenCode não tem hook declarativo em JSON —
// um plugin é código TS/JS que recebe (input, output) e bloqueia lançando Error. Também não
// existe `$CLAUDE_PLUGIN_ROOT`/`$PLUGIN_ROOT`: por isso este plugin resolve os scripts como
// caminho relativo a si mesmo (`../scripts/...`), dentro da mesma pasta `opencode/` copiada
// para o projeto-alvo — ver README, seção "Compatibilidade com OpenCode".
//
// A lógica de segurança em si NÃO foi duplicada: este plugin só traduz o payload do OpenCode
// (`{tool, sessionID, args, agent}`) para o formato que scripts/safety-check.ts e
// scripts/check-edit.ts já esperam no stdin (o mesmo usado pelo Claude Code e pelo Codex) e
// invoca os scripts Deno originais via `deno run -A`. Fonte única de verdade continua em
// scripts/lib/*.ts.
//
// Payload confirmado contra o SDK instalado (@opencode-ai/plugin, v1.18.4) em 2026-07-21 —
// diferente do que foi possível fazer para o Codex (só doc pública, sem CLI real disponível).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(HERE, "..", "scripts");

interface ToolExecuteBeforeInput {
  tool: string;
  sessionID: string;
  callID: string;
  agent?: string;
}

interface ToolExecuteBeforeOutput {
  args: Record<string, unknown>;
}

/** Mesmo shape que scripts/safety-check.ts e scripts/check-edit.ts já esperam no stdin. */
interface HookInput {
  tool_name?: string;
  tool_input?: { command?: string; file_path?: string };
  cwd?: string;
  agent_type?: string;
  agent_id?: string;
}

const TOOL_NAME_MAP: Record<string, string> = {
  bash: "Bash",
  edit: "Edit",
  write: "Write",
};

/**
 * agent_id do Claude Code é estável por instância de subagente (issue #63: cwd contaminado
 * entre workers paralelos). No modelo recomendado para o OpenCode (ver README — cada worker
 * é um processo `opencode run --dir <worktree>` isolado, não a tool `task` in-process), essa
 * classe de bug não deveria ocorrer: cada processo já nasce com cwd fixo no seu worktree.
 * Mesmo assim, sessionID identifica a sessão/processo de forma estável e serve como proxy
 * de agent_id para reaproveitar a segunda camada de defesa do safety-check.ts sem custo.
 */
function toHookInput(
  input: ToolExecuteBeforeInput,
  output: ToolExecuteBeforeOutput,
  cwd: string,
): HookInput {
  const toolName = TOOL_NAME_MAP[input.tool];
  const toolInput = toolName === "Bash"
    ? { command: String(output.args.command ?? "") }
    : { file_path: String(output.args.filePath ?? output.args.file_path ?? "") };

  return {
    tool_name: toolName,
    tool_input: toolInput,
    cwd,
    agent_type: input.agent,
    agent_id: input.sessionID,
  };
}

function runDenoScript(
  script: string,
  payload: HookInput | Record<string, unknown>,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("deno", ["run", "-A", join(SCRIPTS_DIR, script)], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });
    child.on("error", () => {
      clearTimeout(timer);
      // deno ausente do PATH: mesmo pré-requisito documentado no README para as outras
      // plataformas. Fail-open — não travar a sessão do usuário por dependência faltando.
      resolve({ code: 0, stdout: "", stderr: "" });
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

/** Payload mínimo de `ApiError` (@opencode-ai/sdk v1.18.4, dist/gen/types.gen.d.ts:86). */
interface ApiErrorLike {
  name?: string;
  data?: {
    message?: string;
    statusCode?: number;
    isRetryable?: boolean;
    responseHeaders?: Record<string, string>;
  };
}

/** `EventSessionError.properties` (types.gen.d.ts:518) — sem provider/model, só sessionID. */
interface SessionErrorEvent {
  type: string;
  properties?: {
    sessionID?: string;
    error?: ApiErrorLike;
  };
}

// deno-lint-ignore require-await -- assinatura exigida pela API de plugin do OpenCode (async).
export const VetorPlugin = async ({ directory, worktree }: {
  directory: string;
  worktree: string;
}) => {
  const cwd = worktree || directory;

  // `session.error` (issue #83) não carrega provider/model — só `sessionID`. `chat.params`
  // roda antes de cada chamada ao provedor e já recebe `model: { providerID, id }`; mantemos
  // esse mapa em memória (por processo — cada worker `opencode run --dir` já é isolado) para
  // resolver a chave "<provider>/<model>" quando o erro chegar depois na mesma sessão.
  const sessionModel = new Map<string, string>();

  return {
    // deno-lint-ignore require-await -- assinatura exigida pela API de plugin do OpenCode (async).
    "chat.params": async (
      input: { sessionID: string; model: { providerID: string; id: string } },
      _output: unknown,
    ) => {
      sessionModel.set(input.sessionID, `${input.model.providerID}/${input.model.id}`);
    },

    "event": async ({ event }: { event: SessionErrorEvent }) => {
      if (event.type !== "session.error") return;

      const error = event.properties?.error;
      if (!error || error.name !== "APIError") return;

      const statusCode = error.data?.statusCode;
      if (statusCode === undefined) return;

      const sessionID = event.properties?.sessionID;
      const model = sessionID ? sessionModel.get(sessionID) : undefined;

      await runDenoScript("model-health.ts", {
        model,
        statusCode,
        responseHeaders: error.data?.responseHeaders,
        message: error.data?.message,
        cwd,
      }, 20_000);
    },

    "tool.execute.before": async (
      input: ToolExecuteBeforeInput,
      output: ToolExecuteBeforeOutput,
    ) => {
      if (!["bash", "edit", "write"].includes(input.tool)) return;

      const payload = toHookInput(input, output, cwd);
      const { code, stderr } = await runDenoScript("safety-check.ts", payload, 300_000);
      if (code === 2) {
        throw new Error(stderr.trim() || "Bloqueado pelo Vetor Safety Hook.");
      }
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: Record<string, unknown> },
      output: { title: string; output: string; metadata: Record<string, unknown> },
    ) => {
      if (!["edit", "write"].includes(input.tool)) return;

      const payload = toHookInput(input, { args: input.args }, cwd);
      const { stdout } = await runDenoScript("check-edit.ts", payload, 20_000);
      if (!stdout) return;

      try {
        const parsed = JSON.parse(stdout);
        const context = parsed?.hookSpecificOutput?.additionalContext;
        if (context) {
          output.metadata = { ...output.metadata, vetorDiagnostics: context };
        }
      } catch {
        // Saída não-JSON do check-edit.ts (não deveria acontecer): ignora silenciosamente.
      }
    },
  };
};
