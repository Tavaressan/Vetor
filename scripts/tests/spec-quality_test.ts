// Testes de scripts/lib/spec-quality.ts — Quality Model (score 0-100 ponderado) e Quality Gate
// (#220). https://github.com/Tavaressan/Vetor/issues/220

import { assertEquals } from "@std/assert";
import {
  computeQuality,
  DEFAULT_THRESHOLDS,
  type Dimension,
  DIMENSION_WEIGHTS,
  type DimensionResult,
  type Gap,
  gateFor,
  resolveThresholds,
} from "../lib/spec-quality.ts";

function gap(overrides: Partial<Gap> = {}): Gap {
  return {
    location: "RF-01",
    problem: "faltou",
    impact: "impacto",
    suggestedAction: "corrigir",
    ...overrides,
  };
}

function full(): DimensionResult {
  return { fraction: 1, gaps: [], strengths: ["ok"] };
}

function empty(dimension = "dim"): DimensionResult {
  return {
    fraction: 0,
    gaps: [gap({ location: dimension, suggestedAction: `corrigir ${dimension}` })],
    strengths: [],
  };
}

Deno.test("DIMENSION_WEIGHTS soma 100 e cobre as 5 dimensões do Quality Model (#203 §2)", () => {
  const dims = Object.keys(DIMENSION_WEIGHTS) as Dimension[];
  assertEquals(dims.length, 5);
  assertEquals(
    dims.reduce((sum, d) => sum + DIMENSION_WEIGHTS[d], 0),
    100,
  );
  assertEquals(DIMENSION_WEIGHTS.completeness, 30);
  assertEquals(DIMENSION_WEIGHTS.testability, 25);
  assertEquals(DIMENSION_WEIGHTS.clarity, 20);
  assertEquals(DIMENSION_WEIGHTS.scope, 15);
  assertEquals(DIMENSION_WEIGHTS.edgeCases, 10);
});

Deno.test("gateFor classifica conforme os thresholds default (80/60)", () => {
  assertEquals(gateFor(100), "READY");
  assertEquals(gateFor(80), "READY");
  assertEquals(gateFor(79), "NEEDS_REFINEMENT");
  assertEquals(gateFor(60), "NEEDS_REFINEMENT");
  assertEquals(gateFor(59), "INCOMPLETE");
  assertEquals(gateFor(0), "INCOMPLETE");
});

Deno.test("gateFor aceita thresholds customizados (configuráveis)", () => {
  const custom = { ready: 90, needsRefinement: 50 };
  assertEquals(gateFor(85, custom), "NEEDS_REFINEMENT");
  assertEquals(gateFor(90, custom), "READY");
  assertEquals(gateFor(49, custom), "INCOMPLETE");
});

Deno.test("resolveThresholds usa default quando config não define specValidate.thresholds", () => {
  assertEquals(resolveThresholds(null), DEFAULT_THRESHOLDS);
  assertEquals(resolveThresholds({}), DEFAULT_THRESHOLDS);
});

Deno.test("resolveThresholds aplica override parcial de specValidate.thresholds", () => {
  const resolved = resolveThresholds({ specValidate: { thresholds: { ready: 90 } } });
  assertEquals(resolved, { ready: 90, needsRefinement: DEFAULT_THRESHOLDS.needsRefinement });
});

Deno.test("computeQuality com todas as dimensões plenas soma 100/100 e READY", () => {
  const result = computeQuality({
    completeness: full(),
    testability: full(),
    clarity: full(),
    scope: full(),
    edgeCases: full(),
  });
  assertEquals(result.score, 100);
  assertEquals(result.gate, "READY");
  assertEquals(result.dimensions.completeness.score, 30);
  assertEquals(result.dimensions.testability.max, 25);
});

Deno.test("computeQuality com todas as dimensões vazias soma 0/100 e INCOMPLETE, gaps agregados", () => {
  const result = computeQuality({
    completeness: empty("completeness"),
    testability: empty("testability"),
    clarity: empty("clarity"),
    scope: empty("scope"),
    edgeCases: empty("edgeCases"),
  });
  assertEquals(result.score, 0);
  assertEquals(result.gate, "INCOMPLETE");
  assertEquals(result.gaps.length, 5);
  assertEquals(result.strengths.length, 0);
  assertEquals(result.suggestions.length, 5);
});

Deno.test("computeQuality deduplica suggestions repetidas entre dimensões (#222)", () => {
  const result = computeQuality({
    completeness: empty("completeness"),
    testability: empty("testability"),
    clarity: full(),
    scope: full(),
    edgeCases: full(),
  });
  // As duas dimensões vazias usam suggestedAction distintos ("corrigir completeness" /
  // "corrigir testability") — sem duplicata aqui; o teste garante que suggestions repetidas
  // (mesmo texto de suggestedAction em gaps diferentes) colapsam para uma única entrada.
  assertEquals(result.suggestions.length, 2);

  const duplicated = computeQuality({
    completeness: { fraction: 0, gaps: [gap({ suggestedAction: "mesma ação" })], strengths: [] },
    testability: { fraction: 0, gaps: [gap({ suggestedAction: "mesma ação" })], strengths: [] },
    clarity: full(),
    scope: full(),
    edgeCases: full(),
  });
  assertEquals(duplicated.suggestions.length, 1);
});

Deno.test("computeQuality pondera fração parcial por dimensão", () => {
  const result = computeQuality({
    completeness: { fraction: 0.5, gaps: [], strengths: [] }, // 15/30
    testability: full(), // 25
    clarity: full(), // 20
    scope: full(), // 15
    edgeCases: empty(), // 0/10
  });
  assertEquals(result.score, 75);
  assertEquals(result.gate, "NEEDS_REFINEMENT");
});
