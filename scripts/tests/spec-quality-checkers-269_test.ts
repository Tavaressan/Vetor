// Achados de code-review pós-merge das PRs #265/#266/#268 (issue #269), item 1 (blocker) e achados
// menores relacionados em scripts/lib/spec-quality-checkers.ts.

import { assertEquals } from "@std/assert";
import { parseSpec } from "../lib/spec-parser.ts";
import { checkClarity, checkCompleteness, checkTestability } from "../lib/spec-quality-checkers.ts";
import { computeQuality } from "../lib/spec-quality.ts";

// Blocker: checkClarity usava `total = Math.max(1, parsed.requirements.length)`, produzindo
// `fraction: 1` (20/100 pontos de graça) para uma Spec sem nenhum requisito — inconsistente com
// checkTestability, que corretamente devolve `fraction: 0` no mesmo cenário.
Deno.test("checkClarity: Spec sem nenhum requisito não ganha pontuação de graça (fraction 0, não 1)", () => {
  const spec = "# Tema\n\n## Context\n";
  const result = checkClarity(parseSpec(spec));
  assertEquals(result.fraction, 0);
  assertEquals(result.gaps.length > 0, true);
});

// checkTestability: requisito totalmente vazio (sem description/AC) ganhava crédito parcial por
// "não ter termo vago", pontuando mais que um requisito com conteúdo mas termo vago sem AC.
Deno.test("checkTestability: requisito vazio não pontua mais que requisito com conteúdo mas termo vago", () => {
  const specEmptyRequirement = `# Tema

## Functional Requirements

### RF-01 - Vazio
`;
  const specVagueNoAC = `# Tema

## Functional Requirements

### RF-01 - Vago

**Description:**

O sistema deve ser robusto.
`;

  const emptyResult = checkTestability(parseSpec(specEmptyRequirement));
  const vagueResult = checkTestability(parseSpec(specVagueNoAC));

  // Ambos não têm Acceptance Criteria; o vazio não deve superar o com conteúdo vago.
  assertEquals(emptyResult.fraction <= vagueResult.fraction, true);
  assertEquals(emptyResult.fraction, 0);
});

// checkCompleteness (:108) e checkTestability (:208) geravam sugestões quase-idênticas para o
// mesmo gap ("Must sem Acceptance Criteria") com verbos diferentes ("Defina" vs. "Adicione") — o
// dedup de `suggestions` em spec-quality.ts é por string exata, então as duas apareciam na saída.
Deno.test("suggestions dedup: Must sem Acceptance Criteria não duplica a mesma sugestão entre Completeness e Testability", () => {
  const spec = `# Tema

## Context

Contexto.

## Goals

Goal.

## Non-Goals

Non-goal.

## Functional Requirements

### RF-01 - Login

**Priority:** Must

**Description:**

Usuário autentica.

## Edge Cases

Nenhum edge case relevante identificado para este tema.

## Open Questions

Nenhuma questão em aberto.
`;
  const parsed = parseSpec(spec);
  const result = computeQuality({
    completeness: checkCompleteness(parsed),
    testability: checkTestability(parsed),
    clarity: checkClarity(parsed),
    scope: { fraction: 1, gaps: [], strengths: [] },
    edgeCases: { fraction: 1, gaps: [], strengths: [] },
  });

  const acSuggestions = result.suggestions.filter((s) => /Acceptance Criteria/.test(s));
  assertEquals(acSuggestions.length, 1);
});
