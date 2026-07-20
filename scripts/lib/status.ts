// Status file dos workers: <root>/.claude/vetor/status/<branch>.md
//
// Vive na raiz do repositório, não no worktree, para que o issue-coordinator consiga
// agregar o andamento de todos os workers. Compartilhado por safety-check.ts (que barra
// push de worker não-GREEN) e check-status.ts (que barra worker terminando sem status).

import { run } from "./project.ts";

/** Estados em que o worker pode legitimamente encerrar. */
export const TERMINAL_STATES = ["GREEN", "FAILED_MAX_ITERATIONS", "BLOCKED_WAITING"];

export interface WorktreeInfo {
  /** Raiz do repositório principal (não do worktree). */
  root: string;
  /** Raiz do worktree atual — a fronteira de escrita do worker. */
  toplevel: string;
  branch: string;
  /** git-dir difere de git-common-dir apenas em worktree linkado. */
  isLinked: boolean;
}

export async function resolveWorktree(cwd: string): Promise<WorktreeInfo | null> {
  const gitDir = (await run("git", ["rev-parse", "--git-dir"], cwd)).stdout.trim();
  const commonDir = (await run("git", ["rev-parse", "--git-common-dir"], cwd)).stdout.trim();
  if (!gitDir) return null;

  const branch = (await run("git", ["branch", "--show-current"], cwd)).stdout.trim();
  const root = (await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd))
    .stdout.trim().replace(/\/?\.git\/?$/, "");
  // O cwd pode ser um subdiretório do worktree; a fronteira é o toplevel.
  const toplevel = (await run("git", ["rev-parse", "--show-toplevel"], cwd)).stdout.trim();
  if (!branch || !root || !toplevel) return null;

  return { root, toplevel, branch, isLinked: gitDir !== commonDir };
}

export function statusFilePath(root: string, branch: string): string {
  return `${root}/.claude/vetor/status/${branch.replaceAll("/", "-")}.md`;
}

/**
 * Onde fica registrado, por `agent_id`, qual worktree (toplevel) esse agente resolveu da
 * primeira vez que o hook de escrita rodou para ele. `agent_id` é estável e único por
 * instância de subagente (ver issue #63) — diferente de `agent_type`, compartilhado por
 * todos os workers do mesmo tipo.
 */
export function agentBindingPath(root: string, agentId: string): string {
  return `${root}/.claude/vetor/status/.agent-cwd/${agentId}`;
}

/** Marcador gravado por prepareDeps (prepare-worktree.ts) quando a instalação de deps falha. */
export function prepareFailedMarkerPath(worktreePath: string): string {
  return `${worktreePath}/.claude/vetor/prepare-failed`;
}

/** Devolve o valor de `Status:` do arquivo, ou null se ele não existe. */
export function readStatus(path: string): string | null {
  let content: string;
  try {
    content = Deno.readTextFileSync(path);
  } catch {
    return null;
  }
  return content.match(/^Status: *(.+)$/m)?.[1]?.trim() ?? "";
}

export function isTerminal(status: string | null): boolean {
  return status !== null && TERMINAL_STATES.includes(status);
}
