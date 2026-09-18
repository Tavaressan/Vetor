// Parsing heurístico (heading-regex, sem AST de markdown) de uma Spec gerada por `/vetor:spec`
// (templates/spec.md) — consumido pelos dimension checkers de spec-quality-checkers.ts (#221).
//
// Deliberadamente não usa uma lib de markdown: a estrutura da Spec é sempre `## Heading` /
// `### RF-NN - <nome>` / `### RNF-NN - <nome>` (ver templates/spec.md), então regex sobre linhas é
// suficiente e evita puxar uma dependência só para isso (#203 §19 — heurística é aceitável).

export type RequirementKind = "RF" | "RNF";
export type RequirementPriority = "Must" | "Should" | "Could";

export interface ParsedRequirement {
  /** Ex.: "RF-01". */
  id: string;
  kind: RequirementKind;
  name: string;
  priority?: RequirementPriority;
  description: string;
  /** Texto de cada item de checklist sob "**Acceptance Criteria:**" (sem o prefixo "- [ ] "). */
  acceptanceCriteria: string[];
  /** Bloco do requisito contém "⚠️ ABERTO" — lacuna explícita, não omissão silenciosa. */
  hasOpenMarker: boolean;
  /** Corpo bruto do requisito, para heurísticas que precisam do texto completo (ex.: testability). */
  raw: string;
}

export interface ParsedSpec {
  /** Heading H2 (sem "## ") -> corpo até o próximo H2 (nunca `undefined` para heading presente,
   * mesmo quando o corpo é vazio — distinção entre "seção ausente" e "seção vazia" importa para os
   * checkers). */
  sections: Map<string, string>;
  requirements: ParsedRequirement[];
}

const OPEN_MARKER = "⚠️ ABERTO";

/** Divide o texto em blocos de heading H2 (`## `), preservando o corpo até o próximo H2. */
function splitH2(text: string): Map<string, string> {
  const sections = new Map<string, string>();
  const matches = [...text.matchAll(/^##\s+(.+?)\s*$/gm)];
  for (let i = 0; i < matches.length; i++) {
    const heading = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    sections.set(heading, text.slice(start, end).trim());
  }
  return sections;
}

function parsePriority(block: string): RequirementPriority | undefined {
  const m = block.match(/\*\*Priority:\*\*\s*(Must|Should|Could)/i);
  if (!m) return undefined;
  const value = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return value as RequirementPriority;
}

function parseField(block: string, field: string): string {
  const re = new RegExp(`\\*\\*${field}:\\*\\*\\s*\\n?([\\s\\S]*?)(?=\\n\\*\\*[A-Za-z]|$)`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : "";
}

function parseAcceptanceCriteria(block: string): string[] {
  const body = parseField(block, "Acceptance Criteria");
  if (!body) return [];
  return [...body.matchAll(/^-\s*\[[ xX]\]\s*(.+)$/gm)].map((m) => m[1].trim());
}

/** Extrai os blocos `### RF-NN - <nome>` / `### RNF-NN - <nome>` de todo o texto (não só das
 * seções "Functional/Non-Functional Requirements" — robustez contra reorganização manual). */
function parseRequirements(text: string): ParsedRequirement[] {
  const headingRe = /^###\s+(RF|RNF)-(\d+)\s*(?:-|–)?\s*(.*)$/gm;
  const matches = [...text.matchAll(headingRe)];
  const requirements: ParsedRequirement[] = [];

  for (let i = 0; i < matches.length; i++) {
    const [, kind, num, name] = matches[i];
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const raw = text.slice(start, end).trim();

    requirements.push({
      id: `${kind}-${num}`,
      kind: kind as RequirementKind,
      name: name.trim(),
      priority: parsePriority(raw),
      description: parseField(raw, "Description"),
      acceptanceCriteria: parseAcceptanceCriteria(raw),
      hasOpenMarker: raw.includes(OPEN_MARKER),
      raw,
    });
  }

  return requirements;
}

/** Faz o parsing heurístico de uma Spec em markdown. Nunca lança — texto que não casa com nenhum
 * padrão simplesmente produz `sections` vazio e `requirements` vazio (Spec incompleta é um
 * resultado válido para o Quality Model avaliar, não um erro de parsing). */
export function parseSpec(text: string): ParsedSpec {
  return {
    sections: splitH2(text),
    requirements: parseRequirements(text),
  };
}
