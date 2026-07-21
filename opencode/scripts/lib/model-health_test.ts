import { assert, assertEquals } from "@std/assert";
import {
  computeUntil,
  DEFAULT_BACKOFF_MS,
  isHealthy,
  isRateLimitOrQuotaStatus,
  recordModelHealth,
} from "./model-health.ts";

Deno.test("isRateLimitOrQuotaStatus - 429 e 529 são rate limit/quota", () => {
  assert(isRateLimitOrQuotaStatus(429));
  assert(isRateLimitOrQuotaStatus(529));
});

Deno.test("isRateLimitOrQuotaStatus - outros códigos não são", () => {
  assert(!isRateLimitOrQuotaStatus(500));
  assert(!isRateLimitOrQuotaStatus(401));
  assert(!isRateLimitOrQuotaStatus(undefined));
});

Deno.test("computeUntil - deriva de retry-after em segundos", () => {
  const now = 1_000_000;
  const until = computeUntil(now, { "retry-after": "30" });
  assertEquals(until, now + 30_000);
});

Deno.test("computeUntil - retry-after é case-insensitive no nome do header", () => {
  const now = 1_000_000;
  const until = computeUntil(now, { "Retry-After": "5" });
  assertEquals(until, now + 5_000);
});

Deno.test("computeUntil - deriva de retry-after como data HTTP", () => {
  const now = Date.parse("2026-07-21T00:00:00Z") - 10_000;
  const until = computeUntil(now, { "retry-after": "Tue, 21 Jul 2026 00:00:00 GMT" });
  assertEquals(until, Date.parse("2026-07-21T00:00:00Z"));
});

Deno.test("computeUntil - sem retry-after cai no backoff fixo", () => {
  const now = 1_000_000;
  assertEquals(computeUntil(now, undefined), now + DEFAULT_BACKOFF_MS);
  assertEquals(computeUntil(now, {}), now + DEFAULT_BACKOFF_MS);
});

Deno.test("computeUntil - retry-after inválido cai no backoff fixo", () => {
  const now = 1_000_000;
  assertEquals(
    computeUntil(now, { "retry-after": "não-é-nem-número-nem-data" }),
    now + DEFAULT_BACKOFF_MS,
  );
});

Deno.test("recordModelHealth - cria model-health.json com a entrada degraded", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/.claude/vetor/status/model-health.json`;

  const file = recordModelHealth(path, "anthropic/claude-sonnet-4-5", {
    status: "degraded",
    until: 2_000_000,
    lastError: "HTTP 429: rate limited",
  });

  assertEquals(file["anthropic/claude-sonnet-4-5"].status, "degraded");
  assertEquals(file["anthropic/claude-sonnet-4-5"].until, 2_000_000);

  const onDisk = JSON.parse(await Deno.readTextFile(path));
  assertEquals(onDisk["anthropic/claude-sonnet-4-5"].until, 2_000_000);
});

Deno.test("recordModelHealth - atualiza entrada existente sem apagar outras chaves", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/.claude/vetor/status/model-health.json`;

  recordModelHealth(path, "openai/gpt-5", { status: "degraded", until: 1, lastError: "a" });
  const file = recordModelHealth(path, "anthropic/claude-haiku-4-5", {
    status: "degraded",
    until: 2,
    lastError: "b",
  });

  assertEquals(Object.keys(file).sort(), ["anthropic/claude-haiku-4-5", "openai/gpt-5"]);
});

Deno.test("isHealthy - entrada ausente é saudável", () => {
  assert(isHealthy(undefined, Date.now()));
});

Deno.test("isHealthy - entrada com until no futuro é degraded", () => {
  const now = 1_000_000;
  assert(!isHealthy({ status: "degraded", until: now + 5_000, lastError: "x" }, now));
});

Deno.test("isHealthy - entrada com until no passado é saudável (expirada)", () => {
  const now = 1_000_000;
  assert(isHealthy({ status: "degraded", until: now - 5_000, lastError: "x" }, now));
});
