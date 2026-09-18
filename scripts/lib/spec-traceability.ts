// Infraestrutura de rastreabilidade (#223, #203 §13-§18) — metadados por requisito, Decision Log
// e os pontos de extensão para Coordinator/Guardian. Esta issue prepara o formato e as garantias
// (id estável através de transições de status), sem implementar a integração completa: não há
// transformação real de requirement → task nem análise semântica de código nesta issue (ver
// skills/spec-validate/references/traceability.md para o desenho completo do fluxo futuro).

export type RequirementPriority = "Must" | "Should" | "Could";

/** Estados sugeridos por #203 §14 — evoluem sem alterar o `id` do requisito. */
export type RequirementStatus = "planned" | "confirmed" | "implemented" | "verified";

export const REQUIREMENT_STATUSES: readonly RequirementStatus[] = [
  "planned",
  "confirmed",
  "implemented",
  "verified",
];

/** Metadados de um requisito para rastreabilidade Spec → Task → Code → Test (#203 §13-§14). `id`
 * é o mesmo `RF-NN`/`RNF-NN` já usado por spec-parser.ts — nunca muda através de nenhuma
 * transição de `status`. */
export interface RequirementMetadata {
  id: string;
  priority: RequirementPriority;
  status: RequirementStatus;
}

/**
 * Transiciona o `status` de um requisito preservando `id` e `priority` — a garantia central de
 * #223: `RF-01` continua `RF-01` depois de implementado (critério de aceite explícito da issue).
 * Não valida que a transição segue a ordem sugerida de `REQUIREMENT_STATUSES` (ex: pular de
 * "planned" direto para "verified") — a ordem é uma sugestão de fluxo, não uma máquina de estados
 * imposta; validar isso é decisão de quem consome este módulo (Coordinator/Guardian, ainda não
 * implementados).
 */
export function transitionRequirementStatus(
  metadata: RequirementMetadata,
  status: RequirementStatus,
): RequirementMetadata {
  return { ...metadata, status };
}

/** Uma entrada do Decision Log (#203 §18) — `id` no formato `DEC-NN`, mesma disciplina de IDs
 * estáveis dos requisitos. */
export interface DecisionLogEntry {
  id: string;
  date: string;
  decision: string;
  reason: string;
  impact: string;
}

/** Renderiza uma entrada do Decision Log no formato de templates/spec.md `## Decisions`. */
export function renderDecisionLogEntry(entry: DecisionLogEntry): string {
  return [
    `### ${entry.id}`,
    "",
    `Date: ${entry.date}`,
    "",
    "Decision:",
    entry.decision,
    "",
    "Reason:",
    entry.reason,
    "",
    "Impact:",
    entry.impact,
  ].join("\n");
}

/** Adiciona uma entrada ao final do Decision Log sem mutar o array recebido — mesma disciplina de
 * "nunca renumerar/reordenar" dos IDs de requisito (5.2 em skills/spec/SKILL.md): uma nova decisão
 * sempre vai para o fim, nunca substitui ou reordena entradas anteriores. */
export function applyDecisionLogEntry(
  log: readonly DecisionLogEntry[],
  entry: DecisionLogEntry,
): DecisionLogEntry[] {
  return [...log, entry];
}
