// Conflito Specification × Design Contract (#231, #213 "Integração com Specification").
//
// Specification descreve "o que o produto deve fazer"; Design Contract descreve "como a
// experiência deve se expressar" (design-vocabulary.md §4). Quando os dois divergem sobre a mesma
// decisão (ex.: ação primária de uma tela), o agente nunca resolve essa divergência sozinho — ela é
// uma decisão de produto, não um erro objetivo. Este módulo só formaliza a detecção e o relato
// (mesmo espírito de design-loop-mcp.ts: nunca finge que não houve divergência, nunca escolhe um
// lado). A extração dos valores a partir do texto da Specification/Design Contract é trabalho do
// agente (skills/design/SKILL.md) — este módulo compara os dois valores já extraídos.

/** Um valor de decisão com a origem de onde foi lido — Design Contract ou Specification. */
export interface DecisionClaim {
  /** Valor da decisão como lido na fonte (ex.: "Criar worktree"). */
  value: string;
  /** Origem legível (ex.: "Design Contract — Hierarquia", "Specification — RF-03"). */
  source: string;
}

/** Relato de conflito entre Specification e Design Contract para um campo de decisão. Nunca inclui
 * um veredito de qual lado está correto — só os dois valores e suas origens. */
export interface SpecDesignConflictReport {
  /** Nome do campo/decisão em conflito (ex.: "Ação primária"). */
  field: string;
  designContract: DecisionClaim;
  specification: DecisionClaim;
  /** Mensagem legível por humano relatando ambos os lados, sem resolver a divergência. */
  message: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[.\s]+$/g, "").replace(/\s+/g, " ");
}

/**
 * Compara o valor de uma decisão entre Design Contract e Specification para o `field` informado.
 * Retorna `null` quando os valores são equivalentes (ignorando espaços/pontuação final/caixa) —
 * nenhum conflito a relatar. Quando divergem, retorna o relato explícito dos dois lados; nunca
 * escolhe um dos dois automaticamente (ver design-vocabulary.md, "Integração com Specification").
 */
export function detectFieldConflict(
  field: string,
  designContract: DecisionClaim,
  specification: DecisionClaim,
): SpecDesignConflictReport | null {
  if (normalize(designContract.value) === normalize(specification.value)) return null;

  return {
    field,
    designContract,
    specification,
    message: `Conflito entre Specification e Design Contract em "${field}": ` +
      `Design Contract (${designContract.source}) define "${designContract.value}", mas ` +
      `Specification (${specification.source}) implica "${specification.value}". ` +
      "Esta é uma decisão de produto — o agente reporta o conflito e não escolhe um lado " +
      "automaticamente; escale via BLOCKED_WAITING para decisão humana.",
  };
}

/** Especialização de `detectFieldConflict` para o caso citado no critério de aceite de #231: ação
 * primária divergente entre Design Contract e Specification. */
export function detectPrimaryActionConflict(
  designContract: DecisionClaim,
  specification: DecisionClaim,
): SpecDesignConflictReport | null {
  return detectFieldConflict("Ação primária", designContract, specification);
}
