/** Sondagem local e somente-leitura para a skill /vetor:now. */

export type CommandExecutor = (command: string, args: string[], cwd: string) => Promise<string>;

const execute: CommandExecutor = async (command, args, cwd) => {
  const result = await new Deno.Command(command, { args, cwd, stdout: "piped", stderr: "null" })
    .output();
  if (!result.success) throw new Error(`${command} falhou`);
  return new TextDecoder().decode(result.stdout).trim();
};

/** `gh issue list` devolve no máximo 30 itens por padrão; sem isso as contagens saturam em 30. */
const ISSUE_LIMIT = "1000";

async function countOpenIssues(
  executor: CommandExecutor,
  cwd: string,
  label: string | null,
): Promise<number | null> {
  const args = ["issue", "list", "--state", "open", "--limit", ISSUE_LIMIT, "--json", "number"];
  if (label !== null) args.splice(4, 0, "--label", label);
  const text = await optional(executor, "gh", args, cwd);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

async function optional(executor: CommandExecutor, command: string, args: string[], cwd: string) {
  try {
    return await executor(command, args, cwd);
  } catch {
    return null;
  }
}

const PLUGIN_REPO = "Tavaressan/Vetor";

/** Teto para a consulta de rede da última release; estourar equivale a "sem dado", nunca trava o kickoff. */
const LATEST_TIMEOUT_MS = 5000;

/** Resolve `null` se `promise` não terminar em `ms`; o timer é sempre limpo. */
async function withTimeout<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Compara versões `X.Y.Z` numericamente; devolve true se `latest` é mais nova que `installed`. */
export function isNewerVersion(installed: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(installed);
  const b = parse(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** Versão instalada (plugin.json) e última release publicada; best-effort, nunca lança. */
export async function probeVersion(
  executor: CommandExecutor,
  cwd: string,
  manifestUrl?: URL,
  timeoutMs: number = LATEST_TIMEOUT_MS,
) {
  let installed: string | null = null;
  try {
    const url = manifestUrl ?? new URL("../.claude-plugin/plugin.json", import.meta.url);
    const manifest = JSON.parse(await Deno.readTextFile(url));
    if (typeof manifest.version === "string") installed = manifest.version;
  } catch {
    // Manifesto ilegível: versão desconhecida.
  }
  const tag = await withTimeout(
    optional(executor, "gh", [
      "api",
      `repos/${PLUGIN_REPO}/releases/latest`,
      "--jq",
      ".tag_name",
    ], cwd),
    timeoutMs,
  );
  const latest = tag ? tag.replace(/^v/, "") : null;
  const updateAvailable = installed !== null && latest !== null
    ? isNewerVersion(installed, latest)
    : null;
  return { installed, latest, updateAvailable };
}

export interface NextStepOption {
  label: string;
  command: string;
}

export interface NextStep {
  /** Etapa recomendada; `null` quando a sondagem não tem dado para decidir (ex.: `gh` indisponível). */
  recommended: "install" | "coordinator" | "coordinator-resume" | "backlog" | null;
  reason: string;
  /** Sempre quatro opções; a recomendada vem primeiro. */
  options: NextStepOption[];
}

const OPTIONS: Record<string, NextStepOption> = {
  install: { label: "Inicializar projeto", command: "/vetor:install" },
  coordinator: { label: "Despachar issues", command: "/vetor:coordinator" },
  "coordinator-resume": {
    label: "Retomar o despacho",
    command: "/vetor:coordinator --resume",
  },
  backlog: { label: "Idear trabalho", command: "/vetor:backlog" },
  spec: { label: "Especificar tema", command: "/vetor:spec" },
  guardian: { label: "Auditar ou trabalho pontual", command: "/vetor:guardian" },
};

/**
 * Próxima etapa recomendada pelo estado sondado (regra fixa, antes escrita em prosa na skill).
 * Projeto não inicializado vai ao install; sem issues despacháveis, ao backlog; com worktrees de
 * trabalho em andamento, à retomada do coordinator; com issues despacháveis, ao coordinator.
 */
export function recommendNextStep(state: {
  initialized: boolean;
  dispatchableIssues: number | null;
  worktrees: string[];
}): NextStep {
  // Só os worktrees que o Vetor cria (<root>/.claude/worktrees/) contam como trabalho em andamento;
  // um worktree do usuário ou de outra ferramenta não é retomável pelo coordinator.
  const [root = "", ...linked] = state.worktrees;
  const activeWorktrees = linked.filter((w) => w.startsWith(`${root}/.claude/worktrees/`)).length;
  let recommended: NextStep["recommended"];
  let reason: string;
  if (!state.initialized) {
    recommended = "install";
    reason = "projeto sem .claude/vetor/config.json: mapear testes e configurar antes de despachar";
  } else if (state.dispatchableIssues === 0) {
    recommended = "backlog";
    reason = "nenhuma issue despachável";
  } else if (activeWorktrees > 0) {
    recommended = "coordinator-resume";
    reason = `${activeWorktrees} worktree(s) de trabalho em andamento`;
  } else if (state.dispatchableIssues === null) {
    recommended = null;
    reason = "não foi possível contar as issues (gh indisponível)";
  } else {
    recommended = "coordinator";
    reason = `${state.dispatchableIssues} issue(s) despachável(is) e nenhum worktree de trabalho`;
  }

  const base = state.initialized
    ? ["coordinator", "backlog", "spec", "guardian"]
    : ["install", "coordinator", "backlog", "spec"];
  if (recommended === "coordinator-resume") base[0] = "coordinator-resume";
  const ordered = recommended === null
    ? base
    : [recommended, ...base.filter((key) => key !== recommended)];
  return { recommended, reason, options: ordered.slice(0, 4).map((key) => OPTIONS[key]) };
}

export interface AiMemoryGuidance {
  /** O que fazer se o ai-memory estiver configurado na sessão, mas inativo. */
  action: "reconnect" | "ask-to-start" | "report-state" | "show-recipe" | "docker-unavailable";
  /** Comando a rodar, só com anuência explícita (`ask-to-start`). */
  command?: string;
  detail: string;
}

/** Orientação do ai-memory pelo estado do container (regra fixa, antes escrita em prosa). */
export function aiMemoryGuidance(state: string | null): AiMemoryGuidance {
  if (state === null) {
    return {
      action: "docker-unavailable",
      detail:
        "Docker não respondeu (não instalado ou daemon parado). Nunca rode docker run nem docker compose up automaticamente; configurar o Docker para iniciar no login sobe o container (restart: unless-stopped).",
    };
  }
  if (state === "running") {
    return {
      action: "reconnect",
      detail: "Container rodando: reconecte o servidor MCP ai-memory no harness.",
    };
  }
  if (state === "exited" || state === "created") {
    return {
      action: "ask-to-start",
      command: "docker start ai-memory",
      detail:
        "Peça anuência antes de iniciar. Com anuência, rode só o comando e confira com scripts/ai-memory-check.ts <url> até 10 vezes, a cada 3 s; depois reconecte o MCP.",
    };
  }
  if (state === "absent") {
    return {
      action: "show-recipe",
      detail:
        "Sem container: indique templates/docker-compose.ai-memory.yml e wiki/MCPs.md, sem criar nem iniciar nada.",
    };
  }
  return {
    action: "report-state",
    detail: `Container em estado ${state}: só informe, sem executar comandos.`,
  };
}

export async function probeNow(cwd: string, executor: CommandExecutor = execute) {
  const branch = await optional(executor, "git", ["branch", "--show-current"], cwd);
  const status = await optional(
    executor,
    "git",
    ["--no-optional-locks", "status", "--porcelain"],
    cwd,
  );
  const worktreeText = await optional(executor, "git", ["worktree", "list", "--porcelain"], cwd);
  let worktrees: string[] = [];
  if (worktreeText !== null) {
    worktrees = worktreeText.split(/\r?\n/).filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice(9));
  }

  let initialized = false;
  let defaultDispatchLabel: string | null = null;
  try {
    const configContent = await Deno.readTextFile(`${cwd}/.claude/vetor/config.json`);
    initialized = true;
    try {
      const parsedConfig = JSON.parse(configContent);
      if (parsedConfig && typeof parsedConfig.defaultDispatchLabel === "string") {
        defaultDispatchLabel = parsedConfig.defaultDispatchLabel;
      }
    } catch {
      // config.json existe mas JSON é inválido
    }
  } catch {
    initialized = false;
  }

  const openIssuesTotal = await countOpenIssues(executor, cwd, null);
  // Issue #412: o que o coordinator despacharia sem argumento — label default ou todas as abertas.
  const dispatchableIssues = defaultDispatchLabel === null
    ? openIssuesTotal
    : await countOpenIssues(executor, cwd, defaultDispatchLabel);
  const containerStateText = await optional(executor, "docker", [
    "ps",
    "-a",
    "--filter",
    "name=^ai-memory$",
    "--format",
    "{{.State}}",
  ], cwd);
  const aiMemoryContainerState = containerStateText === null
    ? null
    : containerStateText || "absent";
  let mcps: string[] = [];
  try {
    const config = JSON.parse(await Deno.readTextFile(`${cwd}/.mcp.json`));
    if (config.mcpServers && typeof config.mcpServers === "object") {
      mcps = Object.keys(config.mcpServers).sort();
    }
  } catch {
    // Config ausente ou inválida significa que não há MCP declarado detectável.
  }
  const runtimes: Record<string, string | null> = {};
  for (const binary of ["agy", "codex", "opencode", "gemini"]) {
    runtimes[binary] = await findBinary(binary);
  }
  return {
    branch: branch || null,
    clean: status === null ? null : status.length === 0,
    worktrees,
    initialized,
    defaultDispatchLabel,
    openIssuesTotal,
    dispatchableIssues,
    aiMemoryContainerState,
    aiMemory: {
      containerState: aiMemoryContainerState,
      guidance: aiMemoryGuidance(aiMemoryContainerState),
    },
    mcps,
    runtimes,
    pluginVersion: await probeVersion(executor, cwd),
    nextStep: recommendNextStep({ initialized, dispatchableIssues, worktrees }),
  };
}

async function findBinary(binary: string): Promise<string | null> {
  const pathValue = Deno.env.get("PATH") ?? "";
  const extensions = Deno.build.os === "windows"
    ? (Deno.env.get("PATHEXT") ?? ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const directory of pathValue.split(Deno.build.os === "windows" ? ";" : ":")) {
    for (const extension of extensions) {
      const candidate = `${directory}/${binary}${extension}`;
      try {
        const info = await Deno.stat(candidate);
        if (info.isFile) return candidate;
      } catch {
        // Continua a busca sem executar o binário.
      }
    }
  }
  return null;
}

if (import.meta.main) {
  const cwd = Deno.args[0] ?? Deno.cwd();
  console.log(JSON.stringify(await probeNow(cwd)));
}
