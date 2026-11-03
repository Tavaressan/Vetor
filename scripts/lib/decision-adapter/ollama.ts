// Provedor HTTP para o endpoint de decisões do Ollama (`POST /v1/systemone`, "System One",
// baseado na API Jev da TypeSafe; Ollama >= 0.35.0). Contrato verificado em 2026-11-02 em
// https://docs.ollama.com/api/systemone e https://docs.ollama.com/capabilities/decision:
//
//   request:  { model, state, questions: { <nome>: { type: "choice", instructions, criteria } } }
//   response: { model, answers: { <nome>: { type: "choice", choice, probabilities, confidence } },
//               usage }
//   erros:    { error: string } — 400 modelo/runner não suportado, 404 modelo não encontrado.
//
// Uma única tentativa por chamada: nenhum retry automático. Sem fallback para /api/generate —
// trocar a API especializada por geração de texto mudaria o que o experimento mede.

import type { DecisionProvider, DecisionRequest, ProviderOutcome } from "./types.ts";

const QUESTION = "next_step";
/** Teto do corpo lido da resposta; uma resposta de choice tem poucas centenas de bytes. */
const MAX_RESPONSE_BYTES = 64 * 1024;

function isDenied(err: unknown): boolean {
  // Deno 2 usa NotCapable para permissões negadas; PermissionDenied cobre versões anteriores.
  const errors = Deno.errors as Record<string, unknown>;
  return (typeof errors.NotCapable === "function" &&
    err instanceof (errors.NotCapable as ErrorConstructor)) ||
    err instanceof Deno.errors.PermissionDenied;
}

function errorText(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed?.error === "string") return parsed.error.slice(0, 200);
  } catch {
    // corpo não é JSON (ex.: "404 page not found" de um Ollama sem o endpoint)
  }
  return "";
}

export class OllamaDecisionProvider implements DecisionProvider {
  readonly id = "ollama";

  constructor(readonly endpoint: string, readonly model: string) {}

  async decide(request: DecisionRequest, signal: AbortSignal): Promise<ProviderOutcome> {
    const criteria: Record<string, string> = {};
    for (const [alt, description] of Object.entries(request.alternatives)) {
      criteria[alt] = description as string;
    }
    const body = JSON.stringify({
      model: this.model,
      state: request.state,
      questions: { [QUESTION]: { type: "choice", instructions: request.instructions, criteria } },
    });

    let response: Response;
    try {
      response = await fetch(`${this.endpoint}/v1/systemone`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal,
        redirect: "error",
      });
    } catch (err) {
      if (signal.aborted) return { ok: false, reason: "timeout" };
      if (isDenied(err)) {
        return { ok: false, reason: "network_denied", detail: "sem --allow-net para o endpoint" };
      }
      return { ok: false, reason: "unavailable", detail: "conexão recusada ou falhou" };
    }

    let text: string;
    try {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_RESPONSE_BYTES) {
        return { ok: false, reason: "incomplete_response", detail: "resposta grande demais" };
      }
      text = new TextDecoder().decode(buffer);
    } catch {
      if (signal.aborted) return { ok: false, reason: "timeout" };
      return { ok: false, reason: "incomplete_response", detail: "corpo interrompido" };
    }

    if (!response.ok) {
      const message = errorText(text);
      if (response.status === 404) {
        // Com o endpoint presente, 404 traz `{error}` sobre o modelo; sem ele, texto puro.
        return message ? { ok: false, reason: "model_not_found", detail: message } : {
          ok: false,
          reason: "incompatible_endpoint",
          detail: "Ollama sem /v1/systemone (< 0.35?)",
        };
      }
      if (response.status === 405) {
        return { ok: false, reason: "incompatible_endpoint", detail: "método não suportado" };
      }
      if (response.status === 400 && /unsupported/i.test(message)) {
        return { ok: false, reason: "incompatible_endpoint", detail: message };
      }
      return {
        ok: false,
        reason: "http_error",
        detail: `HTTP ${response.status} ${message}`.trim(),
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
    const answer = (parsed as { answers?: Record<string, unknown> } | null)?.answers?.[QUESTION];
    if (typeof answer !== "object" || answer === null) {
      return { ok: false, reason: "incomplete_response", detail: `sem answers.${QUESTION}` };
    }
    const a = answer as Record<string, unknown>;
    if (a.type !== undefined && a.type !== "choice") {
      return { ok: false, reason: "incomplete_response", detail: "answer não é do tipo choice" };
    }
    return {
      ok: true,
      answer: { choice: a.choice, probabilities: a.probabilities, confidence: a.confidence },
    };
  }
}
