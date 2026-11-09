// Coleta falhas reais de CI do GitHub Actions e as rotula pelo desfecho (spike #557).
//
// O rótulo vem do que de fato resolveu a falha, e não das regras da baseline:
//   - retry_operation: uma tentativa posterior do mesmo run (re-run) passou, ou um run posterior
//     do mesmo workflow e da mesma branch passou com o MESMO commit;
//   - inspect_failure: o primeiro run posterior que passou, no mesmo workflow e branch, tinha
//     OUTRO commit (alguém mudou o código);
//   - sem desfecho: nada passou depois na branch. Esses casos são contados, mas ficam de fora do
//     arquivo de cenários, porque o desfecho não diz o que teria resolvido.
// O contexto de cada caso usa só o que o CI informa de forma estruturada (timeout do job, número
// da tentativa) e um resumo do log, truncado e com segredos mascarados (`redactSecrets`).
//
// Repositório privado: o texto do log não pode sair dele. Para um repo privado o script só aceita
// `--out` fora de qualquer repositório git, e o relatório público usa apenas contagens.
//
// Uso:
//   deno run -A scripts/collect-real-failures.ts --repo <owner/name> [--repo ...] --out <arquivo>
//     [--limit 1000] [--concurrency 4]

import { MAX_SUMMARY_CHARS, redactSecrets } from "./lib/decision-adapter/context.ts";
import type { Alternative, FailureContext } from "./lib/decision-adapter/types.ts";

interface Run {
  databaseId: number;
  workflowName: string;
  headBranch: string;
  headSha: string;
  event: string;
  createdAt: string;
  attempt: number;
  conclusion: string;
  status: string;
  url: string;
}

export interface RealScenario {
  id: string;
  expected: Alternative;
  rationale: string;
  context: FailureContext;
  source: { repo: string; runId: number; attempt: number; workflow: string; url: string };
}

const MAX_ATTEMPTS_SHIP = 3; // ship §8: até 3 tentativas
const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

async function gh(args: string[]): Promise<string> {
  const o = await new Deno.Command("gh", { args, stdout: "piped", stderr: "piped" }).output();
  if (o.code !== 0) {
    throw new Error(`gh ${args.join(" ")}: ${new TextDecoder().decode(o.stderr).trim()}`);
  }
  return new TextDecoder().decode(o.stdout);
}

function flagAll(name: string): string[] {
  const out: string[] = [];
  Deno.args.forEach((a, i) => {
    if (a === name && Deno.args[i + 1]) out.push(Deno.args[i + 1]);
  });
  return out;
}
const flag = (name: string) => flagAll(name)[0];

/** Linhas que parecem erro, sem o prefixo "job\tstep\ttimestamp" do `gh run view --log`. */
export function summarizeLog(log: string): string {
  const lines = log.split("\n").map((l) => {
    const cols = l.split("\t");
    const text = cols.length >= 3 ? cols.slice(2).join("\t") : l;
    return text
      .replace(/^﻿?\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, "")
      // Cores ANSI, tanto o ESC real quanto a forma "^[[" que alguns logs trazem.
      // deno-lint-ignore no-control-regex
      .replace(/(?:\x1b|\^\[)\[[0-9;]*[A-Za-z]/g, "")
      .trimEnd();
  }).filter(Boolean);
  const errorish = lines.filter((l) =>
    /##\[error\]|\berror\b|\bError\b|\bFAIL|\bfailed\b|✗|ERR!|panicked|Exception|exit code [1-9]/i
      .test(l)
  );
  const picked = (errorish.length ? errorish : lines).slice(-15);
  const unique = [...new Set(picked)];
  return redactSecrets(unique.join("\n")).slice(-MAX_SUMMARY_CHARS);
}

const GENERIC_EXIT = /Process completed with exit code \d+/;

/**
 * Assinatura curta e estável da falha: a primeira linha `##[error]` que não seja a genérica
 * "Process completed with exit code N"; sem ela, a primeira linha de erro. Números viram N.
 */
export function signatureOf(summary: string): string {
  const lines = summary.split("\n");
  const line = lines.find((l) => l.includes("##[error]") && !GENERIC_EXIT.test(l)) ??
    lines.find((l) => !GENERIC_EXIT.test(l) && l.trim()) ?? lines[0] ?? "";
  return line.replace("##[error]", "").replace(/\d+/g, "N").trim().slice(0, 200);
}

async function isPrivate(repo: string): Promise<boolean> {
  return (await gh(["repo", "view", repo, "--json", "visibility", "--jq", ".visibility"]))
    .trim() !== "PUBLIC";
}

async function insideGitRepo(path: string): Promise<boolean> {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "/" : ".";
  const o = await new Deno.Command("git", {
    args: ["-C", dir, "rev-parse", "--is-inside-work-tree"],
    stdout: "null",
    stderr: "null",
  }).output();
  return o.code === 0;
}

interface Case {
  repo: string;
  run: Run;
  attempt: number;
  expected: Alternative | "unresolved";
  rationale: string;
}

/** Monta os casos de um repositório a partir da lista de runs (sem baixar logs). */
export async function labelRuns(
  repo: string,
  runs: Run[],
  attemptConclusion: (run: Run, k: number) => Promise<string>,
): Promise<Case[]> {
  const cases: Case[] = [];
  const byStream = new Map<string, Run[]>();
  for (const r of runs) {
    const key = `${r.workflowName}\u0000${r.headBranch}`;
    (byStream.get(key) ?? byStream.set(key, []).get(key)!).push(r);
  }
  for (const stream of byStream.values()) {
    stream.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (let i = 0; i < stream.length; i++) {
      const r = stream[i];
      // Tentativas anteriores de um run com re-run: falharam e foram repetidas com o mesmo commit.
      for (let k = 1; k < r.attempt; k++) {
        const c = await attemptConclusion(r, k);
        if (!FAILED.has(c)) continue;
        const later = r.conclusion === "success"
          ? "a tentativa final do mesmo run passou"
          : "nenhuma tentativa posterior do mesmo run passou";
        cases.push({
          repo,
          run: r,
          attempt: k,
          expected: r.conclusion === "success" ? "retry_operation" : "unresolved",
          rationale: `re-run (tentativa ${k} de ${r.attempt}): ${later}`,
        });
      }
      if (!FAILED.has(r.conclusion)) continue;
      const next = stream.slice(i + 1).find((x) => x.conclusion === "success");
      if (!next) {
        cases.push({
          repo,
          run: r,
          attempt: r.attempt,
          expected: "unresolved",
          rationale: "nenhum run posterior passou na mesma branch",
        });
      } else if (next.headSha === r.headSha) {
        cases.push({
          repo,
          run: r,
          attempt: r.attempt,
          expected: "retry_operation",
          rationale: `o run ${next.databaseId} passou com o mesmo commit`,
        });
      } else {
        cases.push({
          repo,
          run: r,
          attempt: r.attempt,
          expected: "inspect_failure",
          rationale: `o próximo run que passou (${next.databaseId}) tinha outro commit`,
        });
      }
    }
  }
  return cases;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

async function main() {
  const repos = flagAll("--repo");
  const out = flag("--out");
  const limit = Number(flag("--limit") ?? 1000);
  const concurrency = Number(flag("--concurrency") ?? 4);
  if (!repos.length || !out) {
    console.error(
      "uso: collect-real-failures.ts --repo <owner/name> [--repo ...] --out <arquivo> [--limit N]",
    );
    Deno.exit(2);
  }
  for (const repo of repos) {
    if (await isPrivate(repo) && await insideGitRepo(out)) {
      console.error(`recusado: ${repo} é privado e ${out} fica dentro de um repositório git`);
      Deno.exit(2);
    }
  }

  const scenarios: RealScenario[] = [];
  const counts: Record<string, Record<string, number>> = {};
  for (const repo of repos) {
    const runs = JSON.parse(
      await gh([
        "run",
        "list",
        "-R",
        repo,
        "--limit",
        String(limit),
        "--json",
        "databaseId,workflowName,headBranch,headSha,event,createdAt,attempt,conclusion,status,url",
      ]),
    ) as Run[];
    const attemptConclusion = async (r: Run, k: number) =>
      (await gh([
        "api",
        `repos/${repo}/actions/runs/${r.databaseId}/attempts/${k}`,
        "--jq",
        ".conclusion",
      ])).trim();
    const cases = await labelRuns(
      repo,
      runs.filter((r) => r.status === "completed"),
      attemptConclusion,
    );
    counts[repo] = { runs: runs.length };
    for (const c of cases) counts[repo][c.expected] = (counts[repo][c.expected] ?? 0) + 1;

    const resolved = cases.filter((c) => c.expected !== "unresolved");
    const built = await pool(resolved, concurrency, async (c) => {
      let log = "";
      try {
        log = await gh([
          "run",
          "view",
          String(c.run.databaseId),
          "-R",
          repo,
          "--attempt",
          String(c.attempt),
          "--log-failed",
        ]);
      } catch (e) {
        log = `(log indisponível: ${(e as Error).message.slice(0, 120)})`;
      }
      let timedOut = c.run.conclusion === "timed_out";
      if (!timedOut) {
        try {
          const jobs = await gh([
            "api",
            `repos/${repo}/actions/runs/${c.run.databaseId}/attempts/${c.attempt}/jobs`,
            "--jq",
            '[.jobs[].conclusion] | join(",")',
          ]);
          timedOut = jobs.split(",").includes("timed_out");
        } catch { /* sem jobs */ }
      }
      const summary = summarizeLog(log);
      const context: FailureContext = {
        operation: "ci",
        exitCode: timedOut ? null : 1,
        attempt: Math.min(c.attempt, MAX_ATTEMPTS_SHIP),
        maxAttempts: MAX_ATTEMPTS_SHIP,
        retryable: true, // `gh run rerun` é repetível (ship §8.c)
        errorSummary: summary,
        errorSignature: signatureOf(summary),
      };
      if (timedOut) context.timedOut = true;
      return {
        id: `${repo.split("/")[1]}-${c.run.databaseId}-a${c.attempt}`,
        expected: c.expected as Alternative,
        rationale: c.rationale,
        context,
        source: {
          repo,
          runId: c.run.databaseId,
          attempt: c.attempt,
          workflow: c.run.workflowName,
          url: c.run.url,
        },
      } satisfies RealScenario;
    });
    scenarios.push(...built);
  }

  await Deno.writeTextFile(
    out,
    JSON.stringify(
      {
        criteria:
          "Rótulo pelo desfecho real no GitHub Actions: retry_operation quando um re-run ou um run posterior com o mesmo commit passou; inspect_failure quando o próximo run que passou na mesma branch tinha outro commit. Casos sem desfecho ficam de fora. Gerado por scripts/collect-real-failures.ts (#557).",
        collectedAt: new Date().toISOString(),
        counts,
        scenarios,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ out, scenarios: scenarios.length, counts }, null, 2));
}

if (import.meta.main) await main();
