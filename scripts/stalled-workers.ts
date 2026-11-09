// Watchdog de workers parados (issue #562).
//
// Lista os worktrees linkados cujo status (root ou fallback do worktree, regra do vetor-status.sh)
// não é terminal e não muda há mais de N minutos. Sem status file, a referência é o mtime do
// diretório do worktree (criado no dispatch), e só contam worktrees em <root>/.claude/worktrees/.
// Somente leitura.
//
// Uso: deno run -A scripts/stalled-workers.ts [--minutes <N>]
//   N vem de --minutes, senão de `workerStallMinutes` em <root>/.claude/vetor/config.json,
//   senão 20.
// Saída: uma linha `STALLED <branch> <minutos>min <status> <path>` por worker parado.
// Exit: 0 = nenhum parado | 1 = há worker parado | 2 = fora de um repositório git.

import { readJson } from "./lib/project.ts";
import { effectiveStatus, isTerminal } from "./lib/status.ts";

export const DEFAULT_STALL_MINUTES = 20;

async function git(args: string[], cwd: string): Promise<string | null> {
  const out = await new Deno.Command("git", {
    args: ["--no-optional-locks", ...args],
    cwd,
    stdout: "piped",
    stderr: "null",
  }).output();
  return out.code === 0 ? new TextDecoder().decode(out.stdout) : null;
}

function mtime(path: string): number | null {
  try {
    return Deno.statSync(path).mtime?.getTime() ?? null;
  } catch {
    return null;
  }
}

function stallMinutes(root: string, args: string[]): number {
  const flag = args.indexOf("--minutes");
  const fromFlag = flag >= 0 ? Number(args[flag + 1]) : NaN;
  if (Number.isFinite(fromFlag) && fromFlag > 0) return fromFlag;
  let fromConfig = NaN;
  try {
    const config = readJson(`${root}/.claude/vetor/config.json`) as {
      workerStallMinutes?: unknown;
    };
    fromConfig = Number(config?.workerStallMinutes);
  } catch { /* config ausente ou inválido: usa o padrão */ }
  return Number.isFinite(fromConfig) && fromConfig > 0 ? fromConfig : DEFAULT_STALL_MINUTES;
}

async function main(): Promise<number> {
  const porcelain = await git(["worktree", "list", "--porcelain"], Deno.cwd());
  if (porcelain === null) return 2;

  const entries = porcelain.trim().split(/\n\n+/).map((block) => ({
    path: block.match(/^worktree (.+)$/m)?.[1] ?? "",
    branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? "",
  }));
  const [main, ...linked] = entries;
  const root = main.path;
  const limit = stallMinutes(root, Deno.args);
  const now = Date.now();
  let stalled = 0;

  for (const { path, branch } of linked) {
    if (!branch) continue; // detached HEAD: não é um worker (mesma regra do vetor-status.sh)
    const { path: statusPath, status } = effectiveStatus(root, branch, path);
    if (isTerminal(status)) continue;
    // Sem status file, só os worktrees que o Vetor cria contam: um worktree do usuário ou de outra
    // ferramenta (fora de .claude/worktrees/) não é worker e não tem status a atualizar.
    if (status === null && !path.startsWith(`${root}/.claude/worktrees/`)) continue;
    const reference = status === null ? mtime(path) : mtime(statusPath);
    if (reference === null) continue;
    const minutes = Math.floor((now - reference) / 60_000);
    if (minutes < limit) continue;
    const observed = status === null ? "sem status file" : status || "Status vazio";
    console.log(`STALLED ${branch} ${minutes}min ${observed} ${path}`);
    stalled++;
  }
  return stalled > 0 ? 1 : 0;
}

if (import.meta.main) Deno.exit(await main());
