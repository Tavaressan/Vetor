import { assertEquals } from "@std/assert";

// Testa a função de detecção de padrões isoladamente.

// Importamos a lógica core do script. Como o script usa Deno.args/Deno.exit no
// módulo topo-level, testamos a lógica recriando-a aqui (padrão do projeto: testes
// unitários da lógica, não do CLI).

const INFRA_PATTERNS = [
  /job.*not.*started/i,
  /spending.*limit/i,
  /billing/i,
  /outage/i,
  /account.*payment/i,
  /payment.*fail/i,
  /runner.*unavailable/i,
  /resource.*unavailable/i,
  /workflow.*unavailable/i,
];

interface JobAnnotation {
  name: string;
  message: string;
}

function matchesInfrastructureFailure(annotations: JobAnnotation[]): string | null {
  for (const { name, message } of annotations) {
    for (const pattern of INFRA_PATTERNS) {
      if (pattern.test(message)) {
        return `[${name}] ${message}`;
      }
    }
  }
  return null;
}

Deno.test("detecta billing failure", () => {
  const annotations: JobAnnotation[] = [
    {
      name: "Detect changed paths",
      message:
        "The job was not started because recent account payments have failed or your spending limit needs to be increased.",
    },
  ];
  const result = matchesInfrastructureFailure(annotations);
  assertEquals(result !== null, true);
  assertEquals(result!.includes("Detect changed paths"), true);
  assertEquals(result!.includes("spending limit"), true);
});

Deno.test("detecta spending limit", () => {
  const annotations: JobAnnotation[] = [
    { name: "build", message: "Your spending limit has been reached" },
  ];
  const result = matchesInfrastructureFailure(annotations);
  assertEquals(result !== null, true);
  assertEquals(result!.includes("spending limit"), true);
});

Deno.test("detecta job not started", () => {
  const annotations: JobAnnotation[] = [
    { name: "test", message: "The job was not started due to timeout" },
  ];
  const result = matchesInfrastructureFailure(annotations);
  assertEquals(result !== null, true);
  assertEquals(result!.includes("job"), true);
});

Deno.test("detecta outage", () => {
  const annotations: JobAnnotation[] = [
    { name: "deploy", message: "GitHub Actions outage detected in region us-east-1" },
  ];
  const result = matchesInfrastructureFailure(annotations);
  assertEquals(result !== null, true);
  assertEquals(result!.includes("outage"), true);
});

Deno.test("detecta runner unavailable", () => {
  const annotations: JobAnnotation[] = [
    { name: "lint", message: "Runner unavailable: no runners matched the request" },
  ];
  const result = matchesInfrastructureFailure(annotations);
  assertEquals(result !== null, true);
  assertEquals(result!.includes("Runner unavailable"), true);
});

Deno.test("retorna null para falha de código (lint error)", () => {
  const annotations: JobAnnotation[] = [
    { name: "lint", message: "Error: Unexpected token at line 42" },
  ];
  const result = matchesInfrastructureFailure(annotations);
  assertEquals(result, null);
});

Deno.test("retorna null para falha de teste", () => {
  const annotations: JobAnnotation[] = [
    { name: "test", message: "FAIL: src/foo.test.ts - expected 1 to equal 2" },
  ];
  const result = matchesInfrastructureFailure(annotations);
  assertEquals(result, null);
});

Deno.test("retorna null para anotações vazias", () => {
  const result = matchesInfrastructureFailure([]);
  assertEquals(result, null);
});

Deno.test("retorna null quando não há anotações nos jobs", () => {
  const annotations: JobAnnotation[] = [];
  const result = matchesInfrastructureFailure(annotations);
  assertEquals(result, null);
});

Deno.test("detecta payment fail", () => {
  const annotations: JobAnnotation[] = [
    { name: "build", message: "Account payment failed. Please update billing info." },
  ];
  const result = matchesInfrastructureFailure(annotations);
  assertEquals(result !== null, true);
  assertEquals(result!.includes("payment"), true);
});

Deno.test("detecta resource unavailable", () => {
  const annotations: JobAnnotation[] = [
    { name: "build", message: "Resource unavailable: storage quota exceeded" },
  ];
  const result = matchesInfrastructureFailure(annotations);
  assertEquals(result !== null, true);
});

Deno.test("detecta workflow unavailable", () => {
  const annotations: JobAnnotation[] = [
    { name: "deploy", message: "Workflow unavailable: service degraded" },
  ];
  const result = matchesInfrastructureFailure(annotations);
  assertEquals(result !== null, true);
});
