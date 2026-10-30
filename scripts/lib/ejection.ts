// Comentário diagnóstico da ejeção graciosa (RF-05 de
// docs/specs/autonomia-continua-e-desacoplamento-interativo.md, issue #501).
//
// O texto é publicado numa issue que pode ser pública, então passa por duas limpezas: paths
// absolutos locais saem (vazariam usuário e estrutura de diretórios da máquina) e menções
// `@usuario` fora de bloco de código são neutralizadas (notificariam alguém por acidente — o log de
// uma suíte Deno cita `jsr:@std/assert` o tempo todo).

import type { BlockedStatus } from "./decision-inbox.ts";

export type EjectionKind = "failed-max-iterations" | "blocked-timeout";

export interface FailAnalysis {
  testCommand: string;
  lastError: string;
  hypotheses: string[];
  fixes: string[];
  nextStep: string;
}

export interface EjectionInput {
  kind: EjectionKind;
  issueNumber: number;
  branch: string;
  /** Saída de `git log --oneline <base>..<branch>`, uma linha por commit. */
  commits: string[];
  /** A branch já existe em `origin`? Workers nunca publicam, então normalmente não. */
  remotePublished: boolean;
  /** Conteúdo do `FAIL_ANALYSIS.md` (handover do fix, §4). */
  failAnalysis?: string;
  /** Blocos do status file `SUSPENDED`, para `blocked-timeout`. */
  blocked?: Pick<BlockedStatus, "reason" | "options" | "recommendation">;
  /** Roots locais a remover dos paths (repositório e worktree). */
  roots: string[];
}

const MAX_LOG_LINES = 40;
const MAX_LOG_LINE_LENGTH = 300;
const ZERO_WIDTH_SPACE = "\u{200B}";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove paths absolutos locais: primeiro os roots informados (ficam relativos), depois o resto. */
export function sanitizeDiagnostic(text: string, roots: string[]): string {
  let out = text;
  for (const root of roots.filter(Boolean)) {
    const forward = root.replaceAll("\\", "/").replace(/\/+$/, "");
    const pattern = escapeRegExp(forward).replaceAll("/", "[\\\\/]");
    out = out.replace(new RegExp(`${pattern}[\\\\/]?`, "gi"), "");
  }
  return out
    .replace(/[A-Za-z]:[\\/][^\s"'`)\]]+/g, "<caminho-local>")
    .replace(/\/(?:home|Users|root|tmp|var|opt|mnt|private)\/[^\s"'`)\]]+/g, "<caminho-local>");
}

/** `@usuario` fora de bloco de código notifica; um espaço de largura zero desfaz a menção. */
function neutralizeMentions(text: string): string {
  return text.replace(/@(?=\w)/g, `@${ZERO_WIDTH_SPACE}`);
}

function sectionsOf(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  for (const part of markdown.split(/^## /m).slice(1)) {
    const newline = part.indexOf("\n");
    if (newline === -1) continue;
    sections.set(part.slice(0, newline).trim(), part.slice(newline + 1));
  }
  return sections;
}

function sectionStartingWith(sections: Map<string, string>, prefix: string): string {
  for (const [title, body] of sections) if (title.startsWith(prefix)) return body;
  return "";
}

function numberedItems(body: string): string[] {
  return body.split(/\r?\n/).map((line) => line.match(/^\s*\d+[.)]\s+(.+?)\s*$/)?.[1])
    .filter((item): item is string => item !== undefined);
}

/** Lê o handover de falha que o fix grava (`fix` §4); seção ausente vira vazio. */
export function parseFailAnalysis(markdown: string): FailAnalysis {
  const sections = sectionsOf(markdown);
  const details = sectionStartingWith(sections, "Detalhes");
  const fenced = sectionStartingWith(sections, "Último Erro").trim().match(
    /^```[^\n]*\n([\s\S]*)\n```$/,
  );
  return {
    testCommand: details.match(/Comando de Teste\*{0,2}:\s*`([^`]+)`/)?.[1] ?? "",
    lastError: fenced?.[1] ?? "",
    hypotheses: numberedItems(sectionStartingWith(sections, "Hipóteses")),
    fixes: numberedItems(sectionStartingWith(sections, "Fixes Tentados")),
    nextStep: sectionStartingWith(sections, "Próximo Passo").trim(),
  };
}

function fenced(content: string): string {
  // ''' no lugar de ``` impede que o conteúdo feche o bloco antes da hora.
  return ["```", content.replaceAll("```", "'''"), "```"].join("\n");
}

function tail(log: string): string {
  return log.split(/\r?\n/).slice(-MAX_LOG_LINES)
    .map((line) =>
      line.length > MAX_LOG_LINE_LENGTH ? `${line.slice(0, MAX_LOG_LINE_LENGTH)}…` : line
    )
    .join("\n");
}

export function buildEjectionComment(input: EjectionInput): string {
  const { roots, branch } = input;
  const clean = (text: string) => sanitizeDiagnostic(text, roots);
  const prose = (text: string) => neutralizeMentions(clean(text));

  const reason = input.kind === "failed-max-iterations"
    ? "esgotou o orçamento de correções sem chegar ao verde (`FAILED_MAX_ITERATIONS`)"
    : "bloqueio sem resposta: a dúvida do worker não pôde ser decidida durante a execução autônoma";
  const branchLine = input.remotePublished
    ? `\`${branch}\` (publicada em \`origin/${branch}\`)`
    : `\`${branch}\` (só local; para publicá-la: \`git push -u origin ${branch}\`)`;

  const lines = [
    "## Ejeção graciosa (Vetor)",
    "",
    `A issue #${input.issueNumber} saiu da leva automática do coordinator e precisa de uma pessoa.`,
    "",
    `- **Motivo:** ${reason}`,
    `- **Branch preservada:** ${branchLine}`,
    "- **Worktree:** o diretório isolado é limpo; o trabalho fica na branch",
  ];

  if (input.commits.length > 0) {
    lines.push("", "### Commits da branch", "", fenced(clean(input.commits.join("\n"))));
  }

  if (input.kind === "failed-max-iterations" && input.failAnalysis) {
    const analysis = parseFailAnalysis(input.failAnalysis);
    if (analysis.hypotheses.length > 0) {
      lines.push("", "### Hipóteses consideradas", "");
      lines.push(...analysis.hypotheses.map((item, index) => `${index + 1}. ${prose(item)}`));
    }
    if (analysis.fixes.length > 0) {
      lines.push("", "### Fixes tentados", "");
      lines.push(...analysis.fixes.map((item, index) => `${index + 1}. ${prose(item)}`));
    }
    if (analysis.testCommand) {
      lines.push("", "### Comando de teste", "", `\`${clean(analysis.testCommand)}\``);
    }
    if (analysis.lastError) {
      lines.push(
        "",
        `### Último erro (últimas ${MAX_LOG_LINES} linhas)`,
        "",
        fenced(clean(tail(analysis.lastError))),
      );
    }
    if (analysis.nextStep) {
      lines.push("", "### Próximo passo sugerido", "", prose(analysis.nextStep));
    }
  }

  if (input.kind === "blocked-timeout" && input.blocked) {
    lines.push("", "### Bloqueio", "", `**Blocked on:** ${prose(input.blocked.reason)}`);
    if (input.blocked.options.length > 0) {
      lines.push("", "**Opções:**", "");
      lines.push(...input.blocked.options.map((item, index) => `${index + 1}. ${prose(item)}`));
    }
    if (input.blocked.recommendation) {
      lines.push("", `**Recomendação do worker:** ${prose(input.blocked.recommendation)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}
