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
    mcps,
    runtimes,
    pluginVersion: await probeVersion(executor, cwd),
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
