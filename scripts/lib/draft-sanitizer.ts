/**
 * Validador e sanitizador de rascunhos de código (issue #451, issue #482).
 *
 * Inspeciona arquivos e diffs produzidos por workers remotos/sandboxed antes
 * de serem incorporados pelo coordinator no host principal. Detecta os 4 padrões
 * de defeito empírico catalogados no Spike #451:
 *
 * 1. Caracteres de controle crus / corrupção de encoding UTF-8 (\uFFFD, \0, control chars).
 * 2. Quebras literais mal escapadas em Markdown (sequências `n).
 * 3. Remoção indevida de blocos JSDoc pré-existentes.
 * 4. Bashismos restritos (ex.: declare -A) em scripts shell.
 */

export type IssueSeverity = "error" | "warning";

export interface DraftSanitizeIssue {
  rule:
    | "utf8-control-chars"
    | "corrupted-markdown-escape"
    | "stripped-jsdoc"
    | "bash-declare-assoc";
  message: string;
  line?: number;
  severity: IssueSeverity;
}

export interface DraftSanitizeReport {
  valid: boolean;
  issues: DraftSanitizeIssue[];
}

// Regex para caracteres de controle indesejados (exclui \t, \n, \r)
// deno-lint-ignore no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]|\uFFFD/;

// Regex para sequências de crase literais de newline no Markdown (comum em geradores Codex Windows/POSIX)
const CORRUPTED_MD_ESCAPE_RE = /`n(?=[\s\S])/;

// Regex para declare -A em shell scripts (arrays associativos do Bash 4 incompatíveis com POSIX/macOS)
const BASH_DECLARE_ASSOC_RE = /\bdeclare\s+-A\b/;

// Regex para blocos JSDoc
const JSDOC_BLOCK_RE = /\/\*\*[\s\S]*?\*\//g;

/**
 * Inspeciona o conteúdo textual de um arquivo em busca de anomalias sintáticas e de formatação.
 */
export function sanitizeDraftText(
  text: string,
  options: { filename?: string; originalText?: string } = {},
): DraftSanitizeReport {
  const issues: DraftSanitizeIssue[] = [];
  const filename = options.filename ?? "";
  const lines = text.split(/\r?\n/);

  // 1. Checagem de UTF-8 e caracteres de controle
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (CONTROL_CHARS_RE.test(line)) {
      issues.push({
        rule: "utf8-control-chars",
        message:
          "Linha contém caractere de controle cru ou caractere de substituição UTF-8 corrompido (\\uFFFD)",
        line: i + 1,
        severity: "error",
      });
    }
  }

  // 2. Checagem de quebra literal em Markdown
  if (filename.endsWith(".md") || filename.endsWith(".markdown")) {
    for (let i = 0; i < lines.length; i++) {
      if (CORRUPTED_MD_ESCAPE_RE.test(lines[i])) {
        issues.push({
          rule: "corrupted-markdown-escape",
          message: "Markdown contém sequência literal corrompida de quebra de linha (`n)",
          line: i + 1,
          severity: "error",
        });
      }
    }
  }

  // 3. Checagem de bashismos incompatíveis em scripts shell
  if (filename.endsWith(".sh") || filename.endsWith(".bash")) {
    for (let i = 0; i < lines.length; i++) {
      if (BASH_DECLARE_ASSOC_RE.test(lines[i])) {
        issues.push({
          rule: "bash-declare-assoc",
          message:
            "Script shell utiliza 'declare -A' (Bash 4+), incompatível com macOS (Bash 3.2) e shells POSIX",
          line: i + 1,
          severity: "error",
        });
      }
    }
  }

  // 4. Checagem de preservação de JSDoc em arquivos TypeScript/JavaScript
  if (
    options.originalText &&
    (filename.endsWith(".ts") || filename.endsWith(".js") || filename.endsWith(".tsx") ||
      filename.endsWith(".jsx"))
  ) {
    const originalDocs = options.originalText.match(JSDOC_BLOCK_RE) ?? [];
    const draftDocs = text.match(JSDOC_BLOCK_RE) ?? [];

    if (originalDocs.length > 0 && draftDocs.length === 0) {
      issues.push({
        rule: "stripped-jsdoc",
        message:
          `O rascunho removeu todos os ${originalDocs.length} blocos JSDoc pré-existentes no arquivo`,
        severity: "warning",
      });
    }
  }

  const hasBlockingError = issues.some((issue) => issue.severity === "error");

  return {
    valid: !hasBlockingError,
    issues,
  };
}
