// Testes de scripts/lib/spec-parser.ts — parsing heurístico (heading-regex) de uma Spec em
// markdown (templates/spec.md), consumido pelos dimension checkers de spec-quality-checkers.ts.

import { assertEquals } from "@std/assert";
import { type ParsedRequirement, parseSpec } from "../lib/spec-parser.ts";

const SAMPLE = `# Autenticação

## Summary

Sistema de login.

## Context

Contexto relevante.

## Goals

Permitir login seguro.

## Non-Goals

Não cobre SSO.

## Functional Requirements

### RF-01 - Login

**Priority:** Must

**Description:**

Usuário autentica com email e senha.

**Acceptance Criteria:**

- [ ] Login válido retorna sessão.
- [ ] Login inválido retorna erro 401.

### RF-02 - Logout

**Priority:** Should

**Description:**

Usuário encerra sessão.

## Non-Functional Requirements

### RNF-01 - Desempenho

**Priority:** Must

**Description:**

Resposta rápida.

**Acceptance Criteria:**

- [ ] ⚠️ ABERTO: definir limite máximo de tempo de resposta.

## Edge Cases

## Open Questions

`;

Deno.test("parseSpec extrai seções H2 com corpo", () => {
  const parsed = parseSpec(SAMPLE);
  assertEquals(parsed.sections.get("Context")?.trim(), "Contexto relevante.");
  assertEquals(parsed.sections.get("Non-Goals")?.trim(), "Não cobre SSO.");
});

Deno.test("parseSpec detecta seção vazia como string vazia (não undefined)", () => {
  const parsed = parseSpec(SAMPLE);
  assertEquals(parsed.sections.get("Edge Cases")?.trim(), "");
  assertEquals(parsed.sections.get("Open Questions")?.trim(), "");
});

Deno.test("parseSpec extrai requisitos RF-/RNF- com priority e acceptance criteria", () => {
  const parsed = parseSpec(SAMPLE);
  assertEquals(parsed.requirements.length, 3);

  const rf01 = parsed.requirements.find((r: ParsedRequirement) => r.id === "RF-01");
  assertEquals(rf01?.kind, "RF");
  assertEquals(rf01?.priority, "Must");
  assertEquals(rf01?.acceptanceCriteria.length, 2);
  assertEquals(rf01?.hasOpenMarker, false);

  const rf02 = parsed.requirements.find((r: ParsedRequirement) => r.id === "RF-02");
  assertEquals(rf02?.priority, "Should");
  assertEquals(rf02?.acceptanceCriteria.length, 0);

  const rnf01 = parsed.requirements.find((r: ParsedRequirement) => r.id === "RNF-01");
  assertEquals(rnf01?.kind, "RNF");
  assertEquals(rnf01?.hasOpenMarker, true);
});

Deno.test("parseSpec retorna seções e requisitos vazios para texto vazio", () => {
  const parsed = parseSpec("");
  assertEquals(parsed.requirements.length, 0);
  assertEquals(parsed.sections.size, 0);
});
