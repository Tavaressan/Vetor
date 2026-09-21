// Quality Model + Quality Gate de `/vetor:spec-validate` (#220, parte de #203 §2-§3).
//
// O score é 0-100, soma ponderada de 5 dimensões (DIMENSION_WEIGHTS). Cada dimensão é avaliada por
// um checker independente (spec-quality-checkers.ts, #221) que devolve uma fração 0-1 de quanto foi
// satisfeita — este módulo só agrega, nunca decide o que conta como "completo" para uma dimensão.

export type Dimension = "completeness" | "testability" | "clarity" | "scope" | "edgeCases";

/** Pesos do Quality Model (#203 §2) — somam sempre 100. */
export const DIMENSION_WEIGHTS: Record<Dimension, number> = {
  completeness: 30,
  testability: 25,
  clarity: 20,
  scope: 15,
  edgeCases: 10,
};

export type Gate = "READY" | "NEEDS_REFINEMENT" | "INCOMPLETE";

export interface Thresholds {
  /** Score mínimo (inclusive) para READY. */
  ready: number;
  /** Score mínimo (inclusive) para NEEDS_REFINEMENT; abaixo disso é INCOMPLETE. */
  needsRefinement: number;
}

/** Thresholds default do Quality Gate (#203 §3): 80-100 READY, 60-79 NEEDS_REFINEMENT, 0-59
 * INCOMPLETE. */
export const DEFAULT_THRESHOLDS: Thresholds = { ready: 80, needsRefinement: 60 };

/** Config mínima lida de `.claude/vetor/config.json` — mesmo padrão de
 * `VetorConfigWithKnowledge` (knowledge.ts): a skill nunca lê o arquivo inteiro tipado, só o campo
 * que lhe interessa. */
export interface VetorConfigWithSpecValidate {
  specValidate?: { thresholds?: Partial<Thresholds> };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** #269: `ready`/`needsRefinement` só entram no override quando são de fato `number` finito — um
 * valor malformado em `.claude/vetor/config.json` (string, null, array...) é ignorado em silêncio,
 * caindo no default, em vez de quebrar as comparações numéricas de `gateFor`. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Resolve os thresholds a partir da config do Vetor, com fallback para o default — os thresholds
 * são configuráveis (#203 §3: "número exato... deve ficar configurável caso a arquitetura
 * permita") via `.claude/vetor/config.json` → `specValidate.thresholds`. `config` é `unknown`
 * (lido cru de um JSON externo) — o shape nunca é assumido sem checagem em runtime. */
export function resolveThresholds(config: unknown): Thresholds {
  const specValidate = isPlainObject(config) ? config.specValidate : undefined;
  const thresholds = isPlainObject(specValidate) ? specValidate.thresholds : undefined;
  if (!isPlainObject(thresholds)) return { ...DEFAULT_THRESHOLDS };

  const overrides: Partial<Thresholds> = {};
  if (isFiniteNumber(thresholds.ready)) overrides.ready = thresholds.ready;
  if (isFiniteNumber(thresholds.needsRefinement)) overrides.needsRefinement = thresholds.needsRefinement;
  return { ...DEFAULT_THRESHOLDS, ...overrides };
}

export function gateFor(score: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): Gate {
  if (score >= thresholds.ready) return "READY";
  if (score >= thresholds.needsRefinement) return "NEEDS_REFINEMENT";
  return "INCOMPLETE";
}

/**
 * Um gap acionável (#222, #203 §9) — nunca uma mensagem genérica tipo "Spec precisa ser
 * melhorada". `location` é o anchor legível por humano no texto da Spec (ex.: "RF-03",
 * "Non-Goals"), não um seletor ou path — o mesmo texto que apareceria citado numa revisão manual.
 */
export interface Gap {
  location: string;
  problem: string;
  impact: string;
  suggestedAction: string;
}

/** Resultado de um dimension checker (spec-quality-checkers.ts) — `fraction` é o quanto da
 * dimensão foi satisfeita (0-1), independente do peso; a ponderação é feita só em
 * `computeQuality`. */
export interface DimensionResult {
  fraction: number;
  gaps: Gap[];
  strengths: string[];
}

export interface DimensionScore {
  /** Pontos obtidos nesta dimensão (0-max, arredondado). */
  score: number;
  /** Peso máximo da dimensão (DIMENSION_WEIGHTS). */
  max: number;
  gaps: Gap[];
  strengths: string[];
}

export interface QualityResult {
  score: number;
  gate: Gate;
  dimensions: Record<Dimension, DimensionScore>;
  strengths: string[];
  gaps: Gap[];
  /** `suggestedAction` de cada gap, deduplicado — dimensões diferentes podem coincidentemente
   * sugerir o mesmo texto de ação (ex.: duas seções vazias com a mesma orientação de preenchê-las
   * de novo), e repetir a mesma linha na saída não agrega informação nova ao usuário. */
  suggestions: string[];
}

/**
 * Agrega os resultados por dimensão no score final (0-100) e no Quality Gate correspondente.
 * `fraction` de cada dimensão é limitada a [0, 1] defensivamente — um checker malformado nunca
 * deve conseguir gerar score fora de [0, weight] nem negativo.
 */
export function computeQuality(
  results: Record<Dimension, DimensionResult>,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): QualityResult {
  const dimensions = {} as Record<Dimension, DimensionScore>;
  const strengths: string[] = [];
  const gaps: Gap[] = [];
  let total = 0;

  for (const dim of Object.keys(DIMENSION_WEIGHTS) as Dimension[]) {
    const weight = DIMENSION_WEIGHTS[dim];
    const result = results[dim];
    const fraction = Math.min(1, Math.max(0, result.fraction));
    const score = Math.round(fraction * weight);

    dimensions[dim] = { score, max: weight, gaps: result.gaps, strengths: result.strengths };
    strengths.push(...result.strengths);
    gaps.push(...result.gaps);
    total += score;
  }

  const score = Math.min(100, total);
  return {
    score,
    gate: gateFor(score, thresholds),
    dimensions,
    strengths,
    gaps,
    suggestions: [...new Set(gaps.map((g) => g.suggestedAction))],
  };
}
