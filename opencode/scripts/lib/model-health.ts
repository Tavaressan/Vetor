// Persistência de saúde de modelo/provedor entre processos separados do OpenCode (issue #83).
//
// Cada worker `opencode run --dir` é um processo do SO distinto — não há estado compartilhado
// em memória entre eles nem com o `issue-coordinator`. Por isso o sinal de rate-limit/quota
// detectado pelo hook `event` (opencode/plugin/vetor.ts, escutando `session.error`) precisa ser
// gravado em disco, em `.claude/vetor/status/model-health.json`, na raiz do repositório
// principal — fora de qualquer worktree, mesmo local onde já vivem os status files dos workers
// (ver scripts/lib/status.ts).
//
// Payload do evento confirmado contra @opencode-ai/sdk v1.18.4 instalado
// (dist/gen/types.gen.d.ts:86 `ApiError`, :518 `EventSessionError`) em 2026-07-21:
//   ApiError.data = { message, statusCode?, isRetryable, responseHeaders?, responseBody? }
// `EventSessionError.properties` só carrega `sessionID`+`error` — sem provider/model. Por isso
// o plugin correlaciona sessionID -> "<providerID>/<modelID>" via `chat.params` (que recebe
// `model: Model` com `providerID`/`id`) antes do erro chegar.

/** Só 429 (rate limit) e 529 (overloaded, comum em provedores como Anthropic) contam como
 *  degradação reativa — outros 4xx/5xx (auth, bad request, erro de servidor genérico) não
 *  implicam necessariamente indisponibilidade do modelo em si. */
const RATE_LIMIT_OR_QUOTA_STATUS_CODES = new Set([429, 529]);

export function isRateLimitOrQuotaStatus(statusCode: number | undefined): boolean {
  return statusCode !== undefined && RATE_LIMIT_OR_QUOTA_STATUS_CODES.has(statusCode);
}

/** Sem `retry-after` do provedor, backoff fixo curto — revisitado no próximo erro se persistir. */
export const DEFAULT_BACKOFF_MS = 60_000;

/**
 * `retry-after` HTTP aceita segundos (inteiro) ou uma data no formato RFC 7231. Nenhum valor
 * utilizável (ausente, não numérico e não parseável como data) cai no backoff fixo.
 */
export function computeUntil(
  now: number,
  responseHeaders: Record<string, string> | undefined,
): number {
  const raw = responseHeaders &&
    Object.entries(responseHeaders).find(([k]) => k.toLowerCase() === "retry-after")?.[1];

  if (raw !== undefined) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000;

    const asDate = Date.parse(raw);
    if (!Number.isNaN(asDate)) return asDate;
  }

  return now + DEFAULT_BACKOFF_MS;
}

export interface ModelHealthEntry {
  status: "degraded";
  until: number;
  lastError: string;
}

export type ModelHealthFile = Record<string, ModelHealthEntry>;

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

export function readModelHealthFile(path: string): ModelHealthFile {
  if (!exists(path)) return {};
  try {
    const parsed = JSON.parse(Deno.readTextFileSync(path));
    return parsed && typeof parsed === "object" ? parsed as ModelHealthFile : {};
  } catch {
    // JSON corrompido/parcial (ex.: escrita concorrente de outro worker): recomeça do zero em
    // vez de travar o registro do novo sinal — perder histórico é preferível a nunca gravar.
    return {};
  }
}

/**
 * Atualiza (cria ou sobrescreve) a entrada de `key` ("<provider>/<model>") em
 * `.claude/vetor/status/model-health.json` e persiste o arquivo inteiro.
 */
export function recordModelHealth(
  path: string,
  key: string,
  entry: ModelHealthEntry,
): ModelHealthFile {
  const file = readModelHealthFile(path);
  file[key] = entry;

  const dir = path.slice(0, path.lastIndexOf("/"));
  if (dir) Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(path, JSON.stringify(file, null, 2) + "\n");

  return file;
}

/** Entrada ausente ou `until` no passado = saudável. Consumido pelo issue-coordinator (#84). */
export function isHealthy(entry: ModelHealthEntry | undefined, now: number): boolean {
  return entry === undefined || entry.status !== "degraded" || entry.until <= now;
}

/**
 * Percorre `fallback` (lista ordenada de "<provider>/<model>") e devolve o primeiro que estiver
 * saudável em `health`. `null` se todos os modelos da lista estiverem `degraded` e não expirados
 * — o issue-coordinator (issue #84) trata isso como "não despache, mantenha o grupo QUEUED".
 */
export function pickHealthyModel(
  fallback: string[],
  health: ModelHealthFile,
  now: number,
): string | null {
  return fallback.find((model) => isHealthy(health[model], now)) ?? null;
}
