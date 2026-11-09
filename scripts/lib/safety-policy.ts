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
 * Texto inerte (issue #563): antes das duas etapas, `maskInertText` apaga o conteúdo que só cita
 * um comando — argumentos entre aspas de comandos que nunca executam texto, mensagens de
 * `git -m`/`--message`, `--body`/`--title` do `gh` e corpos de heredoc enviados a esses comandos.
 * Se o texto mascarado ainda tiver contexto executor (`eval`, `| sh`...), a análise volta ao texto
 * original, sem máscara.
 */
const GIT_BOUNDARY = "(?:^|[\\n;&|(){}`!]|\\b(?:then|do|else|elif|if|while|until)\\s)";
const GIT_PREFIXES = "(?:[A-Za-z_]\\w*=(?:\"[^\"]*\"|'[^']*'|\\S*)\\s+|" +
  "(?:env|sudo|doas|command|builtin|xargs|nice|nohup|time|exec|eval|(?:\\S*/)?(?:ba|z|da|k)?sh)" +
  "\\s+(?:[^\\s;&|()`]+\\s+)*?)*";
const GIT_WORD = "[\\\\$\"']*(?:[^\\s\"';&|()`]*/)?git[\"']?(?=\\s)";
// A captura para em `(`: sem isso, `git commit -m "$(git <destrutivo>)"` consumia a substituição
// no primeiro casamento e o git interno nunca era avaliado (issue #563).
const GIT_CMD_RE = new RegExp(`${GIT_BOUNDARY}\\s*${GIT_PREFIXES}${GIT_WORD}([^;&|\\n()\`]*)`, "g");
/** Modo fail-closed: `git` em qualquer posição (só usado quando o texto executado é opaco). */
const GIT_ANYWHERE_RE = new RegExp(`(?<![\\w.-])${GIT_WORD}([^;&|\\n()\`]*)`, "g");
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

/** Comandos que nunca executam o texto dos seus argumentos nem do stdin (issue #563). */
const INERT_COMMANDS = new Set(["echo", "printf", "cat", "tee", "grep", "egrep", "fgrep"]);
/** Por comando, as flags cujo valor é só texto: mensagem de commit/tag, corpo e título de PR. */
const TEXT_FLAGS: Record<string, RegExp> = {
  git: /^(?:-[a-zA-Z]*m|--message=?)$/,
  gh: /^(?:-[bt]|--body=?|--title=?)$/,
};
/** Consumidores de heredoc cujo stdin é só dado (`git commit -F -`, `gh ... --body-file -`). */
const HEREDOC_TEXT_CONSUMERS = new Set([...INERT_COMMANDS, "git", "gh"]);
const ASSIGNMENT_RE = /^[A-Za-z_]\w*=/;
/**
 * Depois da máscara, um shell, `eval`, `source`, `.` ou `xargs` ainda em posição de comando pode
 * executar o texto mascarado (ex.: heredoc gravado num arquivo e rodado com `bash` em seguida).
 * Nesse caso a análise usa o texto original.
 */
const EXECUTOR_AFTER_MASK_RE =
  /(?:^|[\s;&|(`])(?:\S*\/)?(?:(?:ba|z|da|k|fi)?sh|source|eval|xargs)(?=\s|$)|(?:^|[;&|(`\n])\s*\.\s/;
const HEREDOC_RE = /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|\\?([A-Za-z_][\w.-]*))/;

interface Segment {
  words: string[];
  current: string;
}
interface PendingHeredoc {
  delimiter: string;
  stripTabs: boolean;
  quoted: boolean;
  consumer: string | undefined;
}

const commandOf = (seg: Segment): string | undefined => {
  const word = [...seg.words, seg.current].find((w) => w && !ASSIGNMENT_RE.test(w));
  return word?.split("/").pop();
};

/**
 * Devolve `text` com o mesmo comprimento e o conteúdo inerte trocado por `_` (issue #563). Mantém
 * as posições, então o restante da análise roda sobre o resultado sem outra mudança.
 *
 * Inerte é só o que nenhum contexto executa: aspas simples ou duplas sem `$(`/crase, sem `!` no
 * início (alias do git) e terminadas, quando são argumento de um comando de `INERT_COMMANDS` ou o
 * valor de uma flag de `TEXT_FLAGS`; e corpo de heredoc terminado, enviado a um consumidor de
 * `HEREDOC_TEXT_CONSUMERS`, com delimitador entre aspas ou sem substituição. Na dúvida, não mascara.
 */
export function maskInertText(text: string): string {
  const out = text.split("");
  const mask = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = "_";
  };
  const pending: PendingHeredoc[] = [];
  let i = 0;

  const maskableQuote = (seg: Segment, content: string, hasSubst: boolean): boolean => {
    // Só texto com espaço ou metacaractere: um token único entre aspas (`"."`, `"--hard"`) pode ser
    // argumento real de um comando, e não é a origem do falso positivo.
    if (hasSubst || content.trimStart().startsWith("!") || !/[\s;&|<>()]/.test(content)) {
      return false;
    }
    const command = commandOf(seg);
    if (!command || seg.words.length === 0 && !seg.current) return false;
    if (INERT_COMMANDS.has(command)) return true;
    const flags = TEXT_FLAGS[command];
    const flag = seg.current || seg.words[seg.words.length - 1];
    return flags !== undefined && flags.test(flag);
  };

  /** Lê corpos de heredoc pendentes a partir de `start` (início da linha seguinte). */
  const readHeredocBodies = (start: number): number => {
    let pos = start;
    while (pending.length > 0) {
      const doc = pending.shift()!;
      let lineStart = pos;
      let terminated = false;
      let hasSubst = false;
      while (lineStart <= text.length) {
        const nl = text.indexOf("\n", lineStart);
        const lineEnd = nl === -1 ? text.length : nl;
        const line = text.slice(lineStart, lineEnd);
        if ((doc.stripTabs ? line.replace(/^\t+/, "") : line) === doc.delimiter) {
          const maskable = doc.consumer !== undefined && HEREDOC_TEXT_CONSUMERS.has(doc.consumer) &&
            (doc.quoted || !hasSubst);
          if (maskable) mask(pos, lineStart);
          pos = nl === -1 ? text.length : nl + 1;
          terminated = true;
          break;
        }
        if (/\$\(|`/.test(line)) hasSubst = true;
        if (nl === -1) break;
        lineStart = nl + 1;
      }
      // Sem terminador o resto do texto é corpo: nada é mascarado e a análise vê tudo.
      if (!terminated) return text.length;
    }
    return pos;
  };

  /** Fecha uma aspa a partir de `i` (logo após a abertura). Devolve o índice do fechamento. */
  const closeSingle = (from: number, ansi: boolean): number => {
    for (let k = from; k < text.length; k++) {
      if (ansi && text[k] === "\\") k++;
      else if (text[k] === "'") return k;
    }
    return -1;
  };

  /**
   * Varre um contexto sem aspas (topo, `$(...)` ou crase) até `stop` (`)` ou crase). Devolve o
   * índice logo após o fechamento, ou o fim do texto.
   */
  const scanUnquoted = (stop: string | null): number => {
    let seg: Segment = { words: [], current: "" };
    const endWord = () => {
      if (seg.current) seg.words.push(seg.current);
      seg.current = "";
    };
    const newSegment = () => {
      endWord();
      seg = { words: [], current: "" };
    };
    while (i < text.length) {
      const c = text[i];
      if (stop !== null && c === stop) {
        i++;
        return i;
      }
      if (c === "\\") {
        seg.current += text[i + 1] ?? "";
        i += 2;
      } else if (c === "'" || (c === "$" && text[i + 1] === "'")) {
        const ansi = c === "$";
        const open = ansi ? i + 2 : i + 1;
        const close = closeSingle(open, ansi);
        if (close === -1) return text.length;
        const content = text.slice(open, close);
        if (maskableQuote(seg, content, false)) mask(open, close);
        seg.current += content || "_";
        i = close + 1;
      } else if (c === '"') {
        const open = i + 1;
        i = open;
        const hasSubst = scanDouble();
        if (i > text.length) return text.length;
        const content = text.slice(open, i - 1);
        if (maskableQuote(seg, content, hasSubst)) mask(open, i - 1);
        seg.current += content || "_";
      } else if (c === "$" && text[i + 1] === "(") {
        i += 2;
        scanUnquoted(")");
        seg.current += "_";
      } else if (c === "`") {
        i++;
        scanUnquoted("`");
        seg.current += "_";
      } else if (c === "<" && text[i + 1] === "<" && text[i + 2] !== "<") {
        const m = text.slice(i).match(HEREDOC_RE);
        if (m) {
          pending.push({
            delimiter: m[2] ?? m[3] ?? m[4],
            stripTabs: m[1] === "-",
            quoted: m[2] !== undefined || m[3] !== undefined || m[0].includes("\\"),
            consumer: commandOf(seg),
          });
          endWord();
          i += m[0].length;
        } else {
          i += 2;
        }
      } else if (c === "\n") {
        newSegment();
        i = pending.length > 0 ? readHeredocBodies(i + 1) : i + 1;
      } else if (";&|()".includes(c)) {
        newSegment();
        i++;
      } else if (c === " " || c === "\t") {
        endWord();
        i++;
      } else {
        seg.current += c;
        i++;
      }
    }
    return text.length;
  };

  /** Varre o interior de aspas duplas a partir de `i`. Devolve se houve substituição. */
  const scanDouble = (): boolean => {
    let hasSubst = false;
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") {
        i += 2;
      } else if (c === '"') {
        i++;
        return hasSubst;
      } else if (c === "$" && text[i + 1] === "(") {
        hasSubst = true;
        i += 2;
        scanUnquoted(")");
      } else if (c === "`") {
        hasSubst = true;
        i++;
        scanUnquoted("`");
      } else {
        i++;
      }
    }
    // Aspas sem fechamento: sinaliza ao chamador para não mascarar.
    i = text.length + 1;
    return true;
  };

  scanUnquoted(null);
  return out.join("");
}

/** Devolve o motivo do bloqueio, ou null se o comando não é git destrutivo. */
function checkDestructiveGit(command: string): string | null {
  // Continuações de linha (`\` + newline) fazem parte do mesmo comando shell (issue #200).
  const raw = command.replace(/\\\r?\n/g, " ").replace(/\\ /g, " ");
  const masked = maskInertText(raw);
  // Contexto executor no que sobrou: o texto mascarado pode ser executado, então volta ao original.
  const joined = EXECUTOR_AFTER_MASK_RE.test(masked) ? raw : masked;
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
