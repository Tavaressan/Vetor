// Handoff de protótipo → Design Contract (#229) — transforma a extração estruturada de um
// protótipo (telas, hierarquia, componentes, conteúdo, interações, estados) no formato de Design
// Contract definido em skills/shared/references/design-vocabulary.md §4.
//
// Este módulo não lê nenhuma ferramenta de design nem faz visão computacional — a extração em si
// (observar o protótipo e preencher `PrototypeExtraction`) é trabalho do agente, guiado por
// skills/design/SKILL.md. Este módulo só garante que a extração vira um Design Contract correto:
// nunca uma cópia de pixels, sempre com `prototype intent + dados reais + estados reais +
// restrições reais` (#213), e nunca com um dos 9 estados canônicos silenciosamente omitido.

import type { DesignFile } from "./design-mode.ts";

/** Diretório de saída do Design Contract gerado pelo handoff (ver design-vocabulary.md §4.5). */
export const DESIGN_HANDOFF_DIR = ".vetor/design/handoff";

/**
 * Os 9 estados canônicos de design-vocabulary.md §4.3 — além do happy path do protótipo. A ordem
 * aqui é só a ordem de apresentação; não implica sequência ou máquina de estados.
 */
export const CANONICAL_STATES = [
  "loading",
  "empty",
  "populated",
  "error",
  "partial failure",
  "permission denied",
  "offline",
  "disabled",
  "success",
] as const;

export type CanonicalStateName = typeof CANONICAL_STATES[number];

export interface InterfaceStateSpec {
  name: CanonicalStateName;
  trigger: string;
  expectedBehavior: string;
  primaryAction?: string;
  visualTreatment?: string;
  /** Ex.: "Prototype", "Specification", "Prototype + Specification". */
  evidence: string;
}

/** Estado canônico explicitamente avaliado como não aplicável a esta tela/fluxo — nunca omitido
 * em silêncio: a razão fica registrada. */
export interface NotApplicableState {
  name: CanonicalStateName;
  reason: string;
}

// Evidence State (evidence-state.md, via design-vocabulary.md §4.4): CONFIRMED/INFERRED citam
// `source`; ASSUMED cita `reason` (sem `source` — não há fonte a apontar para uma premissa).
// OPEN_QUESTION não é uma Decision — vai para `openQuestions` (campo próprio do contrato).
export interface ConfirmedOrInferredDecision {
  state: "CONFIRMED" | "INFERRED";
  claim: string;
  source: string;
}

export interface AssumedDecision {
  state: "ASSUMED";
  claim: string;
  reason: string;
}

export type Decision = ConfirmedOrInferredDecision | AssumedDecision;

export interface OpenQuestion {
  claim: string;
  impact: string;
}

/** Extração estruturada de um protótipo — entrada do handoff, preenchida pelo agente a partir dos
 * campos de design-vocabulary.md §4.2. Todo campo textual é usado "conforme aplicável": um campo
 * vazio é omitido do documento renderizado, nunca preenchido com um placeholder. */
export interface PrototypeExtraction {
  /** Título da tela ou fluxo — vira o H1 do documento. */
  title: string;
  objective: string;
  screens: string;
  hierarchy: string;
  layout?: string;
  components: string;
  tokens?: string;
  /** Conteúdo real (textos, labels, mensagens) — nunca lorem ipsum (design-vocabulary.md §4.1). */
  content: string;
  interactions: string;
  states: InterfaceStateSpec[];
  notApplicableStates?: NotApplicableState[];
  responsiveness?: string;
  accessibility?: string;
  constraints?: string;
  references: string[];
  decisions: Decision[];
  openQuestions: OpenQuestion[];
}

/** Estados canônicos que não foram nem especificados nem explicitamente marcados como não
 * aplicáveis — usado pelo CLI para nunca deixar uma lacuna silenciosa (mesmo princípio de
 * `renderPatternsMd` em design-mode.ts: fato ausente vira OPEN_QUESTION, nunca um default). */
export function findUnaddressedStates(extraction: PrototypeExtraction): CanonicalStateName[] {
  const covered = new Set<CanonicalStateName>([
    ...extraction.states.map((s) => s.name),
    ...(extraction.notApplicableStates ?? []).map((s) => s.name),
  ]);
  return CANONICAL_STATES.filter((name) => !covered.has(name));
}

function renderDecisionsSection(decisions: Decision[]): string {
  if (decisions.length === 0) {
    return "Nenhuma decisão confirmada, inferida ou assumida registrada nesta extração.";
  }
  return decisions.map((d) => {
    if (d.state === "ASSUMED") {
      return `${d.state}\n${d.claim}\nReason: ${d.reason}`;
    }
    return `${d.state}\n${d.claim}\nSource: ${d.source}`;
  }).join("\n\n");
}

function renderOpenQuestionsSection(openQuestions: OpenQuestion[]): string {
  if (openQuestions.length === 0) {
    return "Nenhuma questão aberta registrada nesta extração.";
  }
  return openQuestions.map((q) => `OPEN_QUESTION\n${q.claim}\nImpact: ${q.impact}`).join("\n\n");
}

function renderStateBlock(spec: InterfaceStateSpec): string {
  const lines = [
    `### State: ${spec.name}`,
    "",
    "Trigger:",
    spec.trigger,
    "",
    "Expected behavior:",
    spec.expectedBehavior,
  ];
  if (spec.primaryAction) {
    lines.push("", "Primary action:", spec.primaryAction);
  }
  if (spec.visualTreatment) {
    lines.push("", "Visual treatment:", spec.visualTreatment);
  }
  lines.push("", "Evidence:", spec.evidence);
  return lines.join("\n");
}

function renderNotApplicableBlock(spec: NotApplicableState): string {
  return `### State: ${spec.name}\n\nNot applicable:\n${spec.reason}`;
}

function renderUnaddressedBlock(name: CanonicalStateName): string {
  return `### State: ${name}\n\nOPEN_QUESTION\nEstado não avaliado nesta extração do protótipo — nem especificado, nem marcado\ncomo não aplicável.\n\nImpact:\nA implementação não deve assumir o comportamento deste estado sem confirmação —\nesta lacuna precisa ser resolvida antes ou durante a implementação.`;
}

function renderStatesSection(extraction: PrototypeExtraction): string {
  const specified = extraction.states.map(renderStateBlock);
  const notApplicable = (extraction.notApplicableStates ?? []).map(renderNotApplicableBlock);
  const unaddressed = findUnaddressedStates(extraction).map(renderUnaddressedBlock);
  return [...specified, ...notApplicable, ...unaddressed].join("\n\n");
}

function section(heading: string, body: string | undefined): string {
  if (!body || body.trim().length === 0) return "";
  return `## ${heading}\n\n${body.trim()}\n`;
}

/**
 * Renderiza o Design Contract em markdown a partir da extração estruturada do protótipo, seguindo
 * o esqueleto de design-vocabulary.md §4.5. Nunca produz uma cópia do protótipo — os campos
 * capturam decisões (hierarquia, tokens, estados, restrições), não posição de pixel.
 */
export function renderDesignContract(extraction: PrototypeExtraction): string {
  const sections = [
    `# Design Contract — ${extraction.title}\n`,
    section("Objetivo da experiência", extraction.objective),
    section("Telas", extraction.screens),
    section("Hierarquia", extraction.hierarchy),
    section("Layout", extraction.layout),
    section("Componentes", extraction.components),
    section("Tokens", extraction.tokens),
    section("Conteúdo", extraction.content),
    section("Interações", extraction.interactions),
    `## Estados\n\n${renderStatesSection(extraction)}\n`,
    section("Responsividade", extraction.responsiveness),
    section("Acessibilidade", extraction.accessibility),
    section("Restrições", extraction.constraints),
    section("Referências", extraction.references.map((r) => `- ${r}`).join("\n")),
    `## Decisões\n\n${renderDecisionsSection(extraction.decisions)}\n`,
    `## Questões abertas\n\n${renderOpenQuestionsSection(extraction.openQuestions)}\n`,
  ];
  return sections.filter((s) => s.length > 0).join("\n").trim() + "\n";
}

function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "handoff";
}

/** Monta o arquivo do Design Contract em `.vetor/design/handoff/<slug>.md` (nome derivado do
 * título) — mesmo contrato de never-overwrite de `writeDesignFiles` (design-mode.ts). */
export function renderPrototypeHandoffFile(extraction: PrototypeExtraction): DesignFile {
  return {
    path: `${DESIGN_HANDOFF_DIR}/${slugify(extraction.title)}.md`,
    content: renderDesignContract(extraction),
  };
}
