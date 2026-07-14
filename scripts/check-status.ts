// Guarda do status file (hook SubagentStop, matcher vetor:issue-worker).
//
// O issue-coordinator agrega o andamento dos workers lendo <root>/.claude/vetor/status/.
// Um worker que termina sem escrever o seu status file some do painel sem deixar rastro.
// Aqui, se o status estiver ausente ou ainda RUNNING, o worker é impedido de encerrar e
// volta a trabalhar — com o motivo no contexto.
//
// Contrato do Claude Code: exit 0 + {"decision":"block","reason":...} impede o subagente
// de parar. Não existe campo de reentrância (como o stop_hook_active do Stop), então a
// proteção contra loop é nossa: bloqueia UMA vez por agente, via arquivo sentinela. Na
// segunda passagem deixa terminar — o coordinator já trata worker sem status como falha.

import { isTerminal, readStatus, resolveWorktree, statusFilePath } from "./lib/status.ts";

interface HookInput {
  cwd?: string;
  agent_id?: string;
}

function allow(): never {
  Deno.exit(0);
}

function block(reason: string): never {
  console.log(JSON.stringify({ decision: "block", reason }));
  Deno.exit(0);
}

function sentinelPath(statusFile: string): string {
  return `${statusFile}.stopguard`;
}

/** True se este mesmo agente já foi bloqueado uma vez. */
function alreadyBlocked(sentinel: string, agentId: string): boolean {
  try {
    return Deno.readTextFileSync(sentinel).trim() === agentId;
  } catch {
    return false;
  }
}

async function main() {
  const raw = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer());

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    allow();
  }

  const wt = await resolveWorktree(input.cwd ?? Deno.cwd());
  if (!wt) allow();

  const statusFile = statusFilePath(wt.root, wt.branch);
  const sentinel = sentinelPath(statusFile);
  const status = readStatus(statusFile);

  if (isTerminal(status)) {
    try {
      Deno.removeSync(sentinel);
    } catch { /* nunca houve bloqueio: nada a limpar */ }
    allow();
  }

  const agentId = input.agent_id ?? "unknown";
  if (alreadyBlocked(sentinel, agentId)) allow();

  try {
    Deno.mkdirSync(`${wt.root}/.claude/vetor/status`, { recursive: true });
    Deno.writeTextFileSync(sentinel, agentId);
  } catch {
    // Sem conseguir marcar, bloquear arriscaria um loop infinito.
    allow();
  }

  const observed = status === null ? "arquivo ausente" : `Status: ${status || "vazio"}`;
  block(
    `O status file do worker não está em estado terminal (${observed}).\n` +
      `Escreva ${statusFile} com um Status entre GREEN, FAILED_MAX_ITERATIONS ou ` +
      "BLOCKED_WAITING antes de encerrar — o issue-coordinator depende dele para agregar o " +
      "resultado. O formato está em skills/shared/references/agent-status.template.md.",
  );
}

await main();
