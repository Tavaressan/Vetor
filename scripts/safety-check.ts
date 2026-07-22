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
//   Edit/Write  — dentro de um worktree, não escrever fora dele; um agente vetor:issue-worker
//                 nunca deveria escrever com cwd resolvendo para a raiz do projeto (fora de
//                 qualquer worktree linkado) — se acontecer, é sinal de cwd mal resolvido pelo
//                 harness, não uma escrita legítima (ver issue #57). No Codex, edição de arquivo
//                 chega como tool_name "apply_patch" (nunca "Edit"/"Write" — só aliases de
//                 matcher no hooks.json) com um patch multi-arquivo em tool_input.command, em
//                 vez de tool_input.file_path — mesma política, paths extraídos do patch
//                 (ver issue #76).
//   Binding     — segunda camada, independente do guard acima: com múltiplos workers em
//                 paralelo (ver issue #63), o cwd recebido no payload pode contaminar entre
//                 subagentes — o cwd resolve para um worktree real, só que de OUTRO worker
//                 ativo na mesma sessão. `isLinked` sozinho não pega esse caso. Aqui
//                 correlacionamos `agent_id` (estável por instância de subagente, diferente
//                 de `agent_type`) com o worktree resolvido na primeira chamada; uma mudança
//                 de worktree para o mesmo agent_id é bloqueada.

import { isWriteAllowed } from "./lib/guard.ts";
import { run } from "./lib/project.ts";
import {
  agentBindingPath,
  readStatus,
  resolveWorktree,
  statusFilePath,
  type WorktreeInfo,
} from "./lib/status.ts";
import { evaluateFreshness } from "./lib/worktree.ts";

const PROTECTED_BRANCHES = ["main", "master", "production"];

interface HookInput {
  tool_name?: string;
  /** command é string no Bash; array (["apply_patch", "<patch>"]) no apply_patch do Codex. */
  tool_input?: { command?: string | string[]; file_path?: string };
  cwd?: string;
  /** Presente quando o hook dispara dentro de um subagente (ex.: "vetor:issue-worker"). */
  agent_type?: string;
  /** Identificador único da instância do subagente — estável entre chamadas, ao contrário de agent_type. */
  agent_id?: string;
}

const APPLY_PATCH_PATH_RE = /^\*\*\* (?:Add File|Delete File|Update File|Move to): (.+)$/gm;

/**
 * Extrai os paths tocados por um patch do apply_patch (formato descrito em
 * https://github.com/openai/codex/blob/main/codex-rs/core/gpt_5_2_prompt.md): um envelope com
 * uma ou mais operações "Add/Delete/Update File" e "Move to" opcional por operação.
 */
function extractApplyPatchPaths(command: string | string[] | undefined): string[] {
  const patchText = Array.isArray(command) ? command.at(-1) : command;
  if (!patchText) return [];

  return [...patchText.matchAll(APPLY_PATCH_PATH_RE)].map((match) => match[1].trim());
}

function resolveAgainstCwd(path: string, cwd: string): string {
  return path.startsWith("/") ? path : `${cwd}/${path}`;
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

/**
 * Segunda camada de defesa contra cwd contaminado (issue #63): sem `agent_id` não há como
 * correlacionar, então não se aplica — não é regressão, é a mesma cobertura de antes.
 * Na primeira chamada de um `agent_id`, grava o worktree resolvido; em chamadas seguintes,
 * uma mudança de worktree para o MESMO agent_id indica cwd contaminado — bloqueia.
 */
function checkAgentBinding(root: string, agentId: string | undefined, toplevel: string): void {
  if (!agentId) return;

  const path = agentBindingPath(root, agentId);
  let bound: string | null = null;
  try {
    bound = Deno.readTextFileSync(path).trim();
  } catch {
    // Primeira chamada deste agent_id: nada gravado ainda.
  }

  if (bound && bound !== toplevel) {
    blocked(
      `ERROR: cwd contaminado detectado pelo Vetor Safety Hook (issue #63): agent_id ${agentId} ` +
        `já estava vinculado ao worktree ${bound}, mas este evento resolveu para ${toplevel}.\n` +
        "Isso indica cwd entregue incorretamente pelo harness durante execução paralela de " +
        "subagentes — a escrita foi bloqueada para não vazar entre workers.",
    );
  }

  if (!bound) {
    try {
      Deno.mkdirSync(`${root}/.claude/vetor/status/.agent-cwd`, { recursive: true });
      Deno.writeTextFileSync(path, `${toplevel}\n`);
    } catch {
      // Sem conseguir gravar o vínculo, a checagem principal (isWriteAllowed) já cobre
      // a política de escrita — a ausência do vínculo só reduz a segunda camada.
    }
  }
}

async function checkWrite(
  filePath: string,
  cwd: string,
  agentType?: string,
  agentId?: string,
): Promise<void> {
  let wt = await resolveWorktree(cwd);

  // Issue #103: If the payload's cwd is contaminated, but the agent provides an absolute filePath
  // that points to its bound worktree, we should override the contaminated cwd and use the bound worktree.
  if (agentId && wt?.root && filePath.startsWith("/")) {
    const path = agentBindingPath(wt.root, agentId);
    try {
      const bound = Deno.readTextFileSync(path).trim();
      if (bound && bound !== wt.toplevel && filePath.startsWith(bound)) {
        const boundWt = await resolveWorktree(bound);
        if (boundWt) wt = boundWt;
      }
    } catch {
      // No binding yet
    }
  }

  if (!wt?.isLinked) {
    // Um vetor:issue-worker deveria estar sempre dentro do seu worktree isolado. cwd
    // resolvendo para fora de um worktree linkado (ex.: a raiz do projeto) indica cwd
    // incorreto entregue pelo harness — deixar passar contamina a raiz compartilhada por
    // todos os workers em paralelo (reprodução real: issue #57).
    if (agentType === "vetor:issue-worker") {
      blocked(
        `ERROR: vetor:issue-worker escrevendo com cwd fora de um worktree linkado: ${filePath}\n` +
          `cwd resolvido: ${cwd}${wt ? ` (branch: ${wt.branch})` : ""}. Um issue-worker só ` +
          "deveria escrever dentro do seu próprio worktree — bloqueado pelo Vetor Safety Hook.",
      );
    }
    return;
  }

  checkAgentBinding(wt.root, agentId, wt.toplevel);

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
    if (filePath) await checkWrite(filePath, cwd, input.agent_type, input.agent_id);
    Deno.exit(0);
  }

  if (input.tool_name === "apply_patch") {
    for (const path of extractApplyPatchPaths(input.tool_input?.command)) {
      await checkWrite(resolveAgainstCwd(path, cwd), cwd, input.agent_type, input.agent_id);
    }
    Deno.exit(0);
  }

  const command = input.tool_input?.command;
  if (typeof command === "string") checkBash(command, wt);
  Deno.exit(0);
}

await main();
