// Guarda de escrita dos workers: dentro de um worktree, só se escreve no próprio worktree.
//
// Com até 5 workers em paralelo, um Edit/Write apontando para fora do worktree contamina
// o trabalho dos outros. A única exceção é o status file, escrito na raiz de propósito
// (é por ele que o issue-coordinator agrega o andamento).

/** Resolve `.`/`..` e uniformiza separadores. Não toca no disco: o alvo pode não existir. */
export function normalizePath(path: string): string {
  const segments: string[] = [];
  const raw = path.replaceAll("\\", "/");

  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." && segments.length > 0 && segments.at(-1) !== "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const prefix = raw.startsWith("/") ? "/" : "";
  const joined = prefix + segments.join("/");
  // Windows: comparação de path é case-insensitive.
  return Deno.build.os === "windows" ? joined.toLowerCase() : joined;
}

export function isWithin(child: string, parent: string): boolean {
  const c = normalizePath(child);
  const p = normalizePath(parent);
  return c === p || c.startsWith(p.endsWith("/") ? p : `${p}/`);
}

/**
 * `worktree` é o cwd do agente; `root`, a raiz do repositório principal.
 * Fora de um worktree linkado o guard não se aplica — quem chama decide isso.
 */
export function isWriteAllowed(target: string, worktree: string, root: string): boolean {
  if (isWithin(target, worktree)) return true;

  const statusDir = normalizePath(`${root}/.claude/vetor/status`);
  const normalizedTarget = normalizePath(target);
  const fileName = normalizedTarget.slice(statusDir.length + 1);
  return normalizedTarget.startsWith(`${statusDir}/`) && !fileName.includes("/") &&
    fileName.endsWith(".md");
}
