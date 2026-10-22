// Testes dos dimension checkers estruturais de #220 (scaffold — presença/estrutura de seção via
// spec-parser.ts). Os heurísticos de linguagem (vague terms, ⚠️ ABERTO vs. omissão, Must sem
// Acceptance Criteria, Edge Cases contextuais) são adicionados em spec-quality-checkers_221_test.ts
// (#221) — este arquivo cobre só o que #220 exige: estrutura, mesmo sem os checkers de #221 ainda
// implementados.

import { assertEquals } from "@std/assert";
import { parseSpec } from "../lib/spec-parser.ts";
import {
  checkClarity,
  checkCompleteness,
  checkEdgeCases,
  checkScope,
  checkTestability,
} from "../lib/spec-quality-checkers.ts";

const COMPLETE_SPEC = `# Tema

## Context

Contexto.

## Goals

Goal.

## Non-Goals

Non-goal.

## Functional Requirements

### RF-01 - X

**Priority:** Must

**Description:**

Descrição.

**Acceptance Criteria:**

- [ ] Critério verificável.

## Edge Cases

Timeout tratado com retry.

## Open Questions

Nenhuma questão em aberto.
`;

const EMPTY_SPEC = `# Tema

## Context

## Goals

## Non-Goals

## Functional Requirements

## Edge Cases

## Open Questions

`;

Deno.test("checkCompleteness: spec completa tem fraction 1 e sem gaps de seção ausente", () => {
  const result = checkCompleteness(parseSpec(COMPLETE_SPEC));
  assertEquals(result.gaps.length, 0);
  assertEquals(result.fraction, 1);
});

Deno.test("checkCompleteness: spec vazia (templates/spec.md) gera gaps para cada seção vazia", () => {
  const result = checkCompleteness(parseSpec(EMPTY_SPEC));
  assertEquals(result.fraction, 0);
  assertEquals(result.gaps.length > 0, true);
});

Deno.test("checkTestability: existe ao menos um Acceptance Criteria declarado -> fraction 1", () => {
  const result = checkTestability(parseSpec(COMPLETE_SPEC));
  assertEquals(result.fraction, 1);
  assertEquals(result.gaps.length, 0);
});

Deno.test("checkTestability: nenhum Acceptance Criteria em nenhum requisito -> gap", () => {
  const result = checkTestability(parseSpec(EMPTY_SPEC));
  assertEquals(result.fraction, 0);
  assertEquals(result.gaps.length > 0, true);
});

Deno.test("checkScope: Goals e Non-Goals presentes -> fraction 1", () => {
  const result = checkScope(parseSpec(COMPLETE_SPEC));
  assertEquals(result.fraction, 1);
  assertEquals(result.gaps.length, 0);
});

Deno.test("checkScope: Non-Goals vazia gera gap mencionando Non-Goals", () => {
  const result = checkScope(parseSpec(EMPTY_SPEC));
  assertEquals(result.fraction < 1, true);
  assertEquals(result.gaps.some((g) => g.location === "Non-Goals"), true);
});

Deno.test("checkEdgeCases: seção presente e não vazia -> fraction 1", () => {
  const result = checkEdgeCases(parseSpec(COMPLETE_SPEC));
  assertEquals(result.fraction, 1);
});

Deno.test("checkEdgeCases: seção vazia -> gap", () => {
  const result = checkEdgeCases(parseSpec(EMPTY_SPEC));
  assertEquals(result.fraction, 0);
  assertEquals(result.gaps.length > 0, true);
});

Deno.test("checkClarity: sem placeholder de template não preenchido -> fraction 1", () => {
  const result = checkClarity(parseSpec(COMPLETE_SPEC));
  assertEquals(result.fraction, 1);
  assertEquals(result.gaps.length, 0);
});

Deno.test("checkClarity: placeholder de template ('<nome>') não preenchido -> gap", () => {
  const spec = COMPLETE_SPEC.replace("### RF-01 - X", "### RF-01 - <nome>");
  const result = checkClarity(parseSpec(spec));
  assertEquals(result.fraction < 1, true);
  assertEquals(result.gaps.length > 0, true);
});

Deno.test("checkClarity: requisito com sintaxe de comando (<type>/<slug>, <branch>) dentro de crases não gera gap (#448)", () => {
  const spec = COMPLETE_SPEC.replace(
    "### RF-01 - X",
    "### RF-01 - Suporte a `<type>/<slug>`",
  ).replace(
    "Descrição.",
    "Executar `git checkout -b <type>/<slug>` e `<path>`.\n\n```bash\nvetor ship <branch>\n```\n\n- [ ] Deriva `<type>/<slug>` ou `<type>/<issue#>-<slug>` conforme argumento.",
  );
  const result = checkClarity(parseSpec(spec));
  assertEquals(
    result.gaps.some((g) => g.location === "RF-01" && /placeholder/i.test(g.problem)),
    false,
  );
  assertEquals(result.fraction, 1);
});

Deno.test("checkClarity: placeholder copiado literalmente do template fora de crases continua gerando gap (#448)", () => {
  const spec = COMPLETE_SPEC.replace(
    "Descrição.",
    "Preencha com o conteúdo real: <descrição do requisito>.",
  );
  const result = checkClarity(parseSpec(spec));
  assertEquals(
    result.gaps.some((g) => g.location === "RF-01" && /placeholder/i.test(g.problem)),
    true,
  );
  assertEquals(result.fraction < 1, true);
});
