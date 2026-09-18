// Testes de scripts/lib/spec-quality-report.ts — Quality Report em Markdown com feedback
// acionável por gap (location/problem/impact/suggestedAction) e refinamento iterativo com limite
// de ciclos (#222, #203 §9-§11).

import { assertEquals, assertMatch } from "@std/assert";
import type { Gap, QualityResult } from "../lib/spec-quality.ts";
import {
  appendValidation,
  MAX_REFINEMENT_CYCLES,
  renderQualityReport,
  renderScoreEvolution,
  type ValidationRecord,
} from "../lib/spec-quality-report.ts";

function gap(overrides: Partial<Gap> = {}): Gap {
  return {
    location: "RF-03",
    problem: "não possui comportamento definido para timeout",
    impact: "o comportamento fica indefinido em caso de falha de rede",
    suggestedAction: "definir se o sistema deve retornar erro, executar retry ou ficar pendente",
    ...overrides,
  };
}

function result(overrides: Partial<QualityResult> = {}): QualityResult {
  return {
    score: 84,
    gate: "READY",
    dimensions: {
      completeness: { score: 27, max: 30, gaps: [], strengths: [] },
      testability: { score: 21, max: 25, gaps: [], strengths: [] },
      clarity: { score: 18, max: 20, gaps: [], strengths: [] },
      scope: { score: 12, max: 15, gaps: [], strengths: [] },
      edgeCases: { score: 6, max: 10, gaps: [], strengths: [] },
    },
    strengths: ["Requirements have stable IDs."],
    gaps: [gap()],
    suggestions: [gap().suggestedAction],
    ...overrides,
  };
}

Deno.test("renderQualityReport inclui Score/Status/Dimensions/Strengths/Gaps/Suggestions", () => {
  const md = renderQualityReport("docs/specs/authentication.md", result());
  assertMatch(md, /# Spec Quality Report/);
  assertMatch(md, /Score:\s*84\/100/);
  assertMatch(md, /Status:\s*READY/);
  assertMatch(md, /## Dimensions/);
  assertMatch(md, /## Strengths/);
  assertMatch(md, /## Gaps/);
  assertMatch(md, /## Suggestions/);
});

Deno.test("renderQualityReport nunca emite feedback genérico — cada gap cita location/problem/impact/suggested action", () => {
  const md = renderQualityReport("docs/specs/authentication.md", result());
  assertMatch(md, /RF-03/);
  assertMatch(md, /não possui comportamento definido para timeout/);
  assertMatch(md, /o comportamento fica indefinido em caso de falha de rede/);
  assertMatch(md, /definir se o sistema deve retornar erro/);
  // nunca deve conter a saída genérica proibida por #203 §9
  assertEquals(/spec precisa ser melhorada/i.test(md), false);
});

Deno.test("renderQualityReport inclui a evolução do score quando há histórico de refinamento", () => {
  const history: ValidationRecord[] = [
    { timestamp: "2026-01-01T00:00:00Z", score: 54, gate: "INCOMPLETE" },
    { timestamp: "2026-01-01T00:05:00Z", score: 71, gate: "NEEDS_REFINEMENT" },
    { timestamp: "2026-01-01T00:10:00Z", score: 84, gate: "READY" },
  ];
  const md = renderQualityReport("docs/specs/authentication.md", result(), { history });
  assertMatch(md, /54 → 71 → 84/);
});

Deno.test("renderScoreEvolution formata a sequência de scores com seta", () => {
  const history: ValidationRecord[] = [
    { timestamp: "t1", score: 54, gate: "INCOMPLETE" },
    { timestamp: "t2", score: 71, gate: "NEEDS_REFINEMENT" },
    { timestamp: "t3", score: 84, gate: "READY" },
  ];
  assertEquals(renderScoreEvolution(history), "54 → 71 → 84");
});

Deno.test("MAX_REFINEMENT_CYCLES é 3 (#203 §10)", () => {
  assertEquals(MAX_REFINEMENT_CYCLES, 3);
});

Deno.test("appendValidation acumula histórico normalmente até o limite de ciclos", () => {
  let history: ValidationRecord[] = [];
  for (const score of [54, 71, 84]) {
    const outcome = appendValidation(history, {
      timestamp: `t-${score}`,
      score,
      gate: "READY",
    });
    assertEquals(outcome.capReached, false);
    history = outcome.history;
  }
  assertEquals(history.length, 3);
});

Deno.test("appendValidation sinaliza capReached ao exceder MAX_REFINEMENT_CYCLES refinamentos após a validação inicial", () => {
  // 1 validação inicial + MAX_REFINEMENT_CYCLES refinamentos = 4 entradas cabem; a 5ª estoura.
  let history: ValidationRecord[] = [];
  for (let i = 0; i < MAX_REFINEMENT_CYCLES + 1; i++) {
    const outcome = appendValidation(history, { timestamp: `t${i}`, score: i, gate: "READY" });
    assertEquals(outcome.capReached, false);
    history = outcome.history;
  }
  assertEquals(history.length, MAX_REFINEMENT_CYCLES + 1);

  const overflow = appendValidation(history, { timestamp: "overflow", score: 100, gate: "READY" });
  assertEquals(overflow.capReached, true);
  // Histórico não muda quando o cap é atingido — nunca refina indefinidamente.
  assertEquals(overflow.history, history);
});
