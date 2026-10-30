// CLI da Async Decision Inbox (RF-03/RF-04, issue #500). Uma SKILL.md é prosa interpretada por um
// agente; este wrapper expõe scripts/lib/decision-inbox.ts para o coordinator suspender, listar e
// resolver decisões sem editar JSON e status file à mão.
//
// Uso:
//   deno run -A scripts/decision-inbox.ts suspend --status-file <path> --worktree <path> \
//     [--timeout <segundos>] [--root <repo-root>]
//   deno run -A scripts/decision-inbox.ts list [--root <repo-root>]
//   deno run -A scripts/decision-inbox.ts resolve --id <dec-issue-N> \
//     (--option <n> | --decision-file <path> | --optimistic) [--root <repo-root>]
//   deno run -A scripts/decision-inbox.ts drop --id <dec-issue-N> [--root <repo-root>]
//
// `drop` tira a pendência da inbox sem retomar o worker: é a ejeção graciosa (issue #501), e quem
// grava `Status: EJECTED` é o coordinator.
//
// Todo comando imprime JSON no stdout. `--root` é o root do repositório principal; omitido, vem do
// cwd (inclusive de dentro de um worktree). Sem `--timeout` a pendência nunca expira: é o caso de
// um bloqueio de permissão, que não é auto-aprovado.
//
// `resolve` aceita exatamente uma fonte da decisão. Texto do usuário nunca vai na linha de comando
// (injeção de shell): `--option` escolhe uma das opções gravadas (1 = primeira) e texto livre vai
// num arquivo escrito pelo coordinator (`--decision-file`). `--optimistic` aplica a opção
// `(Recommended)` do worker, cria antes a tag local `_vetor_checkpoint_*` e não resolve nada se a
// tag falhar.

import {
  createCheckpointTag,
  dropDecision,
  type InboxDecision,
  loadInbox,
  resolveDecision,
  secondsLeft,
  suspendBlocked,
} from "./lib/decision-inbox.ts";
import { resolveWorktree } from "./lib/status.ts";

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx === -1 ? undefined : args[idx + 1];
}

function fail(message: string): never {
  console.error(`decision-inbox: ${message}`);
  Deno.exit(1);
}

function requireFlag(args: string[], flag: string): string {
  return flagValue(args, flag) ?? fail(`flag obrigatória ausente: ${flag}`);
}

async function repoRoot(args: string[]): Promise<string> {
  const explicit = flagValue(args, "--root");
  if (explicit) return explicit;
  return (await resolveWorktree(Deno.cwd()))?.root ??
    fail("não consegui resolver o root do repositório: use --root");
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function suspend(args: string[]): Promise<void> {
  const timeout = flagValue(args, "--timeout");
  if (timeout !== undefined && !/^\d+$/.test(timeout)) {
    fail(`--timeout deve ser um número de segundos, recebido: ${timeout}`);
  }
  print(suspendBlocked({
    root: await repoRoot(args),
    statusFile: requireFlag(args, "--status-file"),
    worktreePath: requireFlag(args, "--worktree"),
    timeoutSeconds: timeout === undefined ? null : Number(timeout),
  }));
}

async function list(args: string[]): Promise<void> {
  const now = new Date();
  const inbox = loadInbox(await repoRoot(args), now);
  print({
    sessionId: inbox.sessionId,
    pendingDecisions: inbox.pendingDecisions.map((entry: InboxDecision) => {
      const left = secondsLeft(entry, now);
      return { ...entry, secondsLeft: left, expired: left === 0 };
    }),
  });
}

/** Texto da decisão a partir da única fonte informada; `--optimistic` usa a opção recomendada. */
function decisionText(args: string[], entry: InboxDecision): string {
  const option = flagValue(args, "--option");
  const file = flagValue(args, "--decision-file");
  const optimistic = args.includes("--optimistic");
  if (
    [option, file, optimistic || undefined].filter((source) => source !== undefined).length !== 1
  ) {
    fail("informe exatamente uma fonte da decisão: --option, --decision-file ou --optimistic");
  }

  if (optimistic) {
    return `${entry.options[entry.recommendedIndex] ?? "recomendação do worker"} (Recommended)`;
  }
  if (option !== undefined) {
    const chosen = /^\d+$/.test(option) ? entry.options[Number(option) - 1] : undefined;
    return chosen ?? fail(`--option deve ser de 1 a ${entry.options.length}, recebido: ${option}`);
  }
  const text = Deno.readTextFileSync(file as string).trim();
  return text || fail(`--decision-file vazio: ${file}`);
}

async function resolve(args: string[]): Promise<void> {
  const root = await repoRoot(args);
  const id = requireFlag(args, "--id");
  const optimistic = args.includes("--optimistic");
  const now = new Date();

  const entry = loadInbox(root, now).pendingDecisions.find((candidate) => candidate.id === id) ??
    fail(`decisão não encontrada na inbox: ${id}`);
  // Sem timeout é bloqueio de permissão: nenhuma permissão é auto-aprovada, nem pelo temporizador.
  if (optimistic && entry.timeoutSeconds === null) {
    fail(
      `${id} foi suspensa sem timeout: o avanço otimista não se aplica, espere a decisão humana`,
    );
  }
  const decision = decisionText(args, entry);

  const checkpointTag = optimistic
    ? await createCheckpointTag(
      root,
      entry.branch,
      now,
      `Checkpoint do Vetor antes do avanço otimista (${id})`,
    )
    : undefined;
  const resolved = resolveDecision({ root, id, decision, optimistic, checkpointTag, now });
  print({ ...resolved, decision, checkpointTag: checkpointTag ?? null });
}

async function drop(args: string[]): Promise<void> {
  print(dropDecision(await repoRoot(args), requireFlag(args, "--id")));
}

if (import.meta.main) {
  const [command, ...args] = Deno.args;
  try {
    if (command === "suspend") await suspend(args);
    else if (command === "list") await list(args);
    else if (command === "resolve") await resolve(args);
    else if (command === "drop") await drop(args);
    else fail("uso: decision-inbox.ts <suspend|list|resolve|drop> [flags]");
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
