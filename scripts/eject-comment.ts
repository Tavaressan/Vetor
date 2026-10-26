// CLI do comentário diagnóstico da ejeção graciosa (RF-05, issue #501). Imprime o markdown no
// stdout; o coordinator o publica sem passar pelo shell:
//
//   deno run -A scripts/eject-comment.ts ... | gh issue comment <N> --body-file -
//
// Uso:
//   deno run -A scripts/eject-comment.ts --issue <N> --branch <branch> --base <default-branch> \
//     --kind <failed-max-iterations|blocked-timeout> [--fail-analysis <path>] \
//     [--status-file <path>] [--worktree <path>] [--root <repo-root>]
//
// `--fail-analysis` é o `FAIL_ANALYSIS.md` do worktree (kind `failed-max-iterations`);
// `--status-file` é o status file `SUSPENDED` (kind `blocked-timeout`). `--root` e `--worktree` só
// servem para tirar os paths locais do texto. Nenhum valor passa por um shell: os git são chamados
// com argv.

import { buildEjectionComment, type EjectionKind } from "./lib/ejection.ts";
import { parseBlockedStatus } from "./lib/decision-inbox.ts";
import { run } from "./lib/project.ts";
import { resolveWorktree } from "./lib/status.ts";

const KINDS: EjectionKind[] = ["failed-max-iterations", "blocked-timeout"];
const SAFE_REF = /^[\w][\w./-]*$/;

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx === -1 ? undefined : args[idx + 1];
}

function fail(message: string): never {
  console.error(`eject-comment: ${message}`);
  Deno.exit(1);
}

function requireFlag(args: string[], flag: string): string {
  return flagValue(args, flag) ?? fail(`flag obrigatória ausente: ${flag}`);
}

function readOptional(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  try {
    return Deno.readTextFileSync(path);
  } catch {
    return fail(`não consegui ler ${path}`);
  }
}

if (import.meta.main) {
  const args = Deno.args;
  const issue = requireFlag(args, "--issue");
  if (!/^\d+$/.test(issue)) fail(`--issue deve ser um número de issue, recebido: ${issue}`);
  const kind = requireFlag(args, "--kind") as EjectionKind;
  if (!KINDS.includes(kind)) fail(`--kind deve ser um de: ${KINDS.join(", ")}`);
  const branch = requireFlag(args, "--branch");
  const base = requireFlag(args, "--base");
  for (const [flag, ref] of [["--branch", branch], ["--base", base]]) {
    if (!SAFE_REF.test(ref)) fail(`${flag} não parece um nome de branch: ${ref}`);
  }

  const root = flagValue(args, "--root") ?? (await resolveWorktree(Deno.cwd()))?.root ??
    fail("não consegui resolver o root do repositório: use --root");

  const log = await run("git", ["log", "--oneline", `${base}..${branch}`], root);
  const remote = await run("git", ["branch", "-r", "--list", `origin/${branch}`], root);
  const statusContent = readOptional(flagValue(args, "--status-file"));

  console.log(buildEjectionComment({
    kind,
    issueNumber: Number(issue),
    branch,
    commits: log.code === 0 ? log.stdout.split(/\r?\n/).filter(Boolean) : [],
    remotePublished: remote.stdout.trim() !== "",
    failAnalysis: readOptional(flagValue(args, "--fail-analysis")),
    blocked: statusContent ? parseBlockedStatus(statusContent) ?? undefined : undefined,
    roots: [root, flagValue(args, "--worktree") ?? ""],
  }));
}
