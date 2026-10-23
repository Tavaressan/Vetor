// Política de segurança do Vetor para comandos de shell, compartilhada pelo hook do Claude Code
// (scripts/safety-check.ts) e pelo hook do Antigravity (scripts/safety-check-antigravity.ts).
//
// Devolve uma decisão em vez de encerrar o processo: cada hook traduz a decisão para o contrato
// do seu harness (exit 2 + mensagem em stderr no Claude Code; JSON no stdout no Antigravity).
//
// Três regras, avaliadas nesta ordem:
//   Git destrutivo — bloqueado incondicionalmente.
//   Branch protegida — não empurrar para main, master ou production.
//   Worker não-GREEN — dentro de um worktree linkado, não fazer push/PR enquanto o status file
//                      do worker não estiver GREEN.

import { readStatus, statusFilePath, type WorktreeInfo } from "./status.ts";

export type SafetyDecision = { decision: "allow" } | { decision: "deny"; reason: string };

const PROTECTED_BRANCHES = ["main", "master", "production"];

/** Extrai a branch de destino de um `git push [flags] [remote] <branch>[:<remote-branch>]`. */
function pushDestination(command: string): string | null {
  // Continuações de linha (`\` + newline) fazem parte do mesmo comando shell — junte-as antes de
  // isolar por quebra de linha real, senão `git push \` seguido de `origin master` escaparia do
  // regex abaixo e o destino real (`master`) nunca seria capturado.
  const joined = command.replace(/\\\r?\n/g, " ");
  const push = joined.match(/git push[^&|;\n]*/)?.[0];
  if (!push) return null;

  const last = push.trim().split(/\s+/).pop();
  if (!last || last.startsWith("-")) return null;
  return last.split(":")[0];
}

/**
 * Casa `git push`/`gh pr (create|ready|merge)` apenas no início do comando ou logo após um
 * separador de shell (`&&`, `||`, `;`, `|`) — nunca em qualquer posição da string. Sem isso,
 * o mesmo texto aparecendo como conteúdo dentro de um heredoc (ou de qualquer outra string, ex.
 * um `grep`/`echo` cujo argumento cita "git push") era tratado como se fosse o comando em si
 * (issue #161, mesma classe de falha do match ingênuo da #4/#123).
 */
const WORKER_GATE_COMMAND_RE = /(?:^|&&|\|\||;|\|)\s*(git push|gh pr (?:create|ready|merge))/;

/**
 * Comandos git destrutivos que descartam trabalho local sem chance de recuperação — bloqueados
 * incondicionalmente, independente de worktree/status file (ao contrário do WORKER_GATE_COMMAND_RE
 * acima, que só se aplica a workers não-GREEN). Mesma ancoragem: só casa no início do comando ou
 * logo após um separador de shell, nunca em qualquer posição da string — senão o mesmo texto
 * aparecendo como conteúdo dentro de um heredoc/echo seria tratado como se fosse o comando em si
 * (mesma classe de falso positivo das issues #123/#161). `git checkout \.` exige que o ponto seja
 * o argumento inteiro (fim do comando ou espaço em seguida) para não casar `git checkout .github`
 * (issue #184). `-[a-z]*f[a-z]*` casa `-f` em qualquer posição dentro do flag combinado de
 * `git clean` (ex.: `-xdf`, `-df`, não só `-fdx`) — a própria issue #184 cita `-xdf` como exemplo
 * que precisa ser bloqueado; achado do code-review da PR #200.
 */
const DESTRUCTIVE_GIT_COMMAND_RE =
  /(?:^|&&|\|\||;|\|)\s*(git\s+reset\s+--hard\S*|git\s+clean\s+-[a-z]*f[a-z]*|git\s+branch\s+-D\S*|git\s+checkout\s+\.(?=\s|$))/;

/** Devolve o motivo do bloqueio, ou null se o comando não é git destrutivo. */
function checkDestructiveGit(command: string): string | null {
  // Continuações de linha (`\` + newline) fazem parte do mesmo comando shell — junte-as antes do
  // match, senão `git reset \` seguido de `--hard` em nova linha escaparia do regex (mesma razão
  // documentada em pushDestination acima; achado do code-review da PR #200).
  const joined = command.replace(/\\\r?\n/g, " ");
  const match = joined.match(DESTRUCTIVE_GIT_COMMAND_RE);
  if (!match) return null;

  return `ERROR: comando git destrutivo bloqueado incondicionalmente pelo Vetor Safety Hook: "${
    match[1].trim()
  }"\n` +
    "git reset --hard / git clean -f* / git branch -D / git checkout . descartam trabalho " +
    "local sem chance de recuperação — não são permitidos em nenhum contexto.";
}

/** Devolve o motivo do bloqueio, ou null se o destino do push não é uma branch protegida. */
function checkProtectedPush(command: string): string | null {
  const dest = pushDestination(command);
  if (dest && PROTECTED_BRANCHES.includes(dest)) {
    return "ERROR: Push to protected branches (main, master, production) is prohibited by Vetor Safety Hook.";
  }
  return null;
}

/**
 * Devolve o motivo do bloqueio, ou null. O worktree só é resolvido (várias chamadas ao git)
 * quando o comando casa o gate de push/PR — os demais comandos nunca pagam esse custo.
 */
async function checkWorkerGate(
  command: string,
  getWorktree: () => Promise<WorktreeInfo | null>,
): Promise<string | null> {
  const gateMatch = command.match(WORKER_GATE_COMMAND_RE);
  if (!gateMatch) return null;

  const wt = await getWorktree();
  if (!wt?.isLinked) return null;

  let status = readStatus(statusFilePath(wt.root, wt.branch));
  // Issue #323: se o status file no root não estiver GREEN ou não existir,
  // consulta também o fallback local do worktree (<toplevel>/.claude/vetor-status.md)
  if (status !== "GREEN") {
    const localStatus = readStatus(`${wt.toplevel}/.claude/vetor-status.md`);
    if (localStatus === "GREEN") {
      status = "GREEN";
    } else if (status === null && localStatus !== null) {
      status = localStatus;
    }
  }
  // Sem status file, a branch não pertence ao fluxo do coordinator: não interfere.
  if (status === null) return null;

  if (status !== "GREEN") {
    return `ERROR: worker não-GREEN (Status: ${
      status || "desconhecido"
    }) — push/PR bloqueado pelo Vetor Safety Hook.\n` +
      `Trecho do comando que casou o gate: "${gateMatch[0].trim()}"\n` +
      "Registre BLOCKED_WAITING no status file se precisar de intervenção; o ship faz a entrega após GREEN.";
  }
  return null;
}

/**
 * Avalia um comando de shell contra as políticas do Vetor. `getWorktree` resolve o worktree do
 * contexto de execução do comando (cwd do evento) e só é chamado quando a política precisa dele.
 */
export async function evaluateShellCommand(
  command: string,
  getWorktree: () => Promise<WorktreeInfo | null>,
): Promise<SafetyDecision> {
  const reason = checkDestructiveGit(command) ??
    checkProtectedPush(command) ??
    await checkWorkerGate(command, getWorktree);

  return reason === null ? { decision: "allow" } : { decision: "deny", reason };
}
