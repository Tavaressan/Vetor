// Dimension checkers do Quality Model de `/vetor:spec-validate`. Cada checker recebe um
// `ParsedSpec` (spec-parser.ts) e devolve um `DimensionResult` (spec-quality.ts): fração 0-1
// satisfeita, gaps estruturados (`Gap`) e strengths.
//
// #220 entregou a versão estrutural (presença/não-vacuidade de seção). #221 adicionou os
// heurísticos de linguagem descritos em #203 §4-§8: Must sem Acceptance Criteria (Completeness),
// termos vagos sem métrica mensurável (Testability), "⚠️ ABERTO" explícito vs. omissão silenciosa
// (Clarity) e categorias contextuais de Edge Cases — sem exigir todas em toda Spec. #222 troca os
// gaps de texto livre por `Gap` estruturado (location/problem/impact/suggestedAction, #203 §9) —
// nunca uma saída genérica tipo "Spec precisa ser melhorada".

import type { ParsedRequirement, ParsedSpec } from "./spec-parser.ts";
import type { DimensionResult, Gap } from "./spec-quality.ts";

const OPEN_MARKER = "⚠️ ABERTO";

function fractionOf(satisfied: number, total: number): number {
  return total === 0 ? 1 : satisfied / total;
}

function isBlank(body: string | undefined): boolean {
  return !body || body.trim().length === 0;
}

/** Gap de seção ausente/vazia — reaproveitado por Completeness e Scope, cada um com sua própria
 * `impact`/`suggestedAction` (a mesma seção pode ser sinal de mais de uma dimensão). */
function missingSectionGap(heading: string, impact: string, suggestedAction: string): Gap {
  return {
    location: heading,
    problem: `Seção "${heading}" está ausente ou vazia.`,
    impact,
    suggestedAction,
  };
}

/** Seções cuja presença/não-vacuidade é exigida por Completeness (#203 §4). `Non-Goals` também é
 * checado por `checkScope` (§7) — a mesma seção pode ser sinal de mais de uma dimensão. */
const COMPLETENESS_SECTIONS: Record<string, { impact: string; suggestedAction: string }> = {
  "Context": {
    impact: "Sem contexto, não fica claro por que a Spec existe nem o que motivou o requisito.",
    suggestedAction: 'Preencha "Context" com o problema e a motivação por trás desta Spec.',
  },
  "Goals": {
    impact:
      "Sem objetivos declarados, não há critério para avaliar se a implementação atende ao propósito da Spec.",
    suggestedAction: 'Preencha "Goals" com o que esta Spec deve alcançar.',
  },
  "Non-Goals": {
    impact:
      "Sem Non-Goals, o escopo da implementação pode se expandir silenciosamente durante o desenvolvimento.",
    suggestedAction: 'Preencha "Non-Goals" com o que esta Spec deliberadamente não cobre.',
  },
  "Edge Cases": {
    impact:
      "Sem Edge Cases, comportamentos de erro/limite ficam indefinidos até serem descobertos em produção.",
    suggestedAction: 'Preencha "Edge Cases" com os cenários de borda relevantes ao domínio.',
  },
  "Open Questions": {
    impact: "Decisões pendentes não registradas podem ser esquecidas antes da implementação.",
    suggestedAction:
      'Preencha "Open Questions" com toda pergunta ainda sem resposta (ou registre que não há nenhuma).',
  },
};

export function checkCompleteness(parsed: ParsedSpec): DimensionResult {
  const gaps: Gap[] = [];
  const strengths: string[] = [];
  let satisfied = 0;
  let total = Object.keys(COMPLETENESS_SECTIONS).length + 1; // + 1 = existência de ao menos um RF

  for (const [heading, { impact, suggestedAction }] of Object.entries(COMPLETENESS_SECTIONS)) {
    if (isBlank(parsed.sections.get(heading))) {
      gaps.push(missingSectionGap(heading, impact, suggestedAction));
    } else {
      satisfied++;
      strengths.push(`Seção "${heading}" preenchida.`);
    }
  }

  if (parsed.requirements.length > 0) {
    satisfied++;
    strengths.push("Ao menos um Functional Requirement (RF-) está declarado.");
  } else {
    gaps.push({
      location: "Functional Requirements",
      problem: "Nenhum Functional Requirement (RF-) encontrado.",
      impact: "Não há requisito verificável para orientar a implementação.",
      suggestedAction: "Adicione ao menos um RF- com Priority e Acceptance Criteria.",
    });
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
        gaps.push({
          location: r.id,
          problem: `${r.id} é Must mas não possui Acceptance Criteria.`,
          impact:
            "Requisito Must sem critério verificável não pode ser confirmado como implementado corretamente.",
          // #269: mesmo texto de `checkTestability` para o gap "sem Acceptance Criteria" — o
          // dedup de `suggestions` em spec-quality.ts é por string exata; sem isso, os dois
          // checkers geram duas sugestões quase-idênticas para o mesmo requisito.
          suggestedAction: `Adicione ao menos um Acceptance Criteria verificável para ${r.id}.`,
        });
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
      gaps: [{
        location: "Functional Requirements",
        problem: "Nenhum requisito declarado para avaliar testabilidade.",
        impact: "Não há nada verificável na Spec.",
        suggestedAction: "Adicione requisitos com Acceptance Criteria mensurável.",
      }],
      strengths: [],
    };
  }

  const gaps: Gap[] = [];
  const strengths: string[] = [];
  let total = 0;
  let satisfied = 0;

  for (const r of parsed.requirements) {
    // Metade do peso por ter Acceptance Criteria declarado, metade por não usar termo vago sem
    // métrica — a presença isolada do termo vago não invalida o requisito (#203 §5), só reduz o
    // score parcialmente.
    total += 1;
    let score = r.acceptanceCriteria.length > 0 ? 0.5 : 0;

    // #269: o crédito de "não ter termo vago" só se aplica quando há conteúdo de fato (description
    // ou AC não-vazios) — sem isso, um requisito totalmente vazio pontuava mais que um requisito
    // com conteúdo real mas termo vago sem métrica, já que "sem texto" também "não contém o termo".
    const hasContent = !isBlank(r.description) || r.acceptanceCriteria.length > 0;
    const vagueTerm = hasContent ? findUnmeasuredVagueTerm(r) : null;
    if (vagueTerm) {
      gaps.push({
        location: r.id,
        problem: `Usa termo vago sem métrica mensurável: "${vagueTerm}".`,
        impact: "Não é possível verificar objetivamente se o requisito foi atendido.",
        suggestedAction:
          `Substitua "${vagueTerm}" por um valor ou comportamento mensurável em ${r.id} (ex.: "em até 500ms no P95").`,
      });
    } else if (hasContent) {
      score += 0.5;
    }

    if (r.acceptanceCriteria.length === 0) {
      gaps.push({
        location: r.id,
        problem: "Não possui Acceptance Criteria.",
        impact: "Não é possível testar se o requisito foi implementado corretamente.",
        suggestedAction: `Adicione ao menos um Acceptance Criteria verificável para ${r.id}.`,
      });
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
// melhor que a mesma lacuna omitida em silêncio ("unknown and hidden"). Só a segunda é gap de
// Clarity. Um requisito com `hasOpenMarker` (⚠️ ABERTO em algum lugar do seu texto) já tornou suas
// lacunas explícitas, então não é penalizado por este heurístico mesmo que também contenha um dos
// termos abaixo em outro trecho.
const HIDDEN_OMISSION_RE = /\bTODO\b|\bTBD\b|a definir\b/i;

export function checkClarity(parsed: ParsedSpec): DimensionResult {
  // #269 (blocker): sem nenhum requisito não há nada para confirmar que lacunas foram sinalizadas
  // explicitamente — `fraction: 0`, mesmo tratamento de `checkTestability` para o mesmo cenário.
  // Antes, `total = Math.max(1, ...)` dava `fraction: 1` (pontuação de graça) para Spec vazia.
  if (parsed.requirements.length === 0) {
    return {
      fraction: 0,
      gaps: [{
        location: "Functional Requirements",
        problem: "Nenhum requisito declarado para avaliar clareza.",
        impact: "Não há nada para confirmar que lacunas foram sinalizadas explicitamente.",
        suggestedAction: "Adicione requisitos com decisões explícitas (ou marque lacunas com " +
          `"${OPEN_MARKER}: <o que falta definir>").`,
      }],
      strengths: [],
    };
  }

  const gaps: Gap[] = [];
  const strengths: string[] = [];

  const requirementsWithPlaceholder = parsed.requirements.filter((r) =>
    TEMPLATE_PLACEHOLDER_RE.test(r.name) || TEMPLATE_PLACEHOLDER_RE.test(r.raw)
  );
  const requirementsWithHiddenOmission = parsed.requirements.filter((r) =>
    !r.hasOpenMarker && HIDDEN_OMISSION_RE.test(r.raw)
  );

  for (const r of requirementsWithPlaceholder) {
    gaps.push({
      location: r.id,
      problem: "Contém placeholder de template não preenchido.",
      impact: "A implementação não tem informação real para seguir nesse ponto.",
      suggestedAction: `Substitua o placeholder pelo conteúdo real de ${r.id}.`,
    });
  }
  for (const r of requirementsWithHiddenOmission) {
    gaps.push({
      location: r.id,
      problem: `Tem uma lacuna omitida em silêncio (TODO/TBD/"a definir" sem "${OPEN_MARKER}").`,
      impact:
        "A lacuna pode passar despercebida durante a implementação, gerando comportamento não especificado.",
      suggestedAction:
        `Marque a lacuna explicitamente com "${OPEN_MARKER}: <o que falta definir>" em ${r.id}.`,
    });
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

  const total = parsed.requirements.length;
  const satisfied = total - requirementsWithIssue.size;
  return { fraction: fractionOf(satisfied, total), gaps, strengths };
}

const SCOPE_SECTIONS: Record<string, { impact: string; suggestedAction: string }> = {
  "Goals": {
    impact: "Sem Goals, não fica claro o que a implementação deve alcançar.",
    suggestedAction: 'Preencha "Goals" com o que esta Spec deve alcançar.',
  },
  "Non-Goals": {
    impact:
      "Sem Non-Goals, o limite do escopo não fica claro e a implementação pode se expandir silenciosamente.",
    suggestedAction: 'Preencha "Non-Goals" com o que esta Spec deliberadamente não cobre.',
  },
};

export function checkScope(parsed: ParsedSpec): DimensionResult {
  const gaps: Gap[] = [];
  const strengths: string[] = [];
  let satisfied = 0;

  for (const [heading, { impact, suggestedAction }] of Object.entries(SCOPE_SECTIONS)) {
    if (isBlank(parsed.sections.get(heading))) {
      gaps.push(missingSectionGap(heading, impact, suggestedAction));
    } else {
      satisfied++;
      strengths.push(`Seção "${heading}" define o limite do escopo.`);
    }
  }

  return { fraction: fractionOf(satisfied, Object.keys(SCOPE_SECTIONS).length), gaps, strengths };
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
      gaps: [missingSectionGap(
        "Edge Cases",
        "Comportamentos de erro/limite ficam indefinidos até serem descobertos em produção.",
        'Preencha "Edge Cases" com os cenários de borda relevantes ao domínio, ou registre explicitamente que nenhum é relevante.',
      )],
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
