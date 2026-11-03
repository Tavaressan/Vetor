// CLI do prompt de dispatch (issue #545): emite o prompt padronizado de um subagente do coordinator
// (worker, ship, review ou fix), pronto para ir ao `Agent()`. A montagem do ContextPacket e do Repo
// Map reaproveita scripts/context-packet.ts; o texto vem de lib/orchestrator/dispatch-prompt.ts.
//
// Uso:
//   deno run -A scripts/dispatch-prompt.ts --role <worker|ship|review|fix> --issue <N>[,<M>] \
//     --branch <b> --base <default> --status-file <abs> [--module-test-map <path>] \
//     [--slug <s>] [--worktree <p>] [--repo-root <p>] [--wave <n>] [--spike <N,M>] [--pr <n>] \
//     [--micro-spec <N>=<path>,...] [--env-failures "a|b"] [--reason <texto>] [--trailer <linha>] \
//     [--test-commands "mod=cmd|mod=cmd"] [--issue-json <path>]
// `--module-test-map` é obrigatório só no papel worker. `--issue-json` aponta para um array
// `[{number,title,body}]` (uso offline e testes).

import {
  fail,
  flagValue,
  generateRepoMap,
  type IssueData,
  loadIssue,
  requireFlag,
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
} from "./lib/orchestrator/dispatch-prompt.ts";
import { validateMicroSpec } from "./lib/orchestrator/micro-spec.ts";

function numberList(raw: string | undefined): number[] {
  return (raw ?? "").split(",").map((v) => v.trim()).filter(Boolean).map(Number);
}

async function loadIssues(args: string[], numbers: number[]): Promise<IssueData[]> {
  const jsonPath = flagValue(args, "--issue-json");
  if (jsonPath) {
    const all = JSON.parse(await Deno.readTextFile(jsonPath)) as IssueData[];
    return numbers.map((n) =>
      all.find((i) => i.number === n) ?? fail(`issue #${n} ausente em ${jsonPath}`)
    );
  }
  return await Promise.all(numbers.map((n) => loadIssue(["--issue", String(n)])));
}

if (import.meta.main) {
  const args = Deno.args;
  const role = requireFlag(args, "--role") as DispatchRole;
  if (!DISPATCH_ROLES.includes(role)) fail(`--role deve ser um de ${DISPATCH_ROLES.join(", ")}`);
  const numbers = numberList(requireFlag(args, "--issue"));
  if (numbers.length === 0 || numbers.some(Number.isNaN)) fail("--issue inválido");
  const branch = requireFlag(args, "--branch");
  const baseBranch = requireFlag(args, "--base");
  const statusFile = requireFlag(args, "--status-file");
  const worktreePath = flagValue(args, "--worktree");
  const spikes = new Set(numberList(flagValue(args, "--spike")));

  const microSpecs = new Map<number, string>();
  for (const entry of (flagValue(args, "--micro-spec") ?? "").split(",").filter(Boolean)) {
    const [n, path] = entry.split("=");
    const content = await Deno.readTextFile(path).catch(() =>
      fail(`não consegui ler micro-spec: ${path}`)
    );
    const problems = validateMicroSpec(content);
    if (problems.length) fail(`micro-spec #${n} inválida: ${problems.join("; ")}`);
    microSpecs.set(Number(n), content);
  }

  const loaded = await loadIssues(args, numbers);
  const issues: DispatchIssue[] = loaded.map((i) => ({
    ...i,
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
        slug: flagValue(args, "--slug") ?? `issue-${lead.number}`,
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

  const testCommands = Object.fromEntries(
    (flagValue(args, "--test-commands") ?? "").split("|").filter(Boolean).map((entry) => {
      const i = entry.indexOf("=");
      return [entry.slice(0, i), entry.slice(i + 1)];
    }),
  );
  const pr = flagValue(args, "--pr");

  try {
    console.info(buildDispatchPrompt({
      role,
      issues,
      branch,
      baseBranch,
      statusFile,
      worktreePath,
      contextPacketPrompt,
      wave: Number(flagValue(args, "--wave") ?? 1),
      testCommands,
      knownEnvFailures: (flagValue(args, "--env-failures") ?? "").split("|").filter(Boolean),
      commitTrailer: flagValue(args, "--trailer"),
      pr: pr ? Number(pr) : undefined,
      reason: flagValue(args, "--reason"),
    }));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
