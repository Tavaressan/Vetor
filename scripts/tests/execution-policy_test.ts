import { assertEquals } from "@std/assert";
import { parseExecutionPolicy } from "../lib/execution/policy.ts";

const allowedSensitivityPolicy = {
  public: ["codex", "claude-code"],
  private: ["codex"],
  sensitive: [],
  unknown: [],
};

Deno.test("parseExecutionPolicy: config ausente mantém manual inline por padrão", () => {
  assertEquals(parseExecutionPolicy(undefined), {
    policy: {
      mode: "manual",
      authorizedExecutors: [],
      dataSensitivityPolicy: {
        public: [],
        private: [],
        sensitive: [],
        unknown: [],
      },
      maxRetryAttempts: 2,
    },
    errors: [],
  });
});

Deno.test("parseExecutionPolicy: aceita os três modos e configurações opcionais", () => {
  const manual = parseExecutionPolicy({ execution: { mode: "manual" } });
  assertEquals(manual.policy.mode, "manual");
  assertEquals(manual.errors, []);

  for (const mode of ["assisted", "autonomous"] as const) {
    const result = parseExecutionPolicy({
      delegation: { preferredRuntime: "untouched" },
      execution: {
        mode,
        authorizedExecutors: ["codex", "claude-code"],
        dataSensitivityPolicy: allowedSensitivityPolicy,
        defaultDataSensitivity: "private",
        maxRetryAttempts: 0,
      },
    });
    assertEquals(result.policy, {
      mode,
      authorizedExecutors: ["codex", "claude-code"],
      dataSensitivityPolicy: allowedSensitivityPolicy,
      defaultDataSensitivity: "private",
      maxRetryAttempts: 0,
    });
    assertEquals(result.errors, []);
  }
});

Deno.test("parseExecutionPolicy: ausências em modo ativo falham fechadas para manual", () => {
  for (const mode of ["assisted", "autonomous"] as const) {
    const result = parseExecutionPolicy({ execution: { mode } });
    assertEquals(result.policy.mode, "manual");
    assertEquals(
      result.errors.map((error) => error.path),
      ["execution.authorizedExecutors", "execution.dataSensitivityPolicy"],
    );
    assertEquals(result.policy.dataSensitivityPolicy.unknown, []);
  }
});

Deno.test("parseExecutionPolicy: política parcial bloqueia níveis ausentes", () => {
  const result = parseExecutionPolicy({
    execution: {
      mode: "assisted",
      authorizedExecutors: ["codex"],
      dataSensitivityPolicy: { public: ["codex"] },
    },
  });
  assertEquals(result.policy.dataSensitivityPolicy.public, ["codex"]);
  assertEquals(result.policy.dataSensitivityPolicy.private, []);
  assertEquals(result.policy.dataSensitivityPolicy.sensitive, []);
  assertEquals(result.policy.dataSensitivityPolicy.unknown, []);
});

Deno.test("parseExecutionPolicy: entradas inválidas usam a política segura padrão", () => {
  const invalidConfigs: unknown[] = [
    null,
    { execution: null },
    { execution: { mode: "automatic" } },
    {
      execution: {
        mode: "assisted",
        authorizedExecutors: ["codex"],
        dataSensitivityPolicy: { public: "codex" },
      },
    },
    {
      execution: {
        mode: "manual",
        defaultDataSensitivity: "critical",
      },
    },
    {
      execution: {
        mode: "manual",
        maxRetryAttempts: -1,
      },
    },
  ];

  for (const config of invalidConfigs) {
    const result = parseExecutionPolicy(config);
    assertEquals(result.policy.mode, "manual");
    assertEquals(result.policy.authorizedExecutors, []);
    assertEquals(result.policy.maxRetryAttempts, 2);
    assertEquals(result.errors.length > 0, true);
  }
});

Deno.test("parseExecutionPolicy: autonomous exige pelo menos um executor autorizado", () => {
  const result = parseExecutionPolicy({
    execution: {
      mode: "autonomous",
      authorizedExecutors: [],
      dataSensitivityPolicy: allowedSensitivityPolicy,
    },
  });
  assertEquals(result.policy.mode, "manual");
  assertEquals(result.errors[0]?.path, "execution.authorizedExecutors");
});
