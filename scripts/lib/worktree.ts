// Frescor de worktree: garante que o cwd de um worker continua sendo um worktree válido
// da raiz do projeto — dentro de `.claude/worktrees/` e ainda registrado em
// `git worktree list`. Sem isso, um agente cujo worktree foi removido (worktree-ship) ou
// aponta para fora da árvore esperada seguiria operando com um cwd stale/indevido.

import { isWithin, normalizePath } from "./guard.ts";

/** Extrai os paths de cada bloco `worktree <path>` de `git worktree list --porcelain`. */
export function parseWorktreePaths(porcelain: string): string[] {
  return [...porcelain.matchAll(/^worktree (.+)$/gm)].map((m) => m[1].trim());
}

function isListedWorktree(toplevel: string, porcelain: string): boolean {
  const target = normalizePath(toplevel);
  return parseWorktreePaths(porcelain).some((path) => normalizePath(path) === target);
}

/**
 * Avalia se `toplevel` (o cwd resolvido do worker) ainda é um worktree válido de `root`
 * (a raiz do repositório principal): precisa estar dentro de `<root>/.claude/worktrees` e
 * continuar presente em `porcelain` (saída de `git worktree list --porcelain`, rodado a
 * partir de `root`). Devolve a mensagem de bloqueio, ou `null` se estiver tudo certo.
 */
export function evaluateFreshness(
  toplevel: string,
  root: string,
  porcelain: string,
  agentType?: string,
): string | null {
  // Quem chamou o hook: só chega aqui com agent_type presente (ver safety-check.ts::main),
  // mas o parâmetro é opcional para não quebrar chamadas diretas em teste.
  const who = agentType ?? "este agente";

  if (!isWithin(toplevel, `${root}/.claude/worktrees`)) {
    return `ERROR: worktree fora de ${root}/.claude/worktrees bloqueado pelo Vetor Safety Hook: ${toplevel}\n` +
      `${who} só deve operar dentro de .claude/worktrees/<slug> na raiz do projeto.`;
  }

  if (!isListedWorktree(toplevel, porcelain)) {
    return `ERROR: worktree stale bloqueado pelo Vetor Safety Hook: ${toplevel}\n` +
      "Este worktree não aparece mais em `git worktree list` — provavelmente já foi removido " +
      `(worktree-ship ou limpeza manual). Encerre esta sessão (${who}); ela não pode mais operar aqui.`;
  }

  return null;
}
