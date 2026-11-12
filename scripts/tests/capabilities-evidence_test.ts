import { assertEquals, assertThrows } from "@std/assert";
import type {
  EffectiveCapability,
  HarnessDescriptor,
  HarnessObservation,
} from "../lib/capabilities/types.ts";
import { meetsEvidence, resolveEffective } from "../lib/capabilities/evidence.ts";

function descriptor(): HarnessDescriptor {
  return {
    descriptorVersion: 1,
    id: "portable-harness",
    kind: "cli",
    command: "agent",
    versionRange: ">=1.0.0 <2.0.0",
    declared: {
      terminal: { state: "supported", source: "perfil.ts:1" },
      filesystem: { state: "supported", source: "perfil.ts:2" },
      git: { state: "unknown", source: "perfil.ts:3" },
    },
  };
}

function observation(
  capabilities: HarnessObservation["capabilities"],
  overrides: Partial<HarnessObservation> = {},
): HarnessObservation {
  return {
    executorId: "portable-harness",
    observedAt: "2026-11-12T10:00:00.000Z",
    version: "1.5.0",
    capabilities,
    sideEffects: "none",
    ...overrides,
  };
}

Deno.test("resolveEffective starts from declared claims and treats missing claims as unknown", () => {
  const effective = resolveEffective(descriptor(), []);

  assertEquals(effective.terminal, {
    state: "supported",
    level: "declared",
    sources: ["perfil.ts:1"],
  });
  assertEquals(effective.browser, { state: "unknown", level: "declared", sources: [] });
});

Deno.test("resolveEffective gives higher evidence precedence and ignores unknown observations", () => {
  const effective = resolveEffective(descriptor(), [
    observation({
      terminal: { state: "unsupported", level: "verified", source: "probe:terminal" },
      filesystem: { state: "unknown", level: "verified", source: "probe:filesystem" },
    }),
  ]);

  assertEquals(effective.terminal.state, "unsupported");
  assertEquals(effective.terminal.level, "verified");
  assertEquals(effective.terminal.conflict?.includes("declared=supported"), true);
  assertEquals(effective.filesystem.state, "supported");
  assertEquals(effective.filesystem.level, "declared");
});

Deno.test("resolveEffective resolves same-level conflicts conservatively", () => {
  const effective = resolveEffective(descriptor(), [
    observation({
      browser: { state: "supported", level: "verified", source: "probe:a" },
    }),
    observation({
      browser: { state: "unsupported", level: "verified", source: "probe:b" },
    }),
  ]);

  assertEquals(effective.browser.state, "unsupported");
  assertEquals(effective.browser.level, "verified");
  assertEquals(effective.browser.conflict, "verified=supported, verified=unsupported");
  assertEquals(effective.browser.sources, ["probe:a", "probe:b"]);
});

Deno.test("resolveEffective ignores stale observations using caller-provided time", () => {
  const effective = resolveEffective(
    descriptor(),
    [
      observation({
        terminal: { state: "unsupported", level: "verified", source: "stale-probe" },
      }),
    ],
    { now: "2026-11-12T11:00:00.000Z", maxAgeMs: 30 * 60 * 1000 },
  );

  assertEquals(effective.terminal.state, "supported");
  assertEquals(effective.terminal.level, "declared");
});

Deno.test("resolveEffective invalidates declared claims outside the observed version range", () => {
  const effective = resolveEffective(descriptor(), [
    observation({}, { version: "2.0.0" }),
  ]);

  assertEquals(effective.terminal.state, "unknown");
  assertEquals(effective.terminal.sources, ["perfil.ts:1"]);
});

Deno.test("resolveEffective keeps declared claims when the version is unknown", () => {
  const effective = resolveEffective(descriptor(), [
    observation({}, { version: undefined }),
  ]);

  assertEquals(effective.terminal.state, "supported");
  assertEquals(effective.terminal.level, "declared");
});

Deno.test("resolveEffective rejects unknown or stale timestamps when freshness is requested", () => {
  const observations = [
    observation({
      terminal: { state: "unsupported", level: "verified", source: "invalid-date" },
    }, { observedAt: "not-a-date" }),
  ];

  assertEquals(
    resolveEffective(descriptor(), observations, {
      now: "2026-11-12T11:00:00.000Z",
      maxAgeMs: 60_000,
    }).terminal.state,
    "supported",
  );
  assertThrows(
    () => resolveEffective(descriptor(), observations, { maxAgeMs: 60_000 }),
    TypeError,
  );
});

Deno.test("resolveEffective handles common semver range operators and rejects incompatible versions", () => {
  for (
    const [range, version, expected] of [
      ["^1.2.3", "1.9.0", "supported"],
      ["~1.2", "1.3.0", "unknown"],
      ["1.x", "1.8.4", "supported"],
      ["1.0.0 || 2.0.0", "2.1.0", "unknown"],
      ["1.0.0 ||", "1.0.0", "unknown"],
    ] as const
  ) {
    const effective = resolveEffective(
      { ...descriptor(), versionRange: range },
      [observation({}, { version })],
    );
    assertEquals(effective.terminal.state, expected, `${range} / ${version}`);
  }
});

Deno.test("meetsEvidence enforces assisted, autonomous, and explicitly operational evidence", () => {
  const claim: EffectiveCapability = {
    state: "supported",
    level: "declared",
    sources: ["perfil.ts:1"],
  };
  const verified: EffectiveCapability = { ...claim, level: "verified" };
  const operational: EffectiveCapability = { ...claim, level: "operational" };

  assertEquals(meetsEvidence(claim, "assisted"), true);
  assertEquals(meetsEvidence(claim, "autonomous"), false);
  assertEquals(meetsEvidence(verified, "autonomous"), true);
  assertEquals(meetsEvidence(verified, "assisted", "operational"), false);
  assertEquals(meetsEvidence(operational, "assisted", "operational"), true);
  assertEquals(meetsEvidence(claim, "manual", "operational"), true);
});

Deno.test("meetsEvidence fails closed for operational requirements without an operational probe", () => {
  const declaredOnly: EffectiveCapability = {
    state: "supported",
    level: "declared",
    sources: ["perfil.ts:1"],
  };

  assertEquals(meetsEvidence(declaredOnly, "assisted", "operational"), false);
  assertEquals(
    meetsEvidence(
      { ...declaredOnly, state: "unknown", level: "operational" },
      "assisted",
      "operational",
    ),
    false,
  );
});
