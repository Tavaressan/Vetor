// Testes dos heurísticos de linguagem de #221 — estendem os checkers estruturais de #220
// (spec-quality-checkers_test.ts): Completeness (Must sem Acceptance Criteria vira gap),
// Testability (termos vagos sem métrica), Clarity (⚠️ ABERTO explícito vs. omissão silenciosa),
// Scope (Non-Goals — já coberto em #220, aqui só a mensagem específica) e Edge Cases (contextual,
// sem exigir todas as categorias).

import { assertEquals, assertMatch } from "@std/assert";
import { parseSpec } from "../lib/spec-parser.ts";
import {
  checkClarity,
  checkCompleteness,
  checkEdgeCases,
  checkTestability,
} from "../lib/spec-quality-checkers.ts";

function specWithRequirement(requirementBlock: string, extra = ""): string {
  return `# Tema

## Context

Contexto.

## Goals

Goal.

## Non-Goals

Non-goal.

## Functional Requirements

${requirementBlock}

## Edge Cases

${extra || "Nenhum edge case relevante identificado para este tema."}

## Open Questions

Nenhuma questão em aberto.
`;
}

Deno.test("checkCompleteness: requisito Must sem Acceptance Criteria gera gap (#221 acceptance)", () => {
  const spec = specWithRequirement(`### RF-01 - Login

**Priority:** Must

**Description:**

Usuário autentica.
`);
  const result = checkCompleteness(parseSpec(spec));
  assertEquals(
    result.gaps.some((g) => g.location === "RF-01" && /Acceptance Criteria/.test(g.problem)),
    true,
  );
});

Deno.test("checkCompleteness: requisito Must com Acceptance Criteria não gera esse gap", () => {
  const spec = specWithRequirement(`### RF-01 - Login

**Priority:** Must

**Description:**

Usuário autentica.

**Acceptance Criteria:**

- [ ] Login válido retorna sessão.
`);
  const result = checkCompleteness(parseSpec(spec));
  assertEquals(result.gaps.some((g) => g.location === "RF-01"), false);
});

Deno.test("checkCompleteness: requisito Should sem Acceptance Criteria não é penalizado", () => {
  const spec = specWithRequirement(`### RF-01 - Logout

**Priority:** Should

**Description:**

Usuário encerra sessão.
`);
  const result = checkCompleteness(parseSpec(spec));
  assertEquals(result.gaps.some((g) => g.location === "RF-01"), false);
});

Deno.test('checkTestability: termo vago sem métrica ("resposta rápida") gera gap', () => {
  const spec = specWithRequirement(`### RNF-01 - Desempenho

**Priority:** Must

**Description:**

O sistema deve ter resposta rápida.

**Acceptance Criteria:**

- [ ] Resposta rápida em qualquer condição.
`);
  const result = checkTestability(parseSpec(spec));
  assertEquals(
    result.gaps.some((g) => /RNF-01/.test(g.location) && /rápid/i.test(g.problem)),
    true,
  );
});

Deno.test('checkTestability: termo vago com métrica mensurável ("até 500ms no P95") não gera gap de vague term', () => {
  const spec = specWithRequirement(`### RNF-01 - Desempenho

**Priority:** Must

**Description:**

O sistema deve ter resposta rápida, em até 500ms no percentil P95.

**Acceptance Criteria:**

- [ ] Resposta em até 500ms no P95.
`);
  const result = checkTestability(parseSpec(spec));
  assertEquals(result.gaps.some((g) => /rápid/i.test(g.problem)), false);
});

Deno.test("checkTestability: presença de termo vago não invalida a spec automaticamente (fraction > 0)", () => {
  const spec = specWithRequirement(`### RNF-01 - Desempenho

**Priority:** Must

**Description:**

O sistema deve ser robusto.

**Acceptance Criteria:**

- [ ] Sistema é robusto.
`);
  const result = checkTestability(parseSpec(spec));
  assertEquals(result.fraction > 0, true);
});

Deno.test('checkClarity: "⚠️ ABERTO" explícito não conta como gap (unknown but explicit)', () => {
  const spec = specWithRequirement(`### RF-01 - Login

**Priority:** Must

**Description:**

⚠️ ABERTO: definir comportamento quando o serviço externo estiver indisponível.

**Acceptance Criteria:**

- [ ] ⚠️ ABERTO: definir critério de aceite.
`);
  const result = checkClarity(parseSpec(spec));
  assertEquals(result.gaps.some((g) => g.location === "RF-01"), false);
});

Deno.test('checkClarity: "TBD"/"a definir" sem ⚠️ ABERTO é omissão escondida (unknown and hidden) -> gap', () => {
  const spec = specWithRequirement(`### RF-01 - Login

**Priority:** Must

**Description:**

Comportamento a definir (TBD).

**Acceptance Criteria:**

- [ ] Critério a definir.
`);
  const result = checkClarity(parseSpec(spec));
  assertEquals(result.gaps.some((g) => g.location === "RF-01"), true);
});

Deno.test("checkEdgeCases: avaliação contextual não exige todas as categorias — categoria única relevante já soma", () => {
  const spec = specWithRequirement(
    `### RF-01 - Login

**Priority:** Must

**Description:**

Login.

**Acceptance Criteria:**

- [ ] Login funciona.
`,
    "Timeout na dependência externa retorna erro 504 ao usuário.",
  );
  const result = checkEdgeCases(parseSpec(spec));
  assertEquals(result.fraction > 0, true);
  assertMatch(result.strengths.join(" "), /timeout/i);
});

Deno.test('checkEdgeCases: seção com nota explícita de "nenhum edge case relevante" conta como tratada, não como gap', () => {
  const spec = specWithRequirement(
    `### RF-01 - Login

**Priority:** Must

**Description:**

Login.

**Acceptance Criteria:**

- [ ] Login funciona.
`,
    "Nenhum edge case relevante identificado para este tema.",
  );
  const result = checkEdgeCases(parseSpec(spec));
  assertEquals(result.fraction, 1);
  assertEquals(result.gaps.length, 0);
});
