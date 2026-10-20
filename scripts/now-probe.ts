/** Sondagem local e somente-leitura para a skill /vetor:now. */

export type CommandExecutor = (command: string, args: string[], cwd: string) => Promise<string>;

const execute: CommandExecutor = async (command, args, cwd) => {
  const result = await new Deno.Command(command, { args, cwd, stdout: "piped", stderr: "null" })
    .output();
  if (!result.success) throw new Error(`${command} falhou`);
  return new TextDecoder().decode(result.stdout).trim();
};

async function optional(executor: CommandExecutor, command: string, args: string[], cwd: string) {
  try {
    return await executor(command, args, cwd);
  } catch {
    return null;
  }
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

  const totalIssuesText = await optional(
    executor,
    "gh",
    ["issue", "list", "--state", "open", "--json", "number"],
    cwd,
  );
  let openIssuesTotal: number | null = null;
  if (totalIssuesText !== null) {
    try {
      const parsed: unknown = JSON.parse(totalIssuesText);
      if (Array.isArray(parsed)) openIssuesTotal = parsed.length;
    } catch {
      openIssuesTotal = null;
    }
  }

  const issueText = await optional(
    executor,
    "gh",
    ["issue", "list", "--state", "open", "--label", "backlog", "--json", "number"],
    cwd,
  );
  let backlogIssues: number | null = null;
  if (issueText !== null) {
    try {
      const parsed: unknown = JSON.parse(issueText);
      if (Array.isArray(parsed)) backlogIssues = parsed.length;
    } catch {
      backlogIssues = null;
    }
  }
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
    backlogIssues,
    mcps,
    runtimes,
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
