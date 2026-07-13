// Safety gate do Vetor para o Claude Code (hook PreToolUse, matcher Bash).
//
// Substitui scripts/cc-safety-hook.sh, que dependia de `python3` no PATH — ausente no
// Windows, onde o interpretador costuma se chamar `python`. Sob `set -euo pipefail`
// aquele hook morria em silêncio e o gate não era aplicado.
//
// Contrato do Claude Code: recebe o evento em JSON no stdin; exit 2 BLOQUEIA a chamada.
// Espelha a política de scripts/safety-check.sh, que segue servindo ao Antigravity.

import { run } from "./lib/project.ts";

const PROTECTED_BRANCHES = ["main", "master", "production"];

interface HookInput {
  tool_input?: { command?: string };
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

async function checkNonGreenWorker(command: string, cwd: string): Promise<void> {
  if (!/git push|gh pr (create|ready|merge)/.test(command)) return;

  const gitDir = (await run("git", ["rev-parse", "--git-dir"], cwd)).stdout.trim();
  const commonDir = (await run("git", ["rev-parse", "--git-common-dir"], cwd)).stdout.trim();
  // git-dir != git-common-dir apenas em worktree linkado.
  if (!gitDir || gitDir === commonDir) return;

  const branch = (await run("git", ["branch", "--show-current"], cwd)).stdout.trim();
  const root = (await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd))
    .stdout.trim().replace(/\/?\.git\/?$/, "");
  if (!branch || !root) return;

  const statusFile = `${root}/.claude/vetor/status/${branch.replaceAll("/", "-")}.md`;
  let content: string;
  try {
    content = Deno.readTextFileSync(statusFile);
  } catch {
    // Sem status file, a branch não pertence ao fluxo do coordinator: não interfere.
    return;
  }

  const status = content.match(/^Status: *(.+)$/m)?.[1]?.trim();
  if (status !== "GREEN") {
    blocked(
      `ERROR: worker não-GREEN (Status: ${status ?? "desconhecido"}) — push/PR bloqueado pelo Vetor Safety Hook.\n` +
        "Registre BLOCKED_WAITING no status file se precisar de intervenção; o worktree-ship faz a entrega após GREEN.",
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

  const command = input.tool_input?.command;
  if (!command) Deno.exit(0);

  const dest = pushDestination(command);
  if (dest && PROTECTED_BRANCHES.includes(dest)) {
    blocked(
      "ERROR: Push to protected branches (main, master, production) is prohibited by Vetor Safety Hook.",
    );
  }

  await checkNonGreenWorker(command, input.cwd ?? Deno.cwd());
  Deno.exit(0);
}

await main();
