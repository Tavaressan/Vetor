// Dimension checkers do Quality Model de `/vetor:spec-validate`. Cada checker recebe um
// `ParsedSpec` (spec-parser.ts) e devolve um `DimensionResult` (spec-quality.ts): fração 0-1
// satisfeita, gaps e strengths.
//
// #220 entregou a versão estrutural (presença/não-vacuidade de seção). #221 adiciona os
// heurísticos de linguagem descritos em #203 §4-§8: Must sem Acceptance Criteria (Completeness),
// termos vagos sem métrica mensurável (Testability), "⚠️ ABERTO" explícito vs. omissão silenciosa
// (Clarity) e categorias contextuais de Edge Cases — sem exigir todas em toda Spec.

import type { ParsedRequirement, ParsedSpec } from "./spec-parser.ts";
import type { DimensionResult } from "./spec-quality.ts";

const OPEN_MARKER = "⚠️ ABERTO";

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
  let total = COMPLETENESS_SECTIONS.length + 1; // + 1 = existência de ao menos um RF

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

  // #221: todo requisito Must sem Acceptance Criteria é um gap de Completeness (#203 §4) — só
  // entra na conta quando existe ao menos um Must, senão a ausência é neutra (nada a penalizar).
  const mustRequirements = parsed.requirements.filter((r) => r.priority === "Must");
  if (mustRequirements.length > 0) {
    total++;
    const mustWithoutAC = mustRequirements.filter((r) => r.acceptanceCriteria.length === 0);
    if (mustWithoutAC.length === 0) {
      satisfied++;
      strengths.push("Todo requisito Must possui Acceptance Criteria.");
    } else {
      for (const r of mustWithoutAC) {
        gaps.push(`${r.id} é Must mas não possui Acceptance Criteria.`);
      }
    }
  }

  return { fraction: fractionOf(satisfied, total), gaps, strengths };
}

// #221 (#203 §5): termos vagos/não-verificáveis sugeridos pelo Handoff. A presença isolada não
// invalida o requisito — só vira gap quando não há, em lugar nenhum do texto do requisito,
// evidência mensurável (número + unidade, percentil, etc.) que dê contexto verificável ao termo.
const VAGUE_TERMS = [
  "rápido",
  "rápida",
  "rápidos",
  "rápidas",
  "fácil",
  "fáceis",
  "intuitivo",
  "intuitiva",
  "intuitivos",
  "intuitivas",
  "robusto",
  "robusta",
  "robustos",
  "robustas",
  "seguro",
  "segura",
  "seguros",
  "seguras",
  "eficiente",
  "eficientes",
  "adequado",
  "adequada",
  "adequados",
  "adequadas",
  "simples",
];

const MEASURABLE_EVIDENCE_RE = /\d+\s*(ms|s|seg|segundos?|min|%|kb|mb|gb|rps|req\/s)\b|\bp\d{2}\b/i;

/** Devolve o primeiro termo vago encontrado no requisito sem evidência mensurável em nenhuma
 * parte do seu texto (description + acceptance criteria), ou `null` quando não há termo vago ou
 * quando ele já vem acompanhado de um valor/comportamento verificável (ex.: "resposta rápida, em
 * até 500ms no P95" não é gap — a métrica está lá, ainda que o adjetivo vago também esteja). */
function findUnmeasuredVagueTerm(requirement: ParsedRequirement): string | null {
  const text = `${requirement.description}\n${requirement.acceptanceCriteria.join("\n")}`;
  if (MEASURABLE_EVIDENCE_RE.test(text)) return null;

  for (const term of VAGUE_TERMS) {
    if (new RegExp(`\\b${term}\\b`, "i").test(text)) return term;
  }
  return null;
}

export function checkTestability(parsed: ParsedSpec): DimensionResult {
  if (parsed.requirements.length === 0) {
    return {
      fraction: 0,
      gaps: ["Nenhum requisito declarado para avaliar testabilidade."],
      strengths: [],
    };
  }

  const gaps: string[] = [];
  const strengths: string[] = [];
  let total = 0;
  let satisfied = 0;

  for (const r of parsed.requirements) {
    // Metade do peso por ter Acceptance Criteria declarado, metade por não usar termo vago sem
    // métrica — a presença isolada do termo vago não invalida o requisito (#203 §5), só reduz o
    // score parcialmente.
    total += 1;
    let score = r.acceptanceCriteria.length > 0 ? 0.5 : 0;

    const vagueTerm = findUnmeasuredVagueTerm(r);
    if (vagueTerm) {
      gaps.push(
        `${r.id} usa termo vago sem métrica mensurável: "${vagueTerm}" ` +
          '(ex.: descreva um valor ou comportamento verificável, como "em até 500ms no P95").',
      );
    } else {
      score += 0.5;
    }

    if (r.acceptanceCriteria.length === 0) {
      gaps.push(`${r.id} não possui Acceptance Criteria.`);
    }

    satisfied += score;
  }

  if (gaps.length === 0) {
    strengths.push("Nenhum requisito usa termo vago sem métrica mensurável.");
  }

  return { fraction: fractionOf(satisfied, total), gaps, strengths };
}

/** Placeholders de template não preenchidos (ex.: "<nome>" copiado literalmente de
 * templates/spec.md) — sinal estrutural de conteúdo faltando, distinto do heurístico de linguagem
 * de #221 (que lida com texto preenchido mas vago/ambíguo). */
const TEMPLATE_PLACEHOLDER_RE = /<[a-zà-ú][a-zà-ú\s-]*>/i;

// #221 (#203 §6): decisão não resolvida mas sinalizada explicitamente ("unknown but explicit") é
// melhor que a mesma lacuna omitida em silêncio ("unknown and hidden") — só a segunda é gap de
// Clarity. Um requisito com `hasOpenMarker` (⚠️ ABERTO em algum lugar do seu texto) já tornou
// suas lacunas explícitas, então não é penalizado por este heurístico mesmo que também contenha um
// dos termos abaixo em outro trecho.
const HIDDEN_OMISSION_RE = /\bTODO\b|\bTBD\b|a definir\b/i;

export function checkClarity(parsed: ParsedSpec): DimensionResult {
  const gaps: string[] = [];
  const strengths: string[] = [];

  const requirementsWithPlaceholder = parsed.requirements.filter((r) =>
    TEMPLATE_PLACEHOLDER_RE.test(r.name) || TEMPLATE_PLACEHOLDER_RE.test(r.raw)
  );
  const requirementsWithHiddenOmission = parsed.requirements.filter((r) =>
    !r.hasOpenMarker && HIDDEN_OMISSION_RE.test(r.raw)
  );

  for (const r of requirementsWithPlaceholder) {
    gaps.push(`${r.id} contém placeholder de template não preenchido.`);
  }
  for (const r of requirementsWithHiddenOmission) {
    gaps.push(
      `${r.id} tem uma lacuna omitida em silêncio (TODO/TBD/"a definir" sem "${OPEN_MARKER}") — ` +
        `marque a lacuna explicitamente em vez de deixá-la implícita.`,
    );
  }

  const requirementsWithIssue = new Set([
    ...requirementsWithPlaceholder.map((r) => r.id),
    ...requirementsWithHiddenOmission.map((r) => r.id),
  ]);

  if (requirementsWithIssue.size === 0 && parsed.requirements.length > 0) {
    strengths.push(
      "Nenhuma lacuna omitida em silêncio — decisões não resolvidas estão marcadas explicitamente.",
    );
  }

  const total = Math.max(1, parsed.requirements.length);
  const satisfied = total - requirementsWithIssue.size;
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

// #221 (#203 §8): categorias plausíveis de Edge Case — avaliação é contextual, nunca exige todas
// em toda Spec (uma Spec sem chamada externa não precisa tratar "dependência indisponível"). A
// lista só existe para dar nome específico ao que já foi encontrado, não como checklist obrigatório.
const EDGE_CASE_CATEGORIES: Record<string, RegExp> = {
  "entrada inválida": /entrada inv[aá]lida|input inv[aá]lido/i,
  "ausência de dados": /aus[êe]ncia de dados|dados ausentes/i,
  "timeout": /timeout|tempo limite/i,
  "dependência indisponível":
    /depend[êe]ncia indispon[íi]vel|servi[çc]o (externo )?indispon[íi]vel/i,
  "duplicidade": /duplicidade|duplicad[ao]/i,
  "concorrência": /concorr[êe]ncia|race condition/i,
  "retry": /\bretry\b|nova tentativa/i,
  "autenticação/autorização": /autentica[çc][ãa]o|autoriza[çc][ãa]o/i,
  "falha de persistência": /falha de persist[êe]ncia|persist[êe]ncia falh/i,
};

const NO_EDGE_CASE_RE = /nenhum edge case relevante/i;

export function checkEdgeCases(parsed: ParsedSpec): DimensionResult {
  const body = parsed.sections.get("Edge Cases");
  if (isBlank(body)) {
    return {
      fraction: 0,
      gaps: ['Seção "Edge Cases" está ausente ou vazia.'],
      strengths: [],
    };
  }

  if (NO_EDGE_CASE_RE.test(body!)) {
    return {
      fraction: 1,
      gaps: [],
      strengths: ["Nenhum edge case relevante identificado, registrado explicitamente."],
    };
  }

  const matched = Object.entries(EDGE_CASE_CATEGORIES)
    .filter(([, re]) => re.test(body!))
    .map(([category]) => category);

  return {
    fraction: 1,
    gaps: [],
    strengths: matched.length > 0
      ? matched.map((category) => `Categoria "${category}" tratada.`)
      : ['Seção "Edge Cases" preenchida.'],
  };
}
