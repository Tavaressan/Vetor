import { assert, assertEquals, assertFalse } from "@std/assert";
import { classifyBaseline } from "../lib/decision-adapter/baseline.ts";
import { buildRequest, classifyFailure } from "../lib/decision-adapter/classifier.ts";
import { DEFAULT_CONFIG, parseConfig, validateEndpoint } from "../lib/decision-adapter/config.ts";
import {
  buildState,
  MAX_STATE_BYTES,
  parseFailureContext,
  redactSecrets,
} from "../lib/decision-adapter/context.ts";
import { DecisionMetrics, percentile } from "../lib/decision-adapter/metrics.ts";
import { OllamaDecisionProvider } from "../lib/decision-adapter/ollama.ts";
import { allowedAlternatives, validateAnswer } from "../lib/decision-adapter/policy.ts";
import type {
  DecisionAdapterConfig,
  DecisionProvider,
  FailureContext,
  ProviderOutcome,
} from "../lib/decision-adapter/types.ts";
import { loadScenarios, runBench } from "../decision-bench.ts";

const CODE_ERROR: FailureContext = {
  operation: "test",
  exitCode: 1,
  errorCategory: "test_assertion",
  errorSummary: "AssertionError: expected 3, got 4",
  attempt: 1,
  maxAttempts: 5,
};
const RETRYABLE: FailureContext = { ...CODE_ERROR, retryable: true };
const ENABLED: DecisionAdapterConfig = { ...DEFAULT_CONFIG, enabled: true };

function stubProvider(
  outcome: ProviderOutcome | (() => Promise<ProviderOutcome>),
): DecisionProvider & {
  calls: number;
} {
  return {
    id: "stub",
    model: "stub-model",
    calls: 0,
    decide() {
      this.calls++;
      return typeof outcome === "function" ? outcome() : Promise.resolve(outcome);
    },
  };
}

const answer = (choice: unknown, probabilities: unknown, confidence: unknown = 0.9) =>
  ({ ok: true, answer: { choice, probabilities, confidence } }) as ProviderOutcome;

// --- configuração -------------------------------------------------------------------------

Deno.test("config ausente mantém o experimento desligado", () => {
  assertEquals(parseConfig(undefined), { config: DEFAULT_CONFIG, errors: [] });
  assertFalse(DEFAULT_CONFIG.enabled);
});

Deno.test("config válida é aplicada", () => {
  const { config, errors } = parseConfig({
    enabled: true,
    endpoint: "http://127.0.0.1:11500/",
    model: "tev1:0.8b",
    timeoutMs: 5000,
    minimumConfidence: 0.5,
    fallback: "request_human_review",
    debug: true,
  });
  assertEquals(errors, []);
  assertEquals(config.endpoint, "http://127.0.0.1:11500");
  assertEquals(config.model, "tev1:0.8b");
  assertEquals(config.minimumConfidence, 0.5);
  assertEquals(config.fallback, "request_human_review");
});

Deno.test("endpoint fora de loopback desliga o experimento", () => {
  for (
    const endpoint of [
      "http://evil.example.com:11434",
      "http://localhost.evil.com",
      "http://user:pw@localhost:11434",
      "http://localhost:11434/proxy",
      "http://localhost:11434?x=1",
      "file:///etc/passwd",
      "http://10.0.0.5:11434",
      "not a url",
    ]
  ) {
    const { config, errors } = parseConfig({ enabled: true, endpoint });
    assertFalse(config.enabled, endpoint);
    assertEquals(errors.length, 1, endpoint);
  }
  assertEquals(validateEndpoint("http://[::1]:11434"), "http://[::1]:11434");
});

Deno.test("campos inválidos voltam ao default com erro", () => {
  const { config, errors } = parseConfig({
    enabled: "yes",
    timeoutMs: 5,
    minimumConfidence: 2,
    fallback: "retry_operation",
    model: "bad model; rm -rf",
  });
  assertFalse(config.enabled);
  assertEquals(config.timeoutMs, DEFAULT_CONFIG.timeoutMs);
  assertEquals(config.minimumConfidence, null);
  assertEquals(config.fallback, "baseline");
  assertEquals(errors.length, 5);
  assertEquals(parseConfig([]).errors.length, 1);
  assertFalse(parseConfig({ enabled: true, provider: "openai" }).config.enabled);
});

// --- contexto -----------------------------------------------------------------------------

Deno.test("parseFailureContext descarta campos desconhecidos e rejeita inválidos", () => {
  const parsed = parseFailureContext({ ...CODE_ERROR, env: { TOKEN: "x" }, files: ["/etc"] });
  assert(parsed.ok);
  assertEquals(Object.keys(parsed.context).includes("env"), false);
  assertFalse(parseFailureContext({ ...CODE_ERROR, operation: "deploy" }).ok);
  assertFalse(parseFailureContext({ ...CODE_ERROR, attempt: 0 }).ok);
  assertFalse(parseFailureContext({ ...CODE_ERROR, exitCode: "1" }).ok);
  assertFalse(parseFailureContext(null).ok);
});

Deno.test("buildState mascara segredos e respeita o teto de tamanho", () => {
  const state = buildState({
    ...CODE_ERROR,
    errorSummary: "auth failed GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456 " +
      "x".repeat(9000),
  });
  assertFalse(state.includes("ghp_abcdefghijklmnopqrstuvwxyz123456"));
  assert(new TextEncoder().encode(state).length <= MAX_STATE_BYTES);
  assertEquals(
    redactSecrets("Authorization: Bearer abc.def.ghi123"),
    "Authorization: Bearer [REDACTED]",
  );
  assertEquals(redactSecrets("api_key: sk-proj-aaaaaaaaaaaaaaaaaaaa"), "api_key: [REDACTED]");
});

// --- política e baseline ------------------------------------------------------------------

Deno.test("allowedAlternatives aplica as restrições rígidas", () => {
  assertEquals(allowedAlternatives(CODE_ERROR), ["inspect_failure", "request_human_review"]);
  assertEquals(allowedAlternatives(RETRYABLE), [
    "inspect_failure",
    "retry_operation",
    "request_human_review",
  ]);
  assertEquals(allowedAlternatives({ ...RETRYABLE, requiresApproval: true }), [
    "request_human_review",
  ]);
  assertEquals(allowedAlternatives({ ...RETRYABLE, errorCategory: "infra" }), [
    "request_human_review",
  ]);
  assertEquals(allowedAlternatives({ ...RETRYABLE, attempt: 5 }), ["request_human_review"]);
});

Deno.test("baseline: regras determinísticas", () => {
  assertEquals(classifyBaseline(CODE_ERROR), "inspect_failure");
  assertEquals(classifyBaseline({ ...RETRYABLE, errorCategory: "network" }), "retry_operation");
  assertEquals(classifyBaseline({ ...CODE_ERROR, errorCategory: "network" }), "inspect_failure");
  assertEquals(
    classifyBaseline({ ...RETRYABLE, timedOut: true, exitCode: null }),
    "retry_operation",
  );
  assertEquals(
    classifyBaseline({ ...CODE_ERROR, errorSignature: "s", previousErrorSignatures: ["s", "s"] }),
    "request_human_review",
  );
  assertEquals(
    classifyBaseline({ ...CODE_ERROR, errorSignature: "s", previousErrorSignatures: ["s"] }),
    "inspect_failure",
  );
  assertEquals(classifyBaseline({ ...CODE_ERROR, attempt: 5 }), "request_human_review");
});

Deno.test("validateAnswer aceita resposta coerente", () => {
  const v = validateAnswer(
    {
      choice: "inspect_failure",
      probabilities: { inspect_failure: 0.8, request_human_review: 0.2 },
      confidence: 0.3,
    },
    ["inspect_failure", "request_human_review"],
    null,
  );
  assert(v.ok);
  assertEquals(v.choice, "inspect_failure");
});

Deno.test("validateAnswer rejeita respostas inválidas", () => {
  const allowed = ["inspect_failure", "request_human_review"] as const;
  const ok = { inspect_failure: 0.8, request_human_review: 0.2 };
  const cases: [unknown, unknown, string][] = [
    [undefined, ok, "incomplete_response"],
    ["rm -rf /", ok, "unknown_alternative"],
    ["inspect_failure", undefined, "invalid_probabilities"],
    ["inspect_failure", { inspect_failure: 0.8 }, "invalid_probabilities"],
    [
      "inspect_failure",
      { inspect_failure: 0.5, request_human_review: 0.2 },
      "invalid_probabilities",
    ],
    [
      "inspect_failure",
      { inspect_failure: Number.NaN, request_human_review: 0.2 },
      "invalid_probabilities",
    ],
    ["inspect_failure", { ...ok, retry_operation: 0 }, "invalid_probabilities"],
    ["request_human_review", ok, "invalid_probabilities"], // choice não é o argmax
    ["retry_operation", ok, "policy_rejected"], // alternativa conhecida, mas não oferecida
  ];
  for (const [choice, probabilities, reason] of cases) {
    const v = validateAnswer({ choice, probabilities, confidence: 0.9 }, [...allowed], null);
    assertFalse(v.ok);
    assertEquals(v.reason, reason, `${String(choice)} ${JSON.stringify(probabilities)}`);
  }
});

Deno.test("validateAnswer aplica minimumConfidence", () => {
  const probs = { inspect_failure: 0.6, request_human_review: 0.4 };
  const allowed: ("inspect_failure" | "request_human_review")[] = [
    "inspect_failure",
    "request_human_review",
  ];
  const low = validateAnswer(
    { choice: "inspect_failure", probabilities: probs, confidence: 0.02 },
    allowed,
    0.5,
  );
  assertFalse(low.ok);
  assertEquals(low.reason, "low_confidence");
  assertEquals(low.structurallyValid, true);
  const missing = validateAnswer(
    { choice: "inspect_failure", probabilities: probs } as never,
    allowed,
    0.5,
  );
  assertFalse(missing.ok);
  const none = validateAnswer(
    { choice: "inspect_failure", probabilities: probs, confidence: "x" },
    allowed,
    null,
  );
  assert(none.ok);
  assertEquals(none.confidence, undefined);
});

// --- classificador ------------------------------------------------------------------------

Deno.test("desligado: só baseline, provedor nunca chamado", async () => {
  const provider = stubProvider(answer("retry_operation", {}));
  const result = await classifyFailure(RETRYABLE, { config: DEFAULT_CONFIG, provider });
  assertEquals(provider.calls, 0);
  assertEquals(result.source, "baseline");
  assertEquals(result.structurallyValid, null);
});

Deno.test("regra rígida não consulta o modelo", async () => {
  const provider = stubProvider(answer("retry_operation", {}));
  const result = await classifyFailure({ ...RETRYABLE, requiresApproval: true }, {
    config: ENABLED,
    provider,
  });
  assertEquals(provider.calls, 0);
  assertEquals(result.action, "request_human_review");
});

Deno.test("pedido só oferece alternativas permitidas", () => {
  assertEquals(Object.keys(buildRequest(CODE_ERROR).alternatives), [
    "inspect_failure",
    "request_human_review",
  ]);
});

Deno.test("resposta válida do modelo é usada, e o módulo só devolve dados", async () => {
  const provider = stubProvider(
    answer("request_human_review", {
      inspect_failure: 0.3,
      retry_operation: 0.1,
      request_human_review: 0.6,
    }, 0.4),
  );
  const result = await classifyFailure(RETRYABLE, { config: ENABLED, provider });
  assertEquals(result.source, "model");
  assertEquals(result.action, "request_human_review");
  assertEquals(result.baseline, "inspect_failure");
  assertEquals(result.policyAccepted, true);
  // Nenhuma função ou comando no resultado: é uma recomendação serializável.
  assertEquals(JSON.parse(JSON.stringify(result)), result);
});

Deno.test("falhas do provedor caem no fallback configurado", async () => {
  const failing = stubProvider({ ok: false, reason: "unavailable" });
  const viaBaseline = await classifyFailure(CODE_ERROR, { config: ENABLED, provider: failing });
  assertEquals(viaBaseline.action, "inspect_failure");
  assertEquals(viaBaseline.source, "fallback");
  assertEquals(viaBaseline.fallbackReason, "unavailable");

  const viaHuman = await classifyFailure(CODE_ERROR, {
    config: { ...ENABLED, fallback: "request_human_review" },
    provider: failing,
  });
  assertEquals(viaHuman.action, "request_human_review");

  const throwing = stubProvider(() => Promise.reject(new Error("boom")));
  const thrown = await classifyFailure(CODE_ERROR, { config: ENABLED, provider: throwing });
  assertEquals(thrown.fallbackReason, "unavailable");
});

Deno.test("métricas contam válidas, rejeitadas, timeouts e divergências", async () => {
  const metrics = new DecisionMetrics();
  const valid = stubProvider(
    answer("request_human_review", { inspect_failure: 0.4, request_human_review: 0.6 }),
  );
  const bad = stubProvider(answer("nope", {}));
  const timeout = stubProvider({ ok: false, reason: "timeout" });
  await classifyFailure(CODE_ERROR, { config: ENABLED, provider: valid, metrics });
  await classifyFailure(CODE_ERROR, { config: ENABLED, provider: bad, metrics });
  await classifyFailure(CODE_ERROR, { config: ENABLED, provider: timeout, metrics });
  await classifyFailure(CODE_ERROR, { config: DEFAULT_CONFIG, metrics });
  const s = metrics.snapshot();
  assertEquals(s.requests, 4);
  assertEquals(s.modelCalls, 3);
  assertEquals(s.valid, 1);
  assertEquals(s.rejected, 1);
  assertEquals(s.timeouts, 1);
  assertEquals(s.fallbacks, 2);
  assertEquals(s.disagreements, 1);
  assertEquals(s.modelChoices, { request_human_review: 1 });
  assertEquals(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assertEquals(percentile([], 50), 0);
});

// --- provedor Ollama contra servidor HTTP local simulado ----------------------------------

async function withServer(
  handler: (req: Request) => Response | Promise<Response>,
  fn: (endpoint: string) => Promise<void>,
) {
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, handler);
  try {
    await fn(`http://127.0.0.1:${server.addr.port}`);
  } finally {
    await server.shutdown();
  }
}

const VALID_BODY = {
  model: "nimble",
  answers: {
    next_step: {
      type: "choice",
      choice: "inspect_failure",
      probabilities: { inspect_failure: 0.9, request_human_review: 0.1 },
      confidence: 0.53,
    },
  },
  usage: { input_tokens: 120, output_tokens: 1 },
};

async function classifyAgainst(endpoint: string, timeoutMs = 2000) {
  return await classifyFailure(CODE_ERROR, {
    config: { ...ENABLED, endpoint, timeoutMs },
    provider: new OllamaDecisionProvider(endpoint, "nimble"),
  });
}

Deno.test("ollama: resposta válida e corpo da requisição conforme o contrato", async () => {
  let received: Record<string, unknown> = {};
  let path = "";
  await withServer(async (req) => {
    path = new URL(req.url).pathname;
    received = await req.json();
    return Response.json(VALID_BODY);
  }, async (endpoint) => {
    const result = await classifyAgainst(endpoint);
    assertEquals(result.source, "model");
    assertEquals(result.action, "inspect_failure");
    assertEquals(result.confidence, 0.53);
  });
  assertEquals(path, "/v1/systemone");
  assertEquals(received.model, "nimble");
  assertEquals(typeof received.state, "string");
  const question = (received.questions as Record<string, Record<string, unknown>>).next_step;
  assertEquals(question.type, "choice");
  assertEquals(Object.keys(question.criteria as object), [
    "inspect_failure",
    "request_human_review",
  ]);
});

Deno.test("ollama: timeout", async () => {
  await withServer(async () => {
    await new Promise((r) => setTimeout(r, 400));
    return Response.json(VALID_BODY);
  }, async (endpoint) => {
    const result = await classifyAgainst(endpoint, 100);
    assertEquals(result.fallbackReason, "timeout");
    assertEquals(result.action, "inspect_failure");
  });
});

Deno.test("ollama: códigos HTTP mapeados para motivos de fallback", async () => {
  const cases: [number, string, string][] = [
    [404, JSON.stringify({ error: "model 'nimble' not found" }), "model_not_found"],
    [404, "404 page not found", "incompatible_endpoint"],
    [400, JSON.stringify({ error: "unsupported model or runner" }), "incompatible_endpoint"],
    [400, JSON.stringify({ error: "invalid request" }), "http_error"],
    [500, JSON.stringify({ error: "scoring failed" }), "http_error"],
  ];
  for (const [status, body, reason] of cases) {
    await withServer(() => new Response(body, { status }), async (endpoint) => {
      const result = await classifyAgainst(endpoint);
      assertEquals(result.fallbackReason, reason, `${status} ${body}`);
      assertEquals(result.source, "fallback");
    });
  }
});

Deno.test("ollama: respostas malformadas", async () => {
  const cases: [string, string][] = [
    ["not json", "invalid_json"],
    [JSON.stringify({ answers: {} }), "incomplete_response"],
    [
      JSON.stringify({ answers: { next_step: { type: "noul", noul: 0.4 } } }),
      "incomplete_response",
    ],
    [
      JSON.stringify({
        answers: { next_step: { ...VALID_BODY.answers.next_step, choice: "deploy" } },
      }),
      "unknown_alternative",
    ],
    [
      JSON.stringify({
        answers: { next_step: { ...VALID_BODY.answers.next_step, probabilities: null } },
      }),
      "invalid_probabilities",
    ],
  ];
  for (const [body, reason] of cases) {
    await withServer(() => new Response(body, { status: 200 }), async (endpoint) => {
      const result = await classifyAgainst(endpoint);
      assertEquals(result.fallbackReason, reason, body);
    });
  }
});

Deno.test("ollama: serviço indisponível", async () => {
  // Abre e fecha um listener para obter uma porta livre sem nada escutando.
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const result = await classifyAgainst(`http://127.0.0.1:${port}`);
  assertEquals(result.fallbackReason, "unavailable");
  assertEquals(result.action, "inspect_failure");
});

// --- regressão: CLI desligada não abre rede -----------------------------------------------

Deno.test("CLI com experimento desligado responde a baseline sem permissão de rede", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cmd = new Deno.Command(Deno.execPath(), {
      // Sem --allow-net: qualquer tentativa de conexão falharia.
      args: ["run", "--allow-read", new URL("../classify-failure.ts", import.meta.url).pathname],
      cwd: dir,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    });
    const child = cmd.spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(JSON.stringify(RETRYABLE)));
    await writer.close();
    const out = await child.output();
    assertEquals(out.code, 0, new TextDecoder().decode(out.stderr));
    const result = JSON.parse(new TextDecoder().decode(out.stdout));
    assertEquals(result.source, "baseline");
    assertEquals(result.action, "inspect_failure");
    assertEquals(new TextDecoder().decode(out.stderr), "");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CLI ligada sem --allow-net cai no fallback network_denied", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/.claude/vetor`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/.claude/vetor/config.json`,
      JSON.stringify({ decisionAdapter: { enabled: true } }),
    );
    const child = new Deno.Command(Deno.execPath(), {
      args: ["run", "--allow-read", new URL("../classify-failure.ts", import.meta.url).pathname],
      cwd: dir,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(JSON.stringify(CODE_ERROR)));
    await writer.close();
    const out = await child.output();
    assertEquals(out.code, 0);
    const result = JSON.parse(new TextDecoder().decode(out.stdout));
    assertEquals(result.fallbackReason, "network_denied");
    assertEquals(result.action, "inspect_failure");
    assertEquals(result.fallbackDetail, undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// --- benchmark ----------------------------------------------------------------------------

Deno.test("benchmark: baseline nos cenários rotulados", async () => {
  const report = await runBench(loadScenarios(), {});
  const misses = report.outcomes.filter((o) => o.baseline !== o.expected).map((o) => o.id);
  // Lacuna conhecida da baseline: sem categoria, ela não lê o texto livre do erro.
  assertEquals(misses, ["text-only-transient", "text-only-transient-503"]);
  assertEquals(report.model, undefined);
});
