import { assert, assertEquals } from "@std/assert";
import {
  computeUntil,
  DEFAULT_BACKOFF_MS,
  isHealthy,
  isRateLimitOrQuotaStatus,
  pickHealthyModel,
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

Deno.test("recordModelHealth - processos concorrentes preservam ambas as entradas", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/.claude/vetor/status/model-health.json`;
  const gate = `${dir}/start`;
  const moduleUrl = new URL("./model-health.ts", import.meta.url).href;
  const run = (key: string) =>
    new Deno.Command(Deno.execPath(), {
    args: [
      "eval",
      `import { recordModelHealth } from ${JSON.stringify(moduleUrl)};
while (!await Deno.stat(${JSON.stringify(gate)}).then(() => true).catch(() => false)) {
  await new Promise((resolve) => setTimeout(resolve, 1));
}
recordModelHealth(${JSON.stringify(path)}, ${JSON.stringify(key)}, {
  status: "degraded", until: 2_000_000, lastError: "HTTP 429"
});`,
      ],
    }).output();

  const first = run("anthropic/claude-sonnet-4-5");
  const second = run("openai/gpt-5");
  await Deno.writeTextFile(gate, "go");
  const results = await Promise.all([first, second]);

  assert(
    results.every((result) => result.success),
    results.map((result) => new TextDecoder().decode(result.stderr)).join("\n"),
  );
  assertEquals(Object.keys(JSON.parse(await Deno.readTextFile(path))).sort(), [
    "anthropic/claude-sonnet-4-5",
    "openai/gpt-5",
  ]);
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

Deno.test("pickHealthyModel - escolhe o primeiro saudável da lista", () => {
  const now = 1_000_000;
  const fallback = ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-5"];
  assertEquals(pickHealthyModel(fallback, {}, now), "anthropic/claude-haiku-4-5");
});

Deno.test("pickHealthyModel - modelo preferencial degraded e não expirado cai para o próximo", () => {
  const now = 1_000_000;
  const fallback = ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-5"];
  const health = {
    "anthropic/claude-haiku-4-5": {
      status: "degraded" as const,
      until: now + 60_000,
      lastError: "HTTP 429",
    },
  };
  assertEquals(pickHealthyModel(fallback, health, now), "anthropic/claude-sonnet-4-5");
});

Deno.test("pickHealthyModel - modelo preferencial degraded mas expirado é escolhido de novo", () => {
  const now = 1_000_000;
  const fallback = ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-5"];
  const health = {
    "anthropic/claude-haiku-4-5": {
      status: "degraded" as const,
      until: now - 1_000,
      lastError: "HTTP 429",
    },
  };
  assertEquals(pickHealthyModel(fallback, health, now), "anthropic/claude-haiku-4-5");
});

Deno.test("pickHealthyModel - todos degraded devolve null", () => {
  const now = 1_000_000;
  const fallback = ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-5"];
  const health = {
    "anthropic/claude-haiku-4-5": {
      status: "degraded" as const,
      until: now + 60_000,
      lastError: "HTTP 429",
    },
    "anthropic/claude-sonnet-4-5": {
      status: "degraded" as const,
      until: now + 60_000,
      lastError: "HTTP 429",
    },
  };
  assertEquals(pickHealthyModel(fallback, health, now), null);
});
