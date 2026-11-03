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

/**
 * Casa o `git push` apenas na posição de comando (início, ou logo após `&`, `|`, `;` ou quebra de
 * linha), como o gate de worker (issue #161). Como as flags são ignoradas em qualquer posição, o
 * texto `git push origin main --force` dentro de uma mensagem de commit, heredoc ou echo seria
 * tomado por um push real. O custo é aceito: `VAR=x git push ...`, `(git push ...)` e
 * `then git push ...` não são reconhecidos.
 */
const PUSH_COMMAND_RE = /(?:^|[&|;\n])\s*(git push[^&|;\n]*)/;

/**
 * Extrai os destinos de um `git push [flags] [remote] [<src>[:<dst>]...]`: o lado direito de cada
 * refspec (ou o próprio token, quando não há `:`).
 *
 * Todo token que não é flag conta como destino possível, em qualquer posição — não só o último.
 * É a escolha mais simples e que falha para o lado seguro: sem uma lista de flags que recebem
 * valor em token separado (`-o <opção>`, `--repo <url>`, `--push-option <x>`), o valor da flag
 * nunca esconde o destino real (`git push origin main -o ci.skip`), e vários refspecs
 * (`git push origin feature main`) são todos avaliados. O custo é aceito: um remote ou valor de
 * flag chamado literalmente `main`/`master`/`production` também é bloqueado.
 */
function pushDestinations(command: string): string[] {
  // Continuações de linha (`\` + newline) fazem parte do mesmo comando shell — junte-as antes de
  // isolar por quebra de linha real, senão `git push \` seguido de `origin master` escaparia do
  // regex abaixo e o destino real (`master`) nunca seria capturado.
  const joined = command.replace(/\\\r?\n/g, " ");
  const push = joined.match(PUSH_COMMAND_RE)?.[1];
  if (!push) return [];

  return push.trim().split(/\s+/).slice(2)
    .filter((token) => !token.startsWith("-"))
    .map((token) => token.split(":").pop()!);
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
 * acima, que só se aplica a workers não-GREEN).
 *
 * Detecção em duas etapas (issues #184/#535/#547 e revisão da PR #549):
 *  1. `GIT_CMD_RE` localiza o `git` apenas em posição de comando — início, ou logo após uma
 *     fronteira (`\n ; & | ( ) { } ` ` ! $(`, `then/do/else/elif/if/while/until`), opcionalmente
 *     precedido de atribuições `VAR=val` e wrappers (`env`, `sudo`, `command`, `xargs`, `nice`,
 *     `time`, `exec`, `eval`, `sh`/`bash`/`zsh`... — cobre `sh -c "..."`, `bash -c $'...'`,
 *     scripts sem aspas, aninhamento de qualquer profundidade). Texto que apenas cita o comando
 *     no meio de um echo/heredoc/grep não casa (issues #123/#161/#184).
 *  2. O resto da linha é tokenizado (respeitando aspas, que são removidas), as opções globais do
 *     git são puladas (`isDestructiveGitArgs`) e o subcomando + flags são avaliados.
 *
 * Fail-closed: com `eval`, `source`, `| sh`/`| bash` o texto executado pode não ser analisável;
 * nesses casos qualquer `git` destrutivo em QUALQUER posição do comando bloqueia.
 *
 * Limitação conhecida (falha para o lado seguro): sem parser de shell completo, um separador ou
 * um git destrutivo dentro de string entre aspas bloqueia, ex.: uma mensagem de commit
 * `"fix; git <subcomando destrutivo>"`.
 */
const GIT_BOUNDARY = "(?:^|[\\n;&|(){}`!]|\\b(?:then|do|else|elif|if|while|until)\\s)";
const GIT_PREFIXES = "(?:[A-Za-z_]\\w*=(?:\"[^\"]*\"|'[^']*'|\\S*)\\s+|" +
  "(?:env|sudo|doas|command|builtin|xargs|nice|nohup|time|exec|eval|(?:\\S*/)?(?:ba|z|da|k)?sh)" +
  "\\s+(?:[^\\s;&|()`]+\\s+)*?)*";
const GIT_WORD = "[\\\\$\"']*(?:[^\\s\"';&|()`]*/)?git[\"']?(?=\\s)";
const GIT_CMD_RE = new RegExp(`${GIT_BOUNDARY}\\s*${GIT_PREFIXES}${GIT_WORD}([^;&|\\n)\`]*)`, "g");
/** Modo fail-closed: `git` em qualquer posição (só usado quando o texto executado é opaco). */
const GIT_ANYWHERE_RE = new RegExp(`(?<![\\w.-])${GIT_WORD}([^;&|\\n)\`]*)`, "g");
/** `eval`, `source`/`. /dev/stdin` e `| sh`/`| bash`: o que roda não é analisável. */
const OPAQUE_SHELL_RE =
  /\beval\b|\bsource\b|\|\s*(?:\S*\/)?(?:env\s+|sudo\s+)?(?:ba|z|da|k)?sh\b|(?:^|\s)\.\s+\/dev\/stdin/;

/** Opções globais do git que consomem o próximo token como valor. */
const GIT_VALUE_OPTS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
  "--super-prefix",
  "--attr-source",
]);
/** Opções globais do git sem valor (ou com valor colado via `=`). */
const GIT_FLAG_OPTS = new Set([
  "-p",
  "-P",
  "--paginate",
  "--no-pager",
  "--bare",
  "--no-replace-objects",
  "--literal-pathspecs",
  "--glob-pathspecs",
  "--noglob-pathspecs",
  "--icase-pathspecs",
  "--no-optional-locks",
  "--no-lazy-fetch",
  "--exec-path",
]);

function tokenize(text: string): string[] {
  const raw = text.replace(/\\\r?\n/g, " ").replace(/\\ /g, " ").match(
    /(?:"(?:[^"\\]|\\.)*"?|'[^']*'?|\\.|[^\s"'\\])+/g,
  ) ?? [];
  return raw.map((t) => t.replace(/^\$(?=["'])/, "").replace(/["'\\]/g, "")).filter((t) =>
    t && t !== "}"
  );
}

/**
 * Segunda leitura, sem agrupar por aspas: aspas sem fechar (ex.: restos de `sh -c "..."` cortados
 * no separador) fariam `tokenize` engolir o texto seguinte num token só. Fail-closed: bloqueia se
 * qualquer das duas leituras indicar git destrutivo.
 */
function naiveTokens(text: string): string[] {
  return text.replace(/["'\\]/g, "").split(/\s+/).filter((t) => t && t !== "}");
}

/** `--name` (ou abreviação sem ambiguidade com ao menos `min` caracteres), com ou sem `=valor`. */
function longFlag(arg: string, name: string, min: number): boolean {
  const flag = arg.split("=")[0];
  return flag.length >= min && flag.startsWith("--") && name.startsWith(flag);
}
/** Letras de um flag curto combinado (`-xdf` → "xdf"); "" se não for flag curto. */
function shortFlags(arg: string): string {
  return /^-[a-zA-Z]+$/.test(arg) ? arg.slice(1) : "";
}

function isDestructiveSubcommand(sub: string, args: string[]): boolean {
  const opts = args.includes("--") ? args.slice(0, args.indexOf("--")) : args;
  switch (sub) {
    case "reset":
      return opts.some((a) => longFlag(a, "--hard", 4));
    case "clean":
      return opts.some((a) => shortFlags(a).includes("f") || longFlag(a, "--force", 4));
    case "branch": {
      const force = opts.some((a) => shortFlags(a).includes("f") || longFlag(a, "--force", 4));
      const del = opts.some((a) => shortFlags(a).includes("d") || longFlag(a, "--delete", 4));
      return opts.some((a) => shortFlags(a).includes("D")) || (force && del);
    }
    case "checkout":
      return args.includes(".") ||
        (args.includes("--") && args.indexOf("--") < args.length - 1) ||
        opts.some((a) => shortFlags(a).includes("f") || longFlag(a, "--force", 4));
    case "switch":
      return opts.some((a) =>
        shortFlags(a).includes("f") || longFlag(a, "--force", 4) ||
        longFlag(a, "--discard-changes", 4)
      );
    case "restore": {
      // Só tira do stage (sem tocar o working tree) com `--staged`/`-S` sem `--worktree`/`-W`
      // — essa forma é liberada (issue #535).
      const staged = opts.some((a) => a === "--staged" || shortFlags(a).includes("S"));
      const worktree = opts.some((a) => a === "--worktree" || shortFlags(a).includes("W"));
      return !(staged && !worktree);
    }
    default:
      return false;
  }
}

const GIT_SUBCOMMANDS_CHECKED = new Set([
  "reset",
  "clean",
  "branch",
  "checkout",
  "switch",
  "restore",
]);

/** Teto de tokens por invocação git: acima disso o comando é negado (fail-closed, issue #547). */
const MAX_GIT_TOKENS = 2000;

/**
 * Pula as opções globais do git e avalia o subcomando (issue #547). Varredura linear e iterativa:
 * uma opção global desconhecida pode ou não consumir valor, então as duas posições seguintes
 * (i+1 e i+2) viram candidatas — marcadas num vetor de alcançáveis, sem ramificar (O(n), sem
 * recursão, logo sem estouro de pilha).
 */
export function isDestructiveGitArgs(tokens: string[]): boolean {
  const reach = new Uint8Array(tokens.length + 2);
  reach[0] = 1;
  for (let i = 0; i < tokens.length; i++) {
    if (!reach[i]) continue;
    const t = tokens[i];
    if (!t.startsWith("-")) {
      if (GIT_SUBCOMMANDS_CHECKED.has(t) && isDestructiveSubcommand(t, tokens.slice(i + 1))) {
        return true;
      }
    } else if (GIT_VALUE_OPTS.has(t)) {
      reach[i + 2] = 1;
    } else if (GIT_FLAG_OPTS.has(t) || /^-[Cc]./.test(t) || /^--[\w-]+=/.test(t)) {
      reach[i + 1] = 1;
    } else {
      // Opção global desconhecida: fail-closed, avalia as duas leituras.
      reach[i + 1] = 1;
      reach[i + 2] = 1;
    }
  }
  return false;
}

/** Devolve o motivo do bloqueio, ou null se o comando não é git destrutivo. */
function checkDestructiveGit(command: string): string | null {
  // Continuações de linha (`\` + newline) fazem parte do mesmo comando shell (issue #200).
  const joined = command.replace(/\\\r?\n/g, " ").replace(/\\ /g, " ");
  const re = OPAQUE_SHELL_RE.test(joined) ? GIT_ANYWHERE_RE : GIT_CMD_RE;
  const matches = [...joined.matchAll(re)];
  const tooLong = matches.find((m) => naiveTokens(m[1]).length > MAX_GIT_TOKENS);
  if (tooLong) {
    return `ERROR: comando git com mais de ${MAX_GIT_TOKENS} tokens bloqueado pelo Vetor Safety Hook ` +
      "(não é possível avaliá-lo com segurança; fail-closed).";
  }
  const match = matches.find((m) =>
    isDestructiveGitArgs(tokenize(m[1])) || isDestructiveGitArgs(naiveTokens(m[1]))
  );
  if (!match) return null;

  return `ERROR: comando git destrutivo bloqueado incondicionalmente pelo Vetor Safety Hook: "git ${
    match[1].trim()
  }"\n` +
    "git reset --hard / git clean -f* / git branch -D / git checkout . / git checkout -- <path> / git checkout -f / git switch --discard-changes / git restore <path> descartam trabalho " +
    "local sem chance de recuperação — não são permitidos em nenhum contexto. " +
    "(`git restore --staged <path>`, que só tira do stage, continua permitido.)";
}

/** Devolve o motivo do bloqueio, ou null se o destino do push não é uma branch protegida. */
function checkProtectedPush(command: string): string | null {
  if (pushDestinations(command).some((dest) => PROTECTED_BRANCHES.includes(dest))) {
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
  if (status !== "GREEN" && status !== "PR_STAGED") {
    const localStatus = readStatus(`${wt.toplevel}/.claude/vetor-status.md`);
    if (localStatus === "GREEN" || localStatus === "PR_STAGED") {
      status = "GREEN";
    } else if (status === null && localStatus !== null) {
      status = localStatus;
    }
  }
  // Sem status file, a branch não pertence ao fluxo do coordinator: não interfere.
  if (status === null) return null;

  if (status !== "GREEN" && status !== "PR_STAGED") {
    return `ERROR: worker não-GREEN nem PR_STAGED (Status: ${
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

/**
 * Como `evaluateShellCommand`, mas qualquer exceção na avaliação vira negação (fail-closed):
 * um erro inesperado nunca pode liberar o comando (exit 1 não bloqueia no Claude Code).
 */
export async function evaluateShellCommandSafe(
  command: string,
  getWorktree: () => Promise<WorktreeInfo | null>,
  evaluate: typeof evaluateShellCommand = evaluateShellCommand,
): Promise<SafetyDecision> {
  try {
    return await evaluate(command, getWorktree);
  } catch (e) {
    return {
      decision: "deny",
      reason: "ERROR: falha ao avaliar o comando no Vetor Safety Hook — bloqueado por precaução " +
        `(fail-closed): ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
