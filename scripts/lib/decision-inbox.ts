// Async Decision Inbox (RF-03 e RF-04 de docs/specs/autonomia-continua-e-desacoplamento-interativo.md,
// issue #500).
//
// Um worker em BLOCKED_WAITING deixa de ocupar uma vaga do teto N: o coordinator o move para
// SUSPENDED, grava a dúvida em <root>/.claude/vetor/decision-inbox.json e despacha o próximo grupo
// QUEUED. O status file continua sendo a fonte de verdade — o SUSPENDED mantém os blocos
// `Blocked on`/`Options`/`Recommendation` e acrescenta `Suspended at`, `Worktree` e `Timeout`, o
// bastante para reconstruir a inbox se o JSON for apagado ou corrompido.

import { run } from "./project.ts";
import { statusFilePath } from "./status.ts";

export interface InboxDecision {
  /** `dec-issue-<N>`: uma pendência por issue. */
  id: string;
  issueNumber: number;
  branch: string;
  worktreePath: string;
  blockedAt: string;
  /** Conteúdo de `Blocked on`. */
  reason: string;
  options: string[];
  recommendedIndex: number;
  /**
   * Segundos até o avanço otimista (RF-04). `null` desliga o avanço, que é o caso de um bloqueio de
   * permissão: nenhuma permissão é auto-aprovada.
   */
  timeoutSeconds: number | null;
  status: "AWAITING_INPUT";
}

export interface DecisionInbox {
  sessionId: string;
  pendingDecisions: InboxDecision[];
}

export interface BlockedStatus {
  branch?: string;
  issueNumber?: number;
  reason: string;
  options: string[];
  recommendation: string;
  recommendedIndex: number;
}

export function inboxPath(root: string): string {
  return `${root}/.claude/vetor/decision-inbox.json`;
}

function field(lines: string[], name: string): string | undefined {
  const prefix = `${name}:`;
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  return line === undefined ? undefined : line.slice(prefix.length).trim();
}

/** Lê os blocos obrigatórios do `BLOCKED_WAITING` (agent-status.template.md). */
export function parseBlockedStatus(content: string): BlockedStatus | null {
  const lines = content.split(/\r?\n/);
  const reason = field(lines, "Blocked on");
  if (!reason) return null;

  const options: string[] = [];
  const optionsAt = lines.findIndex((line) => line.startsWith("Options:"));
  if (optionsAt !== -1) {
    for (const line of lines.slice(optionsAt + 1)) {
      const option = line.match(/^\s*\d+[.)]\s+(.+?)\s*$/);
      if (!option) break;
      options.push(option[1]);
    }
  }

  const recommendation = field(lines, "Recommendation") ?? "";
  // "1 — ...", "opção 2: ..." ou "#3 ...": o número no início aponta a opção; senão, a primeira.
  const numbered = recommendation.match(/^(?:op[çc][ãa]o|option|#)?\s*(\d+)\b/i);
  const index = numbered ? Number(numbered[1]) - 1 : 0;

  const issue = content.match(/^Iteration:.*\(Issue #(\d+)\)/m)?.[1];
  return {
    branch: content.match(/^# Agent Status\s*[—–-]\s*(.+?)\s*$/m)?.[1],
    issueNumber: issue === undefined ? undefined : Number(issue),
    reason,
    options,
    recommendation,
    recommendedIndex: index >= 0 && index < options.length ? index : 0,
  };
}

function setField(content: string, name: string, value: string): string {
  const pattern = new RegExp(`^${name}:.*$`, "m");
  if (pattern.test(content)) return content.replace(pattern, () => `${name}: ${value}`);
  return `${content.replace(/\n*$/, "\n")}${name}: ${value}\n`;
}

function removeField(content: string, name: string): string {
  return content.replace(new RegExp(`^${name}:.*\\n?`, "m"), "");
}

function normalize(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function writeAtomic(path: string, content: string): void {
  const temp = `${path}.tmp`;
  Deno.writeTextFileSync(temp, content);
  Deno.renameSync(temp, path);
}

function sessionIdFor(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "");
  return `coord-${stamp.slice(0, 8)}-${stamp.slice(9, 13)}`;
}

function isInbox(value: unknown): value is DecisionInbox {
  const inbox = value as Partial<DecisionInbox> | null;
  return typeof inbox?.sessionId === "string" && Array.isArray(inbox.pendingDecisions) &&
    inbox.pendingDecisions.every((entry) =>
      typeof entry?.id === "string" && typeof entry.branch === "string" &&
      Array.isArray(entry.options)
    );
}

function writeInbox(root: string, inbox: DecisionInbox): void {
  Deno.mkdirSync(`${root}/.claude/vetor`, { recursive: true });
  writeAtomic(inboxPath(root), `${JSON.stringify(inbox, null, 2)}\n`);
}

function entryFromSuspendedStatus(content: string, now: Date): InboxDecision | null {
  const lines = content.split(/\r?\n/);
  const blocked = parseBlockedStatus(content);
  const worktreePath = field(lines, "Worktree");
  if (!blocked || blocked.branch === undefined || blocked.issueNumber === undefined) return null;
  if (!worktreePath || field(lines, "Status") !== "SUSPENDED") return null;

  const timeout = field(lines, "Timeout");
  return {
    id: `dec-issue-${blocked.issueNumber}`,
    issueNumber: blocked.issueNumber,
    branch: blocked.branch,
    worktreePath,
    blockedAt: field(lines, "Suspended at") ?? now.toISOString(),
    reason: blocked.reason,
    options: blocked.options,
    recommendedIndex: blocked.recommendedIndex,
    timeoutSeconds: timeout ? Number(timeout) : null,
    status: "AWAITING_INPUT",
  };
}

/** Recria a inbox a partir dos status files `SUSPENDED` (edge case: JSON apagado ou corrompido). */
export function rebuildInbox(root: string, now = new Date()): DecisionInbox {
  const inbox: DecisionInbox = { sessionId: sessionIdFor(now), pendingDecisions: [] };
  const dir = `${root}/.claude/vetor/status`;
  let names: string[];
  try {
    names = [...Deno.readDirSync(dir)].filter((entry) => entry.isFile && entry.name.endsWith(".md"))
      .map((entry) => entry.name).sort();
  } catch {
    return inbox;
  }
  for (const name of names) {
    const entry = entryFromSuspendedStatus(Deno.readTextFileSync(`${dir}/${name}`), now);
    if (entry) inbox.pendingDecisions.push(entry);
  }
  return inbox;
}

/** Lê a inbox; ausente ou inválida, é reconstruída dos status files e gravada de volta. */
export function loadInbox(root: string, now = new Date()): DecisionInbox {
  try {
    const parsed: unknown = JSON.parse(Deno.readTextFileSync(inboxPath(root)));
    if (isInbox(parsed)) return parsed;
  } catch {
    // cai na reconstrução abaixo
  }
  const rebuilt = rebuildInbox(root, now);
  if (rebuilt.pendingDecisions.length > 0) writeInbox(root, rebuilt);
  return rebuilt;
}

export interface SuspendInput {
  root: string;
  statusFile: string;
  worktreePath: string;
  /** Liga o avanço otimista (RF-04); omitido, a decisão espera o humano indefinidamente. */
  timeoutSeconds?: number | null;
  now?: Date;
}

/**
 * BLOCKED_WAITING -> SUSPENDED. Idempotente: um status já SUSPENDED devolve a pendência existente
 * sem reiniciar o relógio do avanço otimista.
 */
export function suspendBlocked(input: SuspendInput): InboxDecision {
  const { root, statusFile, worktreePath } = input;
  const now = input.now ?? new Date();
  const timeoutSeconds = input.timeoutSeconds ?? null;

  const content = normalize(Deno.readTextFileSync(statusFile));
  const status = field(content.split("\n"), "Status");
  if (status !== "BLOCKED_WAITING" && status !== "SUSPENDED") {
    throw new Error(
      `o status é ${status ?? "desconhecido"}, não BLOCKED_WAITING: nada a suspender`,
    );
  }
  const blocked = parseBlockedStatus(content);
  if (!blocked || blocked.branch === undefined || blocked.issueNumber === undefined) {
    throw new Error(
      "status file sem 'Blocked on', cabeçalho '# Agent Status — <branch>' ou 'Issue #N'",
    );
  }

  const id = `dec-issue-${blocked.issueNumber}`;
  const inbox = loadInbox(root, now);
  const existing = inbox.pendingDecisions.find((entry) => entry.id === id);
  if (status === "SUSPENDED" && existing) return existing;

  const entry: InboxDecision = {
    id,
    issueNumber: blocked.issueNumber,
    branch: blocked.branch,
    worktreePath,
    blockedAt: now.toISOString(),
    reason: blocked.reason,
    options: blocked.options,
    recommendedIndex: blocked.recommendedIndex,
    timeoutSeconds,
    status: "AWAITING_INPUT",
  };
  inbox.pendingDecisions = [...inbox.pendingDecisions.filter((other) => other.id !== id), entry];
  // Inbox primeiro: se o processo cair entre as duas gravações, o status ainda é BLOCKED_WAITING e
  // repetir o comando é seguro.
  writeInbox(root, inbox);

  let next = setField(content, "Updated", now.toISOString());
  next = setField(next, "Status", "SUSPENDED");
  next = setField(
    next,
    "Last action",
    `Suspenso na Decision Inbox (${id}); vaga no teto N liberada`,
  );
  next = setField(next, "Next", "aguardando decisão humana (decision-inbox.json)");
  next = setField(next, "Suspended at", entry.blockedAt);
  next = setField(next, "Worktree", worktreePath);
  next = timeoutSeconds === null
    ? removeField(next, "Timeout")
    : setField(next, "Timeout", String(timeoutSeconds));
  writeAtomic(statusFile, next);
  return entry;
}

/** Pendências com avanço otimista ligado cujo prazo já venceu. */
export function expiredDecisions(inbox: DecisionInbox, now: Date): InboxDecision[] {
  return inbox.pendingDecisions.filter((entry) =>
    entry.timeoutSeconds !== null &&
    now.getTime() >= Date.parse(entry.blockedAt) + entry.timeoutSeconds * 1000
  );
}

/** Segundos restantes até o avanço otimista; `null` quando ele está desligado para a pendência. */
export function secondsLeft(entry: InboxDecision, now: Date): number | null {
  if (entry.timeoutSeconds === null) return null;
  const left = Date.parse(entry.blockedAt) + entry.timeoutSeconds * 1000 - now.getTime();
  return Math.max(0, Math.ceil(left / 1000));
}

/** `_vetor_checkpoint_<branch>_<timestamp>`: sem `/` nem `:`, que quebrariam o ref ou o path. */
export function checkpointTagName(branch: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `_vetor_checkpoint_${branch.replaceAll("/", "-")}_${stamp}`;
}

/**
 * Tag anotada e local na ponta da branch do worker: o ponto de restauração do avanço otimista.
 * Não publica nada. Falhar aqui impede o avanço (quem chama não deve decidir sem checkpoint).
 */
export async function createCheckpointTag(
  root: string,
  branch: string,
  now: Date,
  message = "Checkpoint do Vetor antes de um avanço otimista",
): Promise<string> {
  const name = checkpointTagName(branch, now);
  const valid = await run("git", ["check-ref-format", `refs/tags/${name}`], root);
  if (valid.code !== 0) throw new Error(`nome de tag inválido: ${name}`);
  const tagged = await run("git", ["tag", "-a", name, "-m", message, `refs/heads/${branch}`], root);
  if (tagged.code !== 0) {
    throw new Error(`git tag falhou para a branch ${branch}: ${tagged.stderr.trim()}`);
  }
  return name;
}

export interface ResolveInput {
  root: string;
  id: string;
  decision: string;
  /** Decisão tomada pelo temporizador, não pelo humano: ganha a tag `[OPTIMISTIC_DECISION]`. */
  optimistic?: boolean;
  checkpointTag?: string;
  now?: Date;
}

/**
 * Remove a pendência sem tocar no status file: é a ejeção (issue #501), em que quem grava
 * `EJECTED` no status file é o coordinator, e não uma retomada.
 */
export function dropDecision(root: string, id: string, now = new Date()): InboxDecision {
  const inbox = loadInbox(root, now);
  const entry = inbox.pendingDecisions.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`decisão não encontrada na inbox: ${id}`);
  inbox.pendingDecisions = inbox.pendingDecisions.filter((candidate) => candidate.id !== id);
  writeInbox(root, inbox);
  return entry;
}

/** SUSPENDED -> RUNNING: remove a pendência e deixa o status file pronto para a retomada. */
export function resolveDecision(input: ResolveInput): InboxDecision {
  const { root, id, decision } = input;
  const now = input.now ?? new Date();

  const inbox = loadInbox(root, now);
  const entry = inbox.pendingDecisions.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`decisão não encontrada na inbox: ${id}`);

  const statusFile = statusFilePath(root, entry.branch);
  const current = normalize(Deno.readTextFileSync(statusFile));
  const header = current.split("\n")[0].startsWith("# Agent Status")
    ? current.split("\n")[0]
    : `# Agent Status — ${entry.branch}`;
  const iteration = current.match(/^Iteration:.*$/m)?.[0] ??
    `Iteration: ?/5 (Issue #${entry.issueNumber})`;

  const lastAction = input.optimistic
    ? `[OPTIMISTIC_DECISION] ${id}: sem resposta em ${entry.timeoutSeconds}s, aplicada a opção ` +
      `(Recommended); checkpoint ${input.checkpointTag ?? "indisponível"}`
    : `Decisão humana recebida (${id})`;
  const resumed = [
    header,
    `Updated: ${now.toISOString()}`,
    "Status: RUNNING",
    iteration,
    `Last action: ${lastAction}`,
    `${input.optimistic ? "Decisão otimista" : "Decisão humana"}: ${decision}`,
    "Next: retomar a iteração no worktree com a decisão acima",
    "",
  ].join("\n");

  inbox.pendingDecisions = inbox.pendingDecisions.filter((candidate) => candidate.id !== id);
  writeInbox(root, inbox);
  writeAtomic(statusFile, resumed);
  return entry;
}
