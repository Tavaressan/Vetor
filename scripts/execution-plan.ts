/**
 * Dry-run do planner de execução (ADR-002, Fase 2, F2-9).
 * Não despacha tarefas nem altera o fluxo atual de delegação.
 *
 * Uso:
 *   deno run -A scripts/execution-plan.ts (--issue <N> | --issue-json <path>)
 *     [--root <path>] [--config <path>] [--module-test-map <path>]
 *     [--attempt <N>] [--interactive] [--write-log]
 */

import { discover, type Probe } from "./lib/capabilities/discovery.ts";
import { CapabilityRegistry } from "./lib/capabilities/registry.ts";
import { embeddedProfiles } from "./lib/capabilities/profiles/mod.ts";
import type { HarnessObservation } from "./lib/capabilities/types.ts";
import { planExecution } from "./lib/execution/planner.ts";
import { parseExecutionPolicy } from "./lib/execution/policy.ts";
import { appendRoutingRecord, routingLogPath } from "./lib/execution/routing-log.ts";
import { profileTask } from "./lib/execution/task-profiler.ts";

interface IssueMetadata {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

interface CliOptions {
  issue?: string;
  issueJson?: string;
  root: string;
  config?: string;
  moduleTestMap?: string;
  attempt: number;
  interactive: boolean;
  writeLog: boolean;
}

export const HELP = `Dry-run do planner de execução — não despacha tarefas.

Uso:
  deno run -A scripts/execution-plan.ts (--issue <N> | --issue-json <path>) [opções]

Entrada da issue (escolha uma):
  --issue <N>             Lê título, corpo e labels com gh issue view.
  --issue-json <path>     Lê esses metadados de um JSON local (uso offline/testes).

Opções:
  --root <path>           Raiz do repositório (padrão: diretório atual).
  --config <path>         Config JSON (padrão: <root>/.claude/vetor/config.json).
  --module-test-map <path>
                          Mapa de módulos (padrão: <root>/.claude/vetor/module-test-map.md).
  --attempt <N>           Número da tentativa (padrão: 0).
  --interactive           Permite que preferência indisponível resulte em "ask".
  --write-log             Acrescenta a decisão a routing-log.jsonl. Sem a flag, não grava.
  --help, -h              Mostra esta ajuda.

A saída JSON contém plan e decision. A descoberta de executáveis é passiva (sem spawn).
`;

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    root: Deno.cwd(),
    attempt: 0,
    interactive: false,
    writeLog: false,
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") continue;
    if (arg === "--interactive") {
      options.interactive = true;
      continue;
    }
    if (arg === "--write-log") {
      options.writeLog = true;
      continue;
    }
    if (
      arg === "--issue" || arg === "--issue-json" || arg === "--root" ||
      arg === "--config" || arg === "--module-test-map" || arg === "--attempt"
    ) {
      const value = args[++i];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`valor ausente para ${arg}`);
      }
      switch (arg) {
        case "--issue":
          options.issue = value;
          break;
        case "--issue-json":
          options.issueJson = value;
          break;
        case "--root":
          options.root = value;
          break;
        case "--config":
          options.config = value;
          break;
        case "--module-test-map":
          options.moduleTestMap = value;
          break;
        case "--attempt": {
          const attempt = Number(value);
          if (!Number.isSafeInteger(attempt) || attempt < 0) {
            throw new Error("--attempt deve ser um inteiro seguro não negativo");
          }
          options.attempt = attempt;
          break;
        }
      }
      continue;
    }
    throw new Error(`opção desconhecida: ${arg}`);
  }
  if (options.issue !== undefined && options.issueJson !== undefined) {
    throw new Error("use apenas uma entrada: --issue ou --issue-json");
  }
  if (options.issue === undefined && options.issueJson === undefined) {
    throw new Error("informe --issue <N> ou --issue-json <path>");
  }
  if (options.issue !== undefined && !/^\d+$/.test(options.issue)) {
    throw new Error(`--issue deve ser um número, recebido: ${options.issue}`);
  }
  return options;
}

function parseIssue(raw: string, origin: string): IssueMetadata {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${origin} não contém JSON válido`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${origin} precisa ser um objeto JSON`);
  }
  const issue = value as Record<string, unknown>;
  if (
    typeof issue.number !== "number" || !Number.isSafeInteger(issue.number) ||
    issue.number < 1 || typeof issue.title !== "string" ||
    (issue.body !== null && typeof issue.body !== "string")
  ) {
    throw new Error(`${origin} precisa conter { number, title, body } válidos`);
  }
  const labelsValue = issue.labels ?? [];
  if (!Array.isArray(labelsValue)) {
    throw new Error(`${origin}: labels deve ser uma lista`);
  }
  const labels = labelsValue.map((label) => {
    if (typeof label === "string") return label;
    if (
      label !== null && typeof label === "object" && !Array.isArray(label) &&
      typeof (label as Record<string, unknown>).name === "string"
    ) {
      return (label as Record<string, string>).name;
    }
    throw new Error(`${origin}: cada label deve ser texto ou objeto com name`);
  });
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    labels,
  };
}

async function loadIssue(options: CliOptions): Promise<IssueMetadata> {
  if (options.issueJson !== undefined) {
    return parseIssue(await Deno.readTextFile(options.issueJson), "--issue-json");
  }
  const result = await new Deno.Command("gh", {
    args: ["issue", "view", options.issue!, "--json", "number,title,body,labels"],
    cwd: options.root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error(
      `gh issue view ${options.issue} falhou: ${new TextDecoder().decode(result.stderr).trim()}`,
    );
  }
  return parseIssue(new TextDecoder().decode(result.stdout), `gh issue view ${options.issue}`);
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveExecutable(name: string): string | undefined {
  const pathValue = Deno.env.get("PATH") ?? "";
  const extensions = Deno.build.os === "windows"
    ? (Deno.env.get("PATHEXT") ?? ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const directory of pathValue.split(Deno.build.os === "windows" ? ";" : ":")) {
    for (const extension of extensions) {
      const candidate = `${directory}/${name}${extension}`;
      try {
        if (Deno.statSync(candidate).isFile) return candidate;
      } catch {
        // A busca no PATH é passiva; diretórios inacessíveis não são candidatos.
      }
    }
  }
  return undefined;
}

const pathProbe: Probe = { resolveExecutable };

function discoverPassively(): HarnessObservation[] {
  return embeddedProfiles.map((descriptor) => discover(descriptor, pathProbe));
}

export async function runExecutionPlan(args: string[]): Promise<{
  plan: ReturnType<typeof planExecution>["plan"];
  decision: ReturnType<typeof planExecution>["decision"];
}> {
  const options = parseArgs(args);
  const issue = await loadIssue(options);
  const configPath = options.config ?? `${options.root}/.claude/vetor/config.json`;
  const mapPath = options.moduleTestMap ?? `${options.root}/.claude/vetor/module-test-map.md`;

  const configText = await readOptionalFile(configPath);
  let config: unknown;
  if (configText !== undefined) {
    try {
      config = JSON.parse(configText);
    } catch {
      throw new Error(`${configPath} não contém JSON válido`);
    }
  }
  const { policy, errors } = parseExecutionPolicy(config);
  if (errors.length > 0) {
    throw new Error(
      `configuração execution inválida: ${errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
    );
  }

  const moduleTestMap = await readOptionalFile(mapPath);
  if (moduleTestMap === undefined) {
    throw new Error(
      `mapa de módulos ausente: ${mapPath} (rode /vetor:install ou informe --module-test-map)`,
    );
  }

  const profile = profileTask({
    taskId: String(issue.number),
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
    moduleTestMap,
    defaultDataSensitivity: policy.defaultDataSensitivity,
  });

  const registry = new CapabilityRegistry();
  for (const descriptor of embeddedProfiles) registry.register(descriptor);

  const delegation = isRecord(config) && isRecord(config.delegation)
    ? config.delegation
    : undefined;
  if (
    delegation?.preferredRuntime !== undefined &&
    (typeof delegation.preferredRuntime !== "string" || delegation.preferredRuntime.length === 0)
  ) {
    throw new Error("delegation.preferredRuntime deve ser uma string não vazia");
  }
  const result = planExecution({
    registry,
    observations: discoverPassively(),
    profile,
    policy,
    ...(typeof delegation?.preferredRuntime === "string"
      ? { preferredRuntime: delegation.preferredRuntime }
      : {}),
    interactive: options.interactive,
    attempt: options.attempt,
  });

  if (options.writeLog) {
    appendRoutingRecord(routingLogPath(options.root), result.decision);
  }
  return result;
}

if (import.meta.main) {
  if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
    console.log(HELP);
  } else {
    try {
      console.log(JSON.stringify(await runExecutionPlan(Deno.args), null, 2));
    } catch (error) {
      console.error(`execution-plan: ${error instanceof Error ? error.message : String(error)}`);
      Deno.exit(1);
    }
  }
}
