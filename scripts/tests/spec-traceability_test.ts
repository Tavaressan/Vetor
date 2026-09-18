// Testes de scripts/lib/spec-traceability.ts — metadados de requisito e Decision Log (#223,
// #203 §13-§18). Infraestrutura de preparação: só o formato de metadata e a estabilidade do `id`
// através de transições de status são exercitados aqui; a integração real com Coordinator/Guardian
// (RF→Task, Spec Drift) fica documentada em skills/spec-validate/references/traceability.md, sem
// código de integração nesta issue (fora de escopo por design, ver corpo da issue #223).

import { assertEquals, assertMatch } from "@std/assert";
import {
  applyDecisionLogEntry,
  renderDecisionLogEntry,
  REQUIREMENT_STATUSES,
  type RequirementMetadata,
  transitionRequirementStatus,
} from "../lib/spec-traceability.ts";

function metadata(overrides: Partial<RequirementMetadata> = {}): RequirementMetadata {
  return { id: "RF-01", priority: "Must", status: "planned", ...overrides };
}

Deno.test("REQUIREMENT_STATUSES cobre os 4 estados sugeridos por #203 §14", () => {
  assertEquals(REQUIREMENT_STATUSES, ["planned", "confirmed", "implemented", "verified"]);
});

Deno.test('transitionRequirementStatus de "planned" para "implemented" preserva o id (RF-01 continua RF-01) — critério de aceite de #223', () => {
  const before = metadata({ status: "planned" });
  const after = transitionRequirementStatus(before, "implemented");
  assertEquals(after.id, before.id);
  assertEquals(after.priority, before.priority);
  assertEquals(after.status, "implemented");
});

Deno.test("transitionRequirementStatus preserva o id através de toda a sequência de estados", () => {
  let current = metadata({ id: "RNF-07", status: "planned" });
  for (const status of REQUIREMENT_STATUSES.slice(1)) {
    current = transitionRequirementStatus(current, status);
    assertEquals(current.id, "RNF-07");
  }
  assertEquals(current.status, "verified");
});

Deno.test("transitionRequirementStatus não muta o objeto original", () => {
  const before = metadata({ status: "planned" });
  const after = transitionRequirementStatus(before, "confirmed");
  assertEquals(before.status, "planned");
  assertEquals(after.status, "confirmed");
});

Deno.test("renderDecisionLogEntry produz o formato DEC-NN com Date/Decision/Reason/Impact (#203 §18)", () => {
  const md = renderDecisionLogEntry({
    id: "DEC-01",
    date: "2026-09-17",
    decision: "Usar RF-/RNF- como IDs estáveis de requisito.",
    reason: "Sustentar rastreabilidade Spec → Task → Code → Test sem renumeração.",
    impact: "Requisitos removidos deixam lacuna na numeração, isso é esperado.",
  });
  assertMatch(md, /### DEC-01/);
  assertMatch(md, /Date: 2026-09-17/);
  assertMatch(md, /Decision:\nUsar RF-\/RNF- como IDs estáveis de requisito\./);
  assertMatch(md, /Reason:\nSustentar rastreabilidade/);
  assertMatch(md, /Impact:\nRequisitos removidos/);
});

Deno.test("applyDecisionLogEntry adiciona a entrada ao final do log preservando as anteriores", () => {
  const log = [
    { id: "DEC-01", date: "2026-09-01", decision: "d1", reason: "r1", impact: "i1" },
  ];
  const updated = applyDecisionLogEntry(log, {
    id: "DEC-02",
    date: "2026-09-17",
    decision: "d2",
    reason: "r2",
    impact: "i2",
  });
  assertEquals(updated.length, 2);
  assertEquals(updated[0].id, "DEC-01");
  assertEquals(updated[1].id, "DEC-02");
  // não muta o array original
  assertEquals(log.length, 1);
});
