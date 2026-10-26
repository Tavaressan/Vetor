// Avalia os quatro gates da entrega autônoma em --headless (Issue #497, RF-05).
//
// Uso: deno run -A scripts/auto-ship-gates.ts <PR> --worktree=<path> [--default-branch=<nome>]
//
// Saída: uma linha `GATE <nome>: <PASS|FAIL|PENDING> <detalhe>` por gate (ci, reviews, migrations,
// mergeable) e `VERDICT: <PASS|FAIL|PENDING>`. Exit: 0 = PASS (os quatro passaram), 1 = FAIL
// (algum gate falhou: o PR fica aberto), 3 = PENDING (nenhum falhou, mas falta dado: reavalie
// depois), 2 = uso incorreto.
import { fileURLToPath } from "node:url";
import {
  combineGates,
  evaluateAutoShipGates,
  type GateDeps,
  type GateStatus,
} from "./lib/auto-ship-gates.ts";

const EXIT_BY_VERDICT: Record<GateStatus, number> = { PASS: 0, FAIL: 1, PENDING: 3 };

async function run(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<{ ok: boolean; stdout: string; output: string; code: number } | null> {
  try {
    const out = await new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "piped" })
      .output();
    const stdout = new TextDecoder().decode(out.stdout);
    return {
      ok: out.success,
      stdout,
      output: `${stdout}${new TextDecoder().decode(out.stderr)}`,
      code: out.code,
    };
  } catch {
    return null;
  }
}

const checksScript = fileURLToPath(new URL("./vetor-checks.sh", import.meta.url));

const realDeps: GateDeps = {
  async gh(args) {
    const res = await run("gh", args);
    return { ok: res?.ok ?? false, stdout: res?.stdout ?? "" };
  },
  async migrations(worktree, defaultBranch) {
    // Compara a árvore do PR com a default atual: colisões com PRs mergeados depois do Pre-Ship.
    const fetched = await run("git", ["fetch", "origin", defaultBranch], worktree);
    if (!fetched?.ok) return null;
    const res = await run(
      "bash",
      [checksScript, "migrations", "--against", `origin/${defaultBranch}`],
      worktree,
    );
    return res ? { code: res.code, output: res.output } : null;
  },
};

if (import.meta.main) {
  const args = Deno.args;
  const pr = args.find((a) => !a.startsWith("--"));
  const worktree = args.find((a) => a.startsWith("--worktree="))?.slice(11);
  const defaultBranch = args.find((a) => a.startsWith("--default-branch="))?.slice(17) ?? "master";

  if (!pr || !/^[0-9]+$/.test(pr) || !worktree) {
    console.error(
      "uso: deno run -A scripts/auto-ship-gates.ts <PR> --worktree=<path> [--default-branch=<nome>]",
    );
    Deno.exit(2);
  }

  const results = await evaluateAutoShipGates({ pr, worktree, defaultBranch }, realDeps);
  for (const r of results) console.log(`GATE ${r.gate}: ${r.status} ${r.detail}`);
  const verdict = combineGates(results);
  console.log(`VERDICT: ${verdict}`);
  Deno.exit(EXIT_BY_VERDICT[verdict]);
}
