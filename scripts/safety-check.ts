// Safety gate do Vetor para o Claude Code (hook PreToolUse, matcher Bash|Edit|Write).
//
// Substitui scripts/cc-safety-hook.sh, que dependia de `python3` no PATH — ausente no
// Windows, onde o interpretador costuma se chamar `python`. Sob `set -euo pipefail`
// aquele hook morria em silêncio e o gate não era aplicado.
//
// Contrato do Claude Code: recebe o evento em JSON no stdin; exit 2 BLOQUEIA a chamada.
// Espelha a política de scripts/safety-check.sh, que segue servindo ao Antigravity —
// exceto pelo guard de escrita, que o Antigravity não tem como aplicar (lá o matcher só
// cobre run_command).
//
// Três políticas:
//   Worktree    — dentro de um worktree, o cwd precisa estar em .claude/worktrees/ da raiz
//                 e continuar registrado em `git worktree list` (não pode ser stale).
//   Bash        — não empurrar para branch protegida; não fazer push/PR de worker não-GREEN.
//   Edit/Write  — dentro de um worktree, não escrever fora dele.

import { isWriteAllowed } from "./lib/guard.ts";
import { run } from "./lib/project.ts";
import { readStatus, resolveWorktree, statusFilePath, type WorktreeInfo } from "./lib/status.ts";
import { evaluateFreshness } from "./lib/worktree.ts";

const PROTECTED_BRANCHES = ["main", "master", "production"];

interface HookInput {
  tool_name?: string;
  tool_input?: { command?: string; file_path?: string };
  cwd?: string;
}

function blocked(message: string): never {
  console.error(message);
  Deno.exit(2);
}

/** Extrai a branch de destino de um `git push [flags] [remote] <branch>[:<remote-branch>]`. */
function pushDestination(command: string): string | null {
  const push = command.match(/git push[^&|;]*/)?.[0];
  if (!push) return null;

  const last = push.trim().split(/\s+/).pop();
  if (!last || last.startsWith("-")) return null;
  return last.split(":")[0];
}

/**
 * Só se aplica dentro de um worktree linkado (`wt.isLinked`): a raiz do repositório
 * principal não tem essa restrição, senão o próprio uso legítimo do hook lá quebraria.
 */
async function checkFreshness(wt: WorktreeInfo): Promise<void> {
  const list = await run("git", ["worktree", "list", "--porcelain"], wt.root);
  const message = evaluateFreshness(wt.toplevel, wt.root, list.stdout);
  if (message) blocked(message);
}

function checkBash(command: string, wt: WorktreeInfo | null): void {
  const dest = pushDestination(command);
  if (dest && PROTECTED_BRANCHES.includes(dest)) {
    blocked(
      "ERROR: Push to protected branches (main, master, production) is prohibited by Vetor Safety Hook.",
    );
  }

  if (!/git push|gh pr (create|ready|merge)/.test(command)) return;
  if (!wt?.isLinked) return;

  const status = readStatus(statusFilePath(wt.root, wt.branch));
  // Sem status file, a branch não pertence ao fluxo do coordinator: não interfere.
  if (status === null) return;

  if (status !== "GREEN") {
    blocked(
      `ERROR: worker não-GREEN (Status: ${
        status || "desconhecido"
      }) — push/PR bloqueado pelo Vetor Safety Hook.\n` +
        "Registre BLOCKED_WAITING no status file se precisar de intervenção; o worktree-ship faz a entrega após GREEN.",
    );
  }
}

function checkWrite(filePath: string, wt: WorktreeInfo | null): void {
  if (!wt?.isLinked) return;

  if (!isWriteAllowed(filePath, wt.toplevel, wt.root)) {
    blocked(
      `ERROR: escrita fora do worktree bloqueada pelo Vetor Safety Hook: ${filePath}\n` +
        `O worker só escreve dentro de ${wt.toplevel} (e no seu status file). Editar a raiz ` +
        "contamina os demais workers em paralelo.",
    );
  }
}

async function main() {
  const raw = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer());

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    // Entrada ilegível não deve travar a sessão do usuário.
    Deno.exit(0);
  }

  const cwd = input.cwd ?? Deno.cwd();
  const wt = await resolveWorktree(cwd);

  // A checagem de frescor só faz sentido dentro de um worktree linkado — na raiz do
  // repositório principal (isLinked === false) o hook segue liberando normalmente.
  if (wt?.isLinked) {
    await checkFreshness(wt);
  }

  if (input.tool_name === "Edit" || input.tool_name === "Write") {
    const filePath = input.tool_input?.file_path;
    if (filePath) checkWrite(filePath, wt);
    Deno.exit(0);
  }

  const command = input.tool_input?.command;
  if (command) checkBash(command, wt);
  Deno.exit(0);
}

await main();
