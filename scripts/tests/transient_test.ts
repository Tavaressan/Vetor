import { assertEquals, assertNotEquals } from "@std/assert";
import { detectTransient, LOOSE_PATTERNS } from "../lib/decision-adapter/transient.ts";
import { classifyBaseline } from "../lib/decision-adapter/baseline.ts";
import type { FailureContext } from "../lib/decision-adapter/types.ts";

const transient = (text: string) => detectTransient(text) !== null;

Deno.test("detectTransient reconhece rede, DNS público, TLS, gateway e rate limit", () => {
  for (
    const text of [
      "fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com",
      "npm error request to https://registry.npmjs.org/x failed, reason: getaddrinfo EAI_AGAIN registry.npmjs.org",
      "error: JSR package manifest for '@std/assert' failed to load: 503 Service Unavailable",
      "connection error: connection reset by peer (os error 104)",
      "net/http: TLS handshake timeout",
      "Received status code 502 from server: Bad Gateway",
      "You have exceeded a secondary rate limit.",
      "error: RPC failed; curl 56 GnuTLS recv error",
    ]
  ) assertEquals(transient(text), true, text);
});

Deno.test("detectTransient ignora DNS de serviço interno: é serviço ausente, não rede", () => {
  assertEquals(
    transient(
      "error sending request for url (http://embedding-service:8000/x): dns error: failed to lookup address information: Temporary failure in name resolution",
    ),
    false,
  );
  assertEquals(transient("Could not resolve host: db.internal"), false);
  assertEquals(transient("getaddrinfo ENOTFOUND localhost"), false);
});

Deno.test("detectTransient ignora asserções e títulos de teste", () => {
  for (
    const text of [
      "  ● health › returns 503 Service Unavailable when the database is down",
      "✗ retries on ECONNRESET",
      "  AssertionError: expected ETIMEDOUT to be handled",
      "Expected: 503 Service Unavailable",
      "ClientTest > handlesSocketHangUp_socket hang up FAILED",
    ]
  ) assertEquals(transient(text), false, text);
});

Deno.test("detectTransient não pula linha só porque o nome do pacote contém assert", () => {
  assertEquals(
    transient("Import 'https://jsr.io/@std/assert/meta.json' failed: 503 Service Unavailable"),
    true,
  );
});

Deno.test("padrões amplos casam com nome de teste; os estritos não", () => {
  const line = "DemoModeIntegrationTest > allEndpoints_withoutRealNetwork FAILED";
  assertNotEquals(detectTransient(line, { patterns: LOOSE_PATTERNS, guard: false }), null);
  assertEquals(detectTransient(line), null);
});

Deno.test("classifyBaseline só lê o texto com transientFromText", () => {
  const context: FailureContext = {
    operation: "ci",
    exitCode: 1,
    attempt: 1,
    maxAttempts: 3,
    retryable: true,
    errorSummary:
      "fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com",
  };
  assertEquals(classifyBaseline(context), "inspect_failure");
  assertEquals(classifyBaseline(context, { transientFromText: true }), "retry_operation");
  assertEquals(
    classifyBaseline({ ...context, retryable: false }, { transientFromText: true }),
    "inspect_failure",
  );
});
