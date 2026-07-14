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
// Duas políticas:
//   Bash        — não empurrar para branch protegida; não fazer push/PR de worker não-GREEN.
//   Edit/Write  — dentro de um worktree, não escrever fora dele.

import { isWriteAllowed } from "./lib/guard.ts";
import { readStatus, resolveWorktree, statusFilePath } from "./lib/status.ts";

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

async function checkBash(command: string, cwd: string): Promise<void> {
  const dest = pushDestination(command);
  if (dest && PROTECTED_BRANCHES.includes(dest)) {
    blocked(
      "ERROR: Push to protected branches (main, master, production) is prohibited by Vetor Safety Hook.",
    );
  }

  if (!/git push|gh pr (create|ready|merge)/.test(command)) return;

  const wt = await resolveWorktree(cwd);
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

async function checkWrite(filePath: string, cwd: string): Promise<void> {
  const wt = await resolveWorktree(cwd);
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

  if (input.tool_name === "Edit" || input.tool_name === "Write") {
    const filePath = input.tool_input?.file_path;
    if (filePath) await checkWrite(filePath, cwd);
    Deno.exit(0);
  }

  const command = input.tool_input?.command;
  if (command) await checkBash(command, cwd);
  Deno.exit(0);
}

await main();
