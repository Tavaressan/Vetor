// Log append-only local de RoutingDecision e ExecutionOutcome (ADR-002, Fase 2, F2-8;
// contrato em docs/investigations/contrato-minimo-fase-1.md §6.2 e §7 questão 6).
//
// JSONL em `<root>/.claude/vetor/status/routing-log.jsonl`, uma linha por registro, ligados por
// `decisionId`. Escrita com o padrão de lock de `opencode/scripts/lib/model-health.ts`: o
// `append` atômico não é garantido no Windows. Sem rotação na v1. A leitura de produção é da
// Fase 5; `readRoutingLog` existe para testes.
//
// Cada registro é reconstruído campo a campo (allowlist): `prompt`, `cwd`, corpo da issue ou
// qualquer campo fora do contrato nunca chegam ao disco, e strings que pareçam path absoluto
// são redigidas.
import type { ExecutionOutcome, RoutingDecision } from "./types.ts";

export type RoutingLogRecord = RoutingDecision | ExecutionOutcome;

const LOCK_RETRY_MS = 10;
const REDACTED_PATH = "[path-redacted]";

export function routingLogPath(root: string): string {
  return `${root}/.claude/vetor/status/routing-log.jsonl`;
}

const ABSOLUTE_PATH = /(^|[\s"'=(:])(\/[^\s"']+|[A-Za-z]:[\\/][^\s"']*|\\\\[^\s"']+)/g;

function scrub(value: string): string {
  return value.replace(ABSOLUTE_PATH, (_m, pre: string) => `${pre}${REDACTED_PATH}`);
}

function scrubAll(values: readonly string[]): string[] {
  return values.map(scrub);
}

export function isRoutingDecision(record: RoutingLogRecord): record is RoutingDecision {
  return "decisionVersion" in record;
}

function sanitizeDecision(d: RoutingDecision): RoutingDecision {
  const out: RoutingDecision = {
    decisionVersion: 1,
    decisionId: scrub(d.decisionId),
    decidedAt: d.decidedAt,
    taskId: scrub(d.taskId),
    attempt: d.attempt,
    policyMode: d.policyMode,
    action: d.action,
    profile: {
      operations: scrubAll(d.profile.operations),
      domains: scrubAll(d.profile.domains),
      dataSensitivity: d.profile.dataSensitivity,
      requirements: {
        browser: d.profile.requirements.browser,
        mcp: d.profile.requirements.mcp,
      },
      provenance: { ...d.profile.provenance },
    },
    candidates: d.candidates.map((c) => ({
      executorId: scrub(c.executorId),
      verdict: c.verdict,
      ...(c.rejectedBy !== undefined ? { rejectedBy: c.rejectedBy } : {}),
      detail: scrub(c.detail),
      evidence: { ...c.evidence },
    })),
    restrictions: scrubAll(d.restrictions),
    reasons: scrubAll(d.reasons),
  };
  if (d.selected) {
    out.selected = { executorId: scrub(d.selected.executorId), mode: d.selected.mode };
  }
  return out;
}

function sanitizeOutcome(o: ExecutionOutcome): ExecutionOutcome {
  const out: ExecutionOutcome = {
    outcomeVersion: 1,
    decisionId: scrub(o.decisionId),
    finishedAt: o.finishedAt,
    status: o.status,
    retryCount: o.retryCount,
    fallbackUsed: o.fallbackUsed,
    humanIntervention: o.humanIntervention,
  };
  if (o.durationMs !== undefined) out.durationMs = o.durationMs;
  if (o.validation !== undefined) out.validation = o.validation;
  if (o.model !== undefined) out.model = scrub(o.model);
  if (o.estimatedCost !== undefined) out.estimatedCost = o.estimatedCost;
  return out;
}

/** Projeta o registro para o contrato, descartando qualquer campo fora dele. */
export function sanitizeRoutingRecord(record: RoutingLogRecord): RoutingLogRecord {
  return isRoutingDecision(record) ? sanitizeDecision(record) : sanitizeOutcome(record);
}

/** Acrescenta uma linha ao log sob lock; cria o diretório se preciso. */
export function appendRoutingRecord(path: string, record: RoutingLogRecord): void {
  const line = JSON.stringify(sanitizeRoutingRecord(record)) + "\n";
  const dir = path.slice(0, path.lastIndexOf("/"));
  if (dir) Deno.mkdirSync(dir, { recursive: true });

  const lockPath = `${path}.lock`;
  while (true) {
    try {
      Deno.openSync(lockPath, { createNew: true, write: true }).close();
      break;
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS);
    }
  }
  try {
    Deno.writeTextFileSync(path, line, { append: true, create: true });
  } finally {
    Deno.removeSync(lockPath);
  }
}

/** Só para testes: lê o log, ignorando linhas vazias ou corrompidas. */
export function readRoutingLog(path: string): RoutingLogRecord[] {
  let text: string;
  try {
    text = Deno.readTextFileSync(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
  const records: RoutingLogRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as RoutingLogRecord);
    } catch {
      // linha parcial: ignorada
    }
  }
  return records;
}
