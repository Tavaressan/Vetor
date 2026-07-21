// CLI invocado por opencode/plugin/vetor.ts (hook `event`, evento `session.error`) via
// `deno run -A`, no mesmo padrão de safety-check.ts/check-edit.ts: payload JSON no stdin,
// silêncio se não houver o que registrar.
//
// Contrato de stdin:
//   { model?: string; statusCode?: number; isRetryable?: boolean;
//     responseHeaders?: Record<string,string>; message?: string; cwd?: string }
//
// `model` já vem resolvido pelo plugin como "<providerID>/<modelID>" (correlacionado via
// `chat.params`, já que `session.error` não carrega o model/provider — ver lib/model-health.ts).
// Sem `model` conhecido, ainda registramos sob a chave "unknown" — perder o sinal de rate-limit
// custa mais do que uma chave imprecisa (o coordinator trata "unknown" como não-fallback-ável).

import { resolveWorktree } from "./lib/status.ts";
import { computeUntil, isRateLimitOrQuotaStatus, recordModelHealth } from "./lib/model-health.ts";

interface Payload {
  model?: string;
  statusCode?: number;
  responseHeaders?: Record<string, string>;
  message?: string;
  cwd?: string;
}

async function main() {
  const raw = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer());

  let input: Payload;
  try {
    input = JSON.parse(raw);
  } catch {
    Deno.exit(0);
  }

  if (!isRateLimitOrQuotaStatus(input.statusCode)) Deno.exit(0);

  const cwd = input.cwd ?? Deno.cwd();
  const worktree = await resolveWorktree(cwd);
  if (!worktree) Deno.exit(0);

  const path = `${worktree.root}/.claude/vetor/status/model-health.json`;
  const now = Date.now();
  const until = computeUntil(now, input.responseHeaders);
  const key = input.model ?? "unknown";
  const lastError = `HTTP ${input.statusCode}${input.message ? `: ${input.message}` : ""}`;

  recordModelHealth(path, key, { status: "degraded", until, lastError });
}

await main();
