/**
 * Micro-spec JIT (RF-07 de docs/specs/autonomia-continua-e-desacoplamento-interativo.md, issue
 * #501): spec de uma página que um modelo leve sintetiza no dispatch de uma issue não-trivial sem
 * Spec, em vez de perguntar ao usuário. O conteúdo vem de um modelo, então `validateMicroSpec`
 * confere o formato antes de ele entrar no ContextPacket.
 */

export const MICRO_SPEC_DIR = "docs/specs/micro";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_LINES = 60;

/** `docs/specs/micro/<issue#>-<slug>.md`: o slug (kebab-case) não pode escapar do diretório. */
export function microSpecPath(issueNumber: number, slug: string): string {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error(`número de issue inválido para a micro-spec: ${issueNumber}`);
  }
  if (!SLUG_RE.test(slug)) throw new Error(`slug inválido para a micro-spec: ${slug}`);
  return `${MICRO_SPEC_DIR}/${issueNumber}-${slug}.md`;
}

function sectionBody(markdown: string, heading: RegExp): string | undefined {
  for (const part of markdown.split(/^## /m).slice(1)) {
    const newline = part.indexOf("\n");
    const title = (newline === -1 ? part : part.slice(0, newline)).trim();
    if (heading.test(title)) return newline === -1 ? "" : part.slice(newline + 1);
  }
  return undefined;
}

/** Defeitos do texto do modelo leve; lista vazia = pode ir ao ContextPacket. */
export function validateMicroSpec(markdown: string): string[] {
  const problems: string[] = [];

  if (!sectionBody(markdown, /^objetivo$/i)?.trim()) {
    problems.push('a seção "Objetivo" está ausente ou vazia');
  }

  const criteria = sectionBody(markdown, /^crit[ée]rios de aceite$/i) ?? "";
  const criteriaCount = (criteria.match(/^\s*[-*]\s+\[[ xX]\]\s+\S/gm) ?? []).length;
  if (criteriaCount !== 3) {
    problems.push(
      `a seção "Critérios de aceite" precisa de exatamente 3 critérios, tem ${criteriaCount}`,
    );
  }

  const nonGoals = sectionBody(markdown, /^non-goals$/i) ?? "";
  const nonGoalsCount = (nonGoals.match(/^\s*[-*]\s+\S/gm) ?? []).length;
  if (nonGoalsCount !== 2) {
    problems.push(`a seção "Non-goals" precisa de exatamente 2 non-goals, tem ${nonGoalsCount}`);
  }

  const lines = markdown.replace(/\s+$/, "").split(/\r?\n/).length;
  if (lines > MAX_LINES) {
    problems.push(`a micro-spec passa de 1 página (${lines} linhas; máximo ${MAX_LINES})`);
  }
  return problems;
}
