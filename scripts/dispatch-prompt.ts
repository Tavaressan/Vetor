// CLI do prompt de dispatch (issue #545): emite o prompt padronizado de um subagente do coordinator
// (worker, ship, review ou fix), pronto para ir ao `Agent()`. A montagem do ContextPacket e do Repo
// Map reaproveita scripts/context-packet.ts; o texto vem de lib/orchestrator/dispatch-prompt.ts.
//
// Uso:
//   deno run -A scripts/dispatch-prompt.ts --role <worker|ship|review|fix> --issue <N>[,<M>] \
//     --branch <b> --base <default> --status-file <abs> [--module-test-map <path>] \
//     [--slug <s>] [--worktree <p>] [--repo-root <p>] [--wave <n>] [--spike <N,M>] [--pr <n>] \
//     [--micro-spec <N>=<path>,...] [--env-failures "a|b"] [--reason <texto>] [--trailer <linha>] \
//     [--test-commands "mod=cmd<newline>mod=cmd"] [--issue-json <path>]
// `--module-test-map` é obrigatório só no papel worker. `--issue-json` aponta para um array
// `[{number,title,body}]` (uso offline e testes).

import {
  fail,
  flagValue,
  generateRepoMap,
  type IssueData,
  loadIssue,
  requireFlag,
  setFailPrefix,
} from "./context-packet.ts";
import {
  buildContextPacket,
  renderContextPacketPrompt,
} from "./lib/orchestrator/context-packet.ts";
import {
  buildDispatchPrompt,
  DISPATCH_ROLES,
  type DispatchIssue,
  type DispatchRole,
  issueSlug,
} from "./lib/orchestrator/dispatch-prompt.ts";
import { validateMicroSpec } from "./lib/orchestrator/micro-spec.ts";

function numberList(raw: string | undefined, flag: string): number[] {
  return (raw ?? "").split(",").map((v) => v.trim()).filter(Boolean).map((v) => {
    if (!/^\d+$/.test(v) || Number(v) < 1) fail(`${flag} inválido: ${v}`);
    return Number(v);
  });
}

function intFlag(args: string[], flag: string): number | undefined {
  const raw = flagValue(args, flag);
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) fail(`${flag} deve ser um inteiro >= 1: ${raw}`);
  return Number(raw);
}

/** `mod=cmd` por linha (ou um objeto JSON); o comando pode conter `=` e `|`. */
function parseTestCommands(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  if (raw.trimStart().startsWith("{")) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return fail("--test-commands: JSON inválido");
    }
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.some(([, v]) => typeof v !== "string")) {
      fail("--test-commands: valores devem ser texto");
    }
    return Object.fromEntries(entries) as Record<string, string>;
  }
  const result: Record<string, string> = {};
  for (const line of raw.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const i = line.indexOf("=");
    if (i <= 0 || i === line.length - 1) {
      fail(`--test-commands: entrada sem "módulo=comando": ${line}`);
    }
    result[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return result;
}

async function loadIssues(args: string[], numbers: number[]): Promise<IssueData[]> {
  const jsonPath = flagValue(args, "--issue-json");
  if (jsonPath) {
    let all: unknown;
    try {
      all = JSON.parse(await Deno.readTextFile(jsonPath));
    } catch {
      return fail(`--issue-json ilegível ou inválido: ${jsonPath}`);
    }
    if (!Array.isArray(all)) fail("--issue-json deve ser um array [{number,title,body}]");
    const valid: IssueData[] = all.map((item) => {
      if (
        typeof item?.number !== "number" || typeof item.title !== "string" ||
        (item.body !== null && item.body !== undefined && typeof item.body !== "string")
      ) {
        return fail(
          "--issue-json: cada item precisa de { number: número, title: texto, body: texto }",
        );
      }
      return { number: item.number, title: item.title, body: item.body ?? "" };
    });
    return numbers.map((n) =>
      valid.find((i) => i.number === n) ?? fail(`issue #${n} ausente em ${jsonPath}`)
    );
  }
  return await Promise.all(numbers.map((n) => loadIssue(["--issue", String(n)])));
}

if (import.meta.main) {
  setFailPrefix("dispatch-prompt");
  const args = Deno.args;
  const role = requireFlag(args, "--role") as DispatchRole;
  if (!DISPATCH_ROLES.includes(role)) fail(`--role deve ser um de ${DISPATCH_ROLES.join(", ")}`);
  const numbers = numberList(requireFlag(args, "--issue"), "--issue");
  if (numbers.length === 0) fail("--issue inválido");
  const branch = requireFlag(args, "--branch");
  const baseBranch = requireFlag(args, "--base");
  const statusFile = requireFlag(args, "--status-file");
  const worktreePath = flagValue(args, "--worktree");
  const spikes = new Set(numberList(flagValue(args, "--spike"), "--spike"));

  const microSpecs = new Map<number, string>();
  for (const entry of (flagValue(args, "--micro-spec") ?? "").split(",").filter(Boolean)) {
    const sep = entry.indexOf("=");
    const n = Number(entry.slice(0, sep));
    const path = entry.slice(sep + 1);
    if (sep <= 0 || !Number.isInteger(n) || n < 1 || !path) {
      fail(`--micro-spec: esperado <N>=<arquivo>, recebido: ${entry}`);
    }
    if (!numbers.includes(n)) fail(`--micro-spec: issue #${n} não está em --issue`);
    const content = await Deno.readTextFile(path).catch(() =>
      fail(`não consegui ler micro-spec: ${path}`)
    );
    const problems = validateMicroSpec(content);
    if (problems.length) fail(`micro-spec #${n} inválida: ${problems.join("; ")}`);
    microSpecs.set(n, content);
  }

  const loaded = await loadIssues(args, numbers);
  const leadSlug = flagValue(args, "--slug");
  const issues: DispatchIssue[] = loaded.map((i, idx) => ({
    ...i,
    slug: idx === 0 ? leadSlug : undefined,
    spike: spikes.has(i.number),
    microSpec: microSpecs.get(i.number),
  }));

  let contextPacketPrompt: string | undefined;
  if (role === "worker") {
    const mapPath = requireFlag(args, "--module-test-map");
    const moduleTestMap = await Deno.readTextFile(mapPath).catch(() =>
      fail(`não consegui ler --module-test-map: ${mapPath}`)
    );
    try {
      const lead = issues[0];
      const input = {
        issue: lead,
        slug: lead.slug ?? issueSlug(lead),
        worktree: { path: worktreePath, branch, baseBranch },
        moduleTestMap,
        microSpec: lead.microSpec,
        conventions: flagValue(args, "--conventions"),
      };
      let packet = buildContextPacket(input);
      const repoRoot = flagValue(args, "--repo-root");
      const repoMap = repoRoot ? await generateRepoMap(repoRoot, packet, moduleTestMap) : undefined;
      if (repoMap !== undefined) packet = buildContextPacket({ ...input, repoMap });
      contextPacketPrompt = renderContextPacketPrompt(packet);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }

  const testCommands = parseTestCommands(flagValue(args, "--test-commands"));
  const pr = intFlag(args, "--pr");
  const wave = intFlag(args, "--wave") ?? 1;

  try {
    console.info(buildDispatchPrompt({
      role,
      issues,
      branch,
      baseBranch,
      statusFile,
      worktreePath,
      contextPacketPrompt,
      wave,
      testCommands,
      knownEnvFailures: (flagValue(args, "--env-failures") ?? "").split("|").filter(Boolean),
      commitTrailer: flagValue(args, "--trailer"),
      pr,
      reason: flagValue(args, "--reason"),
    }));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
