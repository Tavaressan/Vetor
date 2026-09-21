import { assertEquals, assertNotEquals } from "@std/assert";
import { detectFieldConflict, detectPrimaryActionConflict } from "../lib/spec-design-conflict.ts";

Deno.test("detectPrimaryActionConflict: Design Contract X vs Specification Y != X -> conflito reportado, sem escolher um lado", () => {
  const report = detectPrimaryActionConflict(
    { value: "Criar worktree", source: "Design Contract — Hierarquia" },
    { value: "Exportar relatório", source: "Specification — RF-03" },
  );
  assertNotEquals(report, null);
  assertEquals(report?.kind, "conflict");
  assertEquals(report?.field, "Ação primária");
  assertEquals(report?.designContract.value, "Criar worktree");
  assertEquals(report?.specification.value, "Exportar relatório");
  // nunca escolhe um lado: nenhum campo "resolved"/"winner" existe no relato.
  assertEquals(Object.hasOwn(report as object, "resolved"), false);
  assertEquals(Object.hasOwn(report as object, "winner"), false);
  // mensagem reporta ambos os lados explicitamente, sem decidir por um.
  assertEquals(report?.message.includes("Criar worktree"), true);
  assertEquals(report?.message.includes("Exportar relatório"), true);
});

Deno.test("detectPrimaryActionConflict: mesma ação (normalizada) -> sem conflito", () => {
  const report = detectPrimaryActionConflict(
    { value: "Criar worktree", source: "Design Contract" },
    { value: "  criar worktree.  ", source: "Specification" },
  );
  assertEquals(report, null);
});

Deno.test("detectFieldConflict: genérico para qualquer campo de decisão, não só ação primária", () => {
  const report = detectFieldConflict(
    "Cor de destaque",
    { value: "Azul (#22409A)", source: "Design Contract — Tokens" },
    { value: "Verde (marca)", source: "Specification — RNF-02" },
  );
  assertNotEquals(report, null);
  assertEquals(report?.kind, "conflict");
  assertEquals(report?.field, "Cor de destaque");
});

Deno.test("detectFieldConflict: sem conflito quando valores são equivalentes ignorando espaços/caixa", () => {
  const report = detectFieldConflict(
    "Ação primária",
    { value: "Salvar alterações", source: "Design Contract" },
    { value: "SALVAR ALTERAÇÕES", source: "Specification" },
  );
  assertEquals(report, null);
});

// #269 (fix da issue #259 completo): o critério de aceite pedia um retorno *estruturalmente*
// distinto entre "ausência de valor" e "conflito real" — não só uma mensagem de texto diferente.
// `kind: "missingValue"` vs. `kind: "conflict"` é o discriminante; os testes abaixo verificam o
// campo `kind`, não só `report !== null` (que o código já satisfazia antes da correção completa).

Deno.test("detectFieldConflict: ambos valores vazios -> kind 'missingValue', não 'conflict'", () => {
  const report = detectFieldConflict(
    "Ação primária",
    { value: "", source: "Design Contract" },
    { value: "", source: "Specification" },
  );
  // Não deve ser null (falso all-clear) nem tratado como "conflict" entre dois valores concretos.
  assertNotEquals(report, null);
  assertEquals(report?.kind, "missingValue");
  assertEquals(report?.field, "Ação primária");
});

Deno.test("detectFieldConflict: ambos valores só-espaço -> kind 'missingValue', não 'conflict'", () => {
  const report = detectFieldConflict(
    "Ação primária",
    { value: "   ", source: "Design Contract" },
    { value: "  ", source: "Specification" },
  );
  assertNotEquals(report, null);
  assertEquals(report?.kind, "missingValue");
  assertEquals(report?.field, "Ação primária");
});

Deno.test("detectFieldConflict: um vazio, outro preenchido -> kind 'missingValue', não 'conflict'", () => {
  const report = detectFieldConflict(
    "Ação primária",
    { value: "", source: "Design Contract" },
    { value: "Criar worktree", source: "Specification" },
  );
  assertNotEquals(report, null);
  assertEquals(report?.kind, "missingValue");
  assertEquals(report?.field, "Ação primária");
});

Deno.test("detectPrimaryActionConflict: um vazio, outro preenchido -> kind 'missingValue', não 'conflict'", () => {
  const report = detectPrimaryActionConflict(
    { value: "   ", source: "Design Contract" },
    { value: "Exportar relatório", source: "Specification — RF-03" },
  );
  assertNotEquals(report, null);
  assertEquals(report?.kind, "missingValue");
  assertEquals(report?.field, "Ação primária");
});
