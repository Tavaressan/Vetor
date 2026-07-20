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

import {
  isTerminal,
  prepareFailedMarkerPath,
  readStatus,
  resolveWorktree,
  statusFilePath,
} from "./lib/status.ts";

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
    // Primeira linha do sentinel é o agent_id; a segunda (opcional) é o cwd bruto, só para
    // correlação em diagnóstico — não entra na comparação de identidade.
    return Deno.readTextFileSync(sentinel).split("\n")[0].trim() === agentId;
  } catch {
    return false;
  }
}

/** Conteúdo do marcador gravado por prepareDeps quando a instalação de deps falhou, se houver. */
function readPrepareFailedWarning(worktreeToplevel: string): string | null {
  try {
    return Deno.readTextFileSync(prepareFailedMarkerPath(worktreeToplevel)).trim();
  } catch {
    return null;
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

  const rawCwd = input.cwd ?? Deno.cwd();
  const wt = await resolveWorktree(rawCwd);
  if (!wt) allow();

  // O matcher deste hook (vetor:issue-worker) só deveria disparar dentro de um worktree
  // linkado (.claude/worktrees/<slug>). Se cwd resolveu para a raiz do repositório principal
  // (isLinked: false), algo entregou um cwd incorreto ao agente — rastrear/bloquear aqui
  // criaria um stopguard órfão para uma branch que não é de worker (issue #57).
  if (!wt.isLinked) {
    console.error(
      `[vetor] AVISO: check-status disparou com cwd fora de um worktree linkado (${rawCwd}); ` +
        `resolveu para a raiz do repositório (branch: ${wt.branch}). Ignorando.`,
    );
    allow();
  }

  const statusFile = statusFilePath(wt.root, wt.branch);
  const sentinel = sentinelPath(statusFile);
  const status = readStatus(statusFile);
  const prepareWarning = readPrepareFailedWarning(wt.toplevel);

  if (isTerminal(status)) {
    try {
      Deno.removeSync(sentinel);
    } catch { /* nunca houve bloqueio: nada a limpar */ }
    if (prepareWarning) {
      console.error(
        `[vetor] AVISO: preparação de dependências falhou neste worktree: ${prepareWarning}`,
      );
    }
    allow();
  }

  const agentId = input.agent_id ?? "unknown";
  if (alreadyBlocked(sentinel, agentId)) allow();

  try {
    Deno.mkdirSync(`${wt.root}/.claude/vetor/status`, { recursive: true });
    Deno.writeTextFileSync(sentinel, `${agentId}\n${rawCwd}\n`);
  } catch {
    // Sem conseguir marcar, bloquear arriscaria um loop infinito.
    allow();
  }

  const observed = status === null ? "arquivo ausente" : `Status: ${status || "vazio"}`;
  const prepareNote = prepareWarning
    ? `\n\nAVISO: a preparação de dependências deste worktree falhou: ${prepareWarning}\n` +
      "Instale as dependências manualmente antes de rodar testes."
    : "";
  block(
    `O status file do worker não está em estado terminal (${observed}).\n` +
      `Escreva ${statusFile} com um Status entre GREEN, FAILED_MAX_ITERATIONS ou ` +
      "BLOCKED_WAITING antes de encerrar — o issue-coordinator depende dele para agregar o " +
      "resultado. O formato está em skills/shared/references/agent-status.template.md." +
      prepareNote,
  );
}

await main();
