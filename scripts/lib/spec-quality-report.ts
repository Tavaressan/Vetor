// Quality Report em Markdown + refinamento iterativo de `/vetor:spec-validate` (#222, parte de
// #203 §9-§11).
//
// Cada gap emitido pelos checkers já é estruturado (`Gap` — spec-quality.ts): este módulo só
// renderiza esse feedback em Markdown (nunca uma mensagem genérica tipo "Spec precisa ser
// melhorada") e mantém o histórico de score entre ciclos de refinamento, com um teto de ciclos
// para nunca refinar indefinidamente.

import type { Gap, Gate, QualityResult } from "./spec-quality.ts";

export interface ValidationRecord {
  timestamp: string;
  score: number;
  gate: Gate;
}

/** Máximo de ciclos de refinamento automático (validate → gaps → refine → validate) recomendado
 * por #203 §10 — depois disso, a decisão de continuar refinando volta a ser manual/humana. */
export const MAX_REFINEMENT_CYCLES = 3;

/**
 * Adiciona um novo registro ao histórico de validação, respeitando o teto de
 * `MAX_REFINEMENT_CYCLES` refinamentos além da validação inicial (ou seja,
 * `MAX_REFINEMENT_CYCLES + 1` entradas no total). Ao exceder o teto, o histórico não muda —
 * `capReached: true` sinaliza para quem chamou que o próximo passo é revisão manual, não mais uma
 * tentativa automática (mesmo espírito do orçamento de iterações do fix-loop-agent).
 */
export function appendValidation(
  history: ValidationRecord[],
  record: ValidationRecord,
): { history: ValidationRecord[]; capReached: boolean } {
  if (history.length > MAX_REFINEMENT_CYCLES) {
    return { history, capReached: true };
  }
  return { history: [...history, record], capReached: false };
}

/** Formata a evolução do score entre ciclos, ex.: "54 → 71 → 84" (#203 §10). */
export function renderScoreEvolution(history: ValidationRecord[]): string {
  return history.map((h) => h.score).join(" → ");
}

function renderGap(gap: Gap): string {
  return [
    `- **${gap.location}**: ${gap.problem}`,
    `  - Impact: ${gap.impact}`,
    `  - Suggested action: ${gap.suggestedAction}`,
  ].join("\n");
}

function list(items: string[], emptyLabel: string): string {
  return items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : `- ${emptyLabel}`;
}

export interface RenderQualityReportOptions {
  /** Histórico de validações anteriores desta mesma Spec (mesmo arquivo de persistência) — quando
   * presente e com mais de uma entrada, o report inclui a evolução do score entre ciclos. */
  history?: ValidationRecord[];
}

/**
 * Renderiza o Quality Report em Markdown (#203 §11): Score/Status/Dimensions/Strengths/Gaps/
 * Suggestions, com cada gap sempre citando `location`/`problem`/`impact`/`suggestedAction` — nunca
 * a saída genérica "Spec precisa ser melhorada" que o Handoff #203 §9 proíbe explicitamente.
 */
export function renderQualityReport(
  specPath: string,
  result: QualityResult,
  options: RenderQualityReportOptions = {},
): string {
  const dimensionRows =
    (Object.entries(result.dimensions) as [string, { score: number; max: number }][])
      .map(([dim, d]) => `| ${dim} | ${d.score}/${d.max} |`)
      .join("\n");

  const sections = [
    "# Spec Quality Report",
    "",
    `Spec: ${specPath}`,
    "",
    `Score: ${result.score}/100`,
    `Status: ${result.gate}`,
    "",
    "## Dimensions",
    "",
    "| Dimension | Score |",
    "|---|---:|",
    dimensionRows,
    "",
    "## Strengths",
    "",
    list(result.strengths, "Nenhum ponto forte identificado."),
    "",
    "## Gaps",
    "",
    result.gaps.length > 0 ? result.gaps.map(renderGap).join("\n") : "- Nenhum gap identificado.",
    "",
    "## Suggestions",
    "",
    list(result.suggestions, "Nenhuma sugestão identificada."),
  ];

  if (options.history && options.history.length > 1) {
    sections.push(
      "",
      "## Refinement History",
      "",
      renderScoreEvolution(options.history),
    );
  }

  sections.push("");
  return sections.join("\n");
}
