// Dimension checkers do Quality Model de `/vetor:spec-validate` (#220 scaffold — versão
// estrutural/presença). Cada checker recebe um `ParsedSpec` (spec-parser.ts) e devolve um
// `DimensionResult` (spec-quality.ts): fração 0-1 satisfeita, gaps e strengths.
//
// Os heurísticos de linguagem descritos em #221 (vague terms sem métrica, diferenciação
// "⚠️ ABERTO" explícito vs. omissão silenciosa, Must sem Acceptance Criteria como gap de
// Completeness, Edge Cases contextuais) estendem estes mesmos checkers — ver
// spec-quality-checkers_221.ts.

import type { ParsedSpec } from "./spec-parser.ts";
import type { DimensionResult } from "./spec-quality.ts";

function fractionOf(satisfied: number, total: number): number {
  return total === 0 ? 1 : satisfied / total;
}

function isBlank(body: string | undefined): boolean {
  return !body || body.trim().length === 0;
}

/** Seções cuja presença/não-vacuidade é exigida por Completeness (#203 §4). `Non-Goals` também é
 * checado por `checkScope` (§7) — a mesma seção pode ser sinal de mais de uma dimensão. */
const COMPLETENESS_SECTIONS = ["Context", "Goals", "Non-Goals", "Edge Cases", "Open Questions"];

export function checkCompleteness(parsed: ParsedSpec): DimensionResult {
  const gaps: string[] = [];
  const strengths: string[] = [];
  let satisfied = 0;

  for (const heading of COMPLETENESS_SECTIONS) {
    if (isBlank(parsed.sections.get(heading))) {
      gaps.push(`Seção "${heading}" está ausente ou vazia.`);
    } else {
      satisfied++;
      strengths.push(`Seção "${heading}" preenchida.`);
    }
  }

  if (parsed.requirements.length > 0) {
    satisfied++;
    strengths.push("Ao menos um Functional Requirement (RF-) está declarado.");
  } else {
    gaps.push("Nenhum Functional Requirement (RF-) encontrado.");
  }

  const total = COMPLETENESS_SECTIONS.length + 1;
  return { fraction: fractionOf(satisfied, total), gaps, strengths };
}

/** Versão estrutural (#220): existe ao menos um Acceptance Criteria declarado em algum requisito.
 * A vinculação por requisito (cada Must precisa do seu próprio AC) é refinada em #221. */
export function checkTestability(parsed: ParsedSpec): DimensionResult {
  const withAC = parsed.requirements.filter((r) => r.acceptanceCriteria.length > 0);

  if (parsed.requirements.length === 0) {
    return {
      fraction: 0,
      gaps: ["Nenhum requisito declarado para avaliar testabilidade."],
      strengths: [],
    };
  }

  if (withAC.length === 0) {
    return {
      fraction: 0,
      gaps: ["Nenhum requisito possui Acceptance Criteria declarado."],
      strengths: [],
    };
  }

  return {
    fraction: fractionOf(withAC.length, parsed.requirements.length),
    gaps: parsed.requirements
      .filter((r) => r.acceptanceCriteria.length === 0)
      .map((r) => `${r.id} não possui Acceptance Criteria.`),
    strengths: [
      `${withAC.length}/${parsed.requirements.length} requisito(s) com Acceptance Criteria.`,
    ],
  };
}

/** Placeholders de template não preenchidos (ex.: "<nome>" copiado literalmente de
 * templates/spec.md) — sinal estrutural de conteúdo faltando, distinto do heurístico de linguagem
 * de #221 (que lida com texto preenchido mas vago/ambíguo). */
const TEMPLATE_PLACEHOLDER_RE = /<[a-zà-ú][a-zà-ú\s-]*>/i;

export function checkClarity(parsed: ParsedSpec): DimensionResult {
  const gaps: string[] = [];
  const strengths: string[] = [];

  const requirementsWithPlaceholder = parsed.requirements.filter((r) =>
    TEMPLATE_PLACEHOLDER_RE.test(r.name) || TEMPLATE_PLACEHOLDER_RE.test(r.raw)
  );

  if (requirementsWithPlaceholder.length > 0) {
    for (const r of requirementsWithPlaceholder) {
      gaps.push(`${r.id} contém placeholder de template não preenchido.`);
    }
  } else if (parsed.requirements.length > 0) {
    strengths.push("Nenhum placeholder de template não preenchido encontrado nos requisitos.");
  }

  const total = Math.max(1, parsed.requirements.length);
  const satisfied = total - requirementsWithPlaceholder.length;
  return { fraction: fractionOf(satisfied, total), gaps, strengths };
}

const SCOPE_SECTIONS = ["Goals", "Non-Goals"];

export function checkScope(parsed: ParsedSpec): DimensionResult {
  const gaps: string[] = [];
  const strengths: string[] = [];
  let satisfied = 0;

  for (const heading of SCOPE_SECTIONS) {
    if (isBlank(parsed.sections.get(heading))) {
      gaps.push(`Seção "${heading}" está ausente ou vazia — limite do escopo não fica claro.`);
    } else {
      satisfied++;
      strengths.push(`Seção "${heading}" define o limite do escopo.`);
    }
  }

  return { fraction: fractionOf(satisfied, SCOPE_SECTIONS.length), gaps, strengths };
}

export function checkEdgeCases(parsed: ParsedSpec): DimensionResult {
  const body = parsed.sections.get("Edge Cases");
  if (isBlank(body)) {
    return {
      fraction: 0,
      gaps: ['Seção "Edge Cases" está ausente ou vazia.'],
      strengths: [],
    };
  }
  return {
    fraction: 1,
    gaps: [],
    strengths: ['Seção "Edge Cases" preenchida.'],
  };
}
