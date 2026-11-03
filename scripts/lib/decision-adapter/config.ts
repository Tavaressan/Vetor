// Configuração do Decision Adapter: chave `decisionAdapter` de `.claude/vetor/config.json`.
//
// Ausência da chave, JSON inválido ou valor malformado mantêm o experimento desligado — o mesmo
// opt-out silencioso de `hooks.typecheckOnEdit` (scripts/check-edit.ts).

import type { DecisionAdapterConfig } from "./types.ts";

export const DEFAULT_CONFIG: DecisionAdapterConfig = {
  enabled: false,
  provider: "ollama",
  endpoint: "http://localhost:11434",
  model: "nimble",
  timeoutMs: 2000,
  minimumConfidence: null,
  fallback: "baseline",
  debug: false,
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/**
 * Aceita só `http(s)://<loopback>[:porta]`, sem credenciais, caminho, query ou fragmento: uma
 * configuração maliciosa não consegue redirecionar o contexto da falha para fora da máquina.
 * Devolve a origem normalizada ou `null`.
 */
export function validateEndpoint(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null;
  if (url.username || url.password) return null;
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return null;
  return url.origin;
}

export interface ParsedConfig {
  config: DecisionAdapterConfig;
  /** Problemas encontrados; cada campo inválido volta ao default. */
  errors: string[];
}

export function parseConfig(raw: unknown): ParsedConfig {
  const config = { ...DEFAULT_CONFIG };
  const errors: string[] = [];
  if (raw === undefined || raw === null) return { config, errors };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { config, errors: ["decisionAdapter deve ser um objeto"] };
  }
  const r = raw as Record<string, unknown>;

  if (r.enabled !== undefined) {
    if (typeof r.enabled === "boolean") config.enabled = r.enabled;
    else errors.push("enabled deve ser boolean");
  }
  if (r.provider !== undefined && r.provider !== "ollama") {
    errors.push(`provider desconhecido: ${String(r.provider).slice(0, 40)}`);
    config.enabled = false;
  }
  if (r.endpoint !== undefined) {
    const origin = typeof r.endpoint === "string" ? validateEndpoint(r.endpoint) : null;
    if (origin) {
      config.endpoint = origin;
    } else {
      errors.push("endpoint deve ser http(s)://localhost|127.0.0.1|[::1][:porta], sem caminho");
      config.enabled = false;
    }
  }
  if (r.model !== undefined) {
    if (typeof r.model === "string" && MODEL_RE.test(r.model)) config.model = r.model;
    else {
      errors.push("model inválido");
      config.enabled = false;
    }
  }
  if (r.timeoutMs !== undefined) {
    if (
      typeof r.timeoutMs === "number" && Number.isInteger(r.timeoutMs) &&
      r.timeoutMs >= MIN_TIMEOUT_MS && r.timeoutMs <= MAX_TIMEOUT_MS
    ) {
      config.timeoutMs = r.timeoutMs;
    } else {
      errors.push(`timeoutMs deve ser inteiro entre ${MIN_TIMEOUT_MS} e ${MAX_TIMEOUT_MS}`);
    }
  }
  if (r.minimumConfidence !== undefined && r.minimumConfidence !== null) {
    const v = r.minimumConfidence;
    if (typeof v === "number" && v >= 0 && v <= 1) config.minimumConfidence = v;
    else errors.push("minimumConfidence deve ser null ou número entre 0 e 1");
  }
  if (r.fallback !== undefined) {
    if (r.fallback === "baseline" || r.fallback === "request_human_review") {
      config.fallback = r.fallback;
    } else errors.push("fallback deve ser baseline ou request_human_review");
  }
  if (r.debug !== undefined) {
    if (typeof r.debug === "boolean") config.debug = r.debug;
    else errors.push("debug deve ser boolean");
  }
  return { config, errors };
}

/** Lê `decisionAdapter` de um config.json. Arquivo ausente ou ilegível = experimento desligado. */
export function loadConfig(configPath: string): ParsedConfig {
  let text: string;
  try {
    text = Deno.readTextFileSync(configPath);
  } catch {
    return { config: { ...DEFAULT_CONFIG }, errors: [] };
  }
  try {
    const parsed = JSON.parse(text.replace(/^\u{FEFF}/u, "")) as { decisionAdapter?: unknown };
    return parseConfig(parsed?.decisionAdapter);
  } catch {
    return { config: { ...DEFAULT_CONFIG }, errors: ["config.json não é JSON válido"] };
  }
}
