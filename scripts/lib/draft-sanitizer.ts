/**
 * Validador e sanitizador de rascunhos de código (issue #451, issue #482, issue #483).
 *
 * Inspeciona arquivos e diffs produzidos por workers remotos/sandboxed antes
 * de serem incorporados pelo coordinator no host principal. Detecta os padrões
 * de defeito empírico catalogados no Spike #451 e na issue #483:
 *
 * 1. Caracteres de controle crus (fora de TAB, LF e CR) e BOM (U+FEFF no início de linha).
 * 2. Mojibake (UTF-8 lido como Latin-1/Windows-1252) e U+FFFD.
 * 3. Acento trocado por `?` no meio de uma palavra.
 * 4. Quebras literais mal escapadas em Markdown (sequências `n).
 * 5. Remoção indevida de blocos JSDoc pré-existentes, comparada pelo símbolo documentado. Blocos
 *    de membros e cabeçalhos de módulo não têm símbolo e são comparados só por contagem.
 * 6. Bashismos restritos (ex.: declare -A) em scripts shell.
 * 7. UTF-8 inválido (só em `scanDraftBytes`, que lê bytes).
 *
 * A CLI `scripts/draft-scan.ts` aplica estas regras a arquivos ou a um diff contra uma base.
 *
 * Nas regex e fixtures use a forma `\u{...}`: o `deno fmt` converte `\uXXXX` de volta no
 * caractere literal, o que traria o mojibake para o próprio fonte.
 */

export type IssueSeverity = "error" | "warning";

export type DraftSanitizeRule =
  | "utf8-control-chars"
  | "bom"
  | "mojibake"
  | "question-mark-accent"
  | "invalid-utf8"
  | "corrupted-markdown-escape"
  | "stripped-jsdoc"
  | "bash-declare-assoc";

export interface DraftSanitizeIssue {
  rule: DraftSanitizeRule;
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
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

// BOM (U+FEFF) no início de uma linha: início do arquivo ou emenda de arquivos concatenados.
// Um U+FEFF no meio da linha (ex.: numa regex que remove o BOM) não é BOM.
const BOM_RE = /^\u{FEFF}/u;

// Mojibake de UTF-8 lido como Latin-1/Windows-1252: U+00C3 seguido de um caractere de
// continuação (U+0080-U+00BF, ou o que o cp1252 mostra nos bytes 0x80-0x9F), U+00E2 U+20AC (início
// de aspas e travessões) e o caractere de substituição U+FFFD.
const MOJIBAKE_RE = new RegExp(
  "\\u{C3}[\\u{80}-\\u{BF}\\u{152}\\u{153}\\u{160}\\u{161}\\u{178}\\u{17D}\\u{17E}\\u{192}" +
    "\\u{2C6}\\u{2DC}\\u{2013}\\u{2014}\\u{2018}\\u{2019}\\u{201A}\\u{201C}\\u{201D}\\u{201E}" +
    "\\u{2020}\\u{2021}\\u{2022}\\u{2026}\\u{2030}\\u{2039}\\u{203A}\\u{20AC}\\u{2122}]" +
    "|\\u{E2}\\u{20AC}|\\u{FFFD}",
  "u",
);

// Acento trocado por "?": palavra só de letras com um ou mais "?" no meio. URLs, regex e ternários
// têm outros símbolos no mesmo token e ficam de fora; "?" no fim da palavra não é distinguível de
// uma pergunta e não é detectado. A pontuação nas bordas do token (inclusive aspas tipográficas
// U+2018, U+2019, U+201C e U+201D) é ignorada.
const QUESTION_ACCENT_WORD_RE = /^\p{L}+\?+\p{L}+$/u;
const TOKEN_LEADING_PUNCTUATION_RE = /^[.,;:!"'*_\u{2018}\u{2019}\u{201C}\u{201D}]+/u;
const TOKEN_TRAILING_PUNCTUATION_RE = /[.,;:!"'*_\u{2018}\u{2019}\u{201C}\u{201D}]+$/u;

// Crase de newline do PowerShell (`n) emitida literalmente: colada ao fim de uma palavra ou
// pontuação ("Título`n") ou repetida ("`n`n"). Spans legítimos como `name` abrem depois de espaço
// ou pontuação de abertura, e fences como ```nginx começam com crases.
const CORRUPTED_MD_ESCAPE_RE = /[\p{L}\p{N}.,;:!?)\]}]`n|`n`n/u;

// Span de código com crase dupla: é como a documentação cita a própria sequência `n
const DOUBLE_BACKTICK_SPAN_RE = /(?<!`)``(?!`).+?(?<!`)``(?!`)/g;

// Regex para declare -A em shell scripts (arrays associativos do Bash 4 incompatíveis com POSIX/macOS)
const BASH_DECLARE_ASSOC_RE = /\bdeclare\s+-A\b/;

// Linha inteira de comentário em shell: pode citar `declare -A` para explicar por que evitá-lo
const SHELL_COMMENT_LINE_RE = /^\s*#/;

// Bloco JSDoc e, num lookahead que não o consome, a primeira linha de código depois dele (linhas
// em branco e comentários `//` no meio são ignorados): é ela que diz o que o bloco documenta.
const JSDOC_WITH_NEXT_LINE_RE = /\/\*\*[\s\S]*?\*\/(?=\s*(?:\/\/[^\n]*\n\s*)*([^\n]*))/g;

// Declaração nomeada (função, constante, classe, interface, tipo ou enum), com os modificadores
// usuais. Membros de classe/interface e cabeçalhos de módulo não casam e ficam sem nome.
const DECLARATION_RE =
  /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const\s+enum|function\*?|const|let|var|class|interface|type|enum)\s+([\p{L}_$][\p{L}\p{N}_$]*)/u;

interface JsdocInventory {
  /** Nomes de declaração com JSDoc */
  documented: Set<string>;
  /** Nomes de todas as declarações do arquivo */
  declared: Set<string>;
  /** Blocos JSDoc cuja linha seguinte não é uma declaração nomeada */
  unnamed: number;
}

function declarationName(line: string): string | undefined {
  return DECLARATION_RE.exec(line.trimStart())?.[1];
}

function inventoryJsdoc(text: string): JsdocInventory {
  const documented = new Set<string>();
  let unnamed = 0;
  for (const match of text.matchAll(JSDOC_WITH_NEXT_LINE_RE)) {
    const name = declarationName(match[1]);
    if (name) documented.add(name);
    else unnamed++;
  }
  const declared = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const name = declarationName(line);
    if (name) declared.add(name);
  }
  return { documented, declared, unnamed };
}

/**
 * Descreve o JSDoc que a base tem e o rascunho perdeu, ou `undefined` se nada foi perdido.
 * Declaração nomeada: acusa o nome que a base documenta, que o rascunho ainda declara e não
 * documenta. Apagar ou renomear o símbolo com o seu JSDoc não acusa. Blocos sem nome: só a
 * contagem, porque não há símbolo para comparar.
 */
function describeLostJsdoc(baseText: string, draftText: string): string | undefined {
  const base = inventoryJsdoc(baseText);
  const draft = inventoryJsdoc(draftText);
  const parts: string[] = [];

  const stripped = [...base.documented].filter((name) =>
    draft.declared.has(name) && !draft.documented.has(name)
  );
  if (stripped.length > 0) parts.push(`JSDoc removido de: ${stripped.join(", ")}`);

  if (draft.unnamed < base.unnamed) {
    parts.push(
      `${draft.unnamed} bloco(s) JSDoc sem declaração nomeada (membro ou cabeçalho) contra ${base.unnamed} na base`,
    );
  }
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function hasQuestionMarkAccent(line: string): boolean {
  return line.split(/\s+/).some((token) =>
    QUESTION_ACCENT_WORD_RE.test(
      token.replace(TOKEN_LEADING_PUNCTUATION_RE, "").replace(TOKEN_TRAILING_PUNCTUATION_RE, ""),
    )
  );
}

function hasCorruptedMarkdownEscape(line: string): boolean {
  return CORRUPTED_MD_ESCAPE_RE.test(line.replace(DOUBLE_BACKTICK_SPAN_RE, " "));
}

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
  const isMarkdown = filename.endsWith(".md") || filename.endsWith(".markdown");
  const isShell = filename.endsWith(".sh") || filename.endsWith(".bash");

  const report = (rule: DraftSanitizeRule, message: string, line: number) => {
    issues.push({ rule, message, line, severity: "error" });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;

    if (CONTROL_CHARS_RE.test(line)) {
      report(
        "utf8-control-chars",
        "Linha contém caractere de controle cru (fora de TAB, LF e CR)",
        lineNumber,
      );
    }
    if (BOM_RE.test(line)) {
      report("bom", "Linha começa com BOM (U+FEFF)", lineNumber);
    }
    if (MOJIBAKE_RE.test(line)) {
      report(
        "mojibake",
        "Linha contém mojibake: UTF-8 lido como Latin-1/Windows-1252 ou caractere de substituição U+FFFD",
        lineNumber,
      );
    }
    if (hasQuestionMarkAccent(line)) {
      report(
        "question-mark-accent",
        "Linha contém palavra com '?' no lugar de um caractere acentuado",
        lineNumber,
      );
    }
    if (isMarkdown && hasCorruptedMarkdownEscape(line)) {
      report(
        "corrupted-markdown-escape",
        "Markdown contém sequência literal corrompida de quebra de linha (`n)",
        lineNumber,
      );
    }
    if (isShell && !SHELL_COMMENT_LINE_RE.test(line) && BASH_DECLARE_ASSOC_RE.test(line)) {
      report(
        "bash-declare-assoc",
        "Script shell utiliza 'declare -A' (Bash 4+), incompatível com macOS (Bash 3.2) e shells POSIX",
        lineNumber,
      );
    }
  }

  // Preservação de JSDoc em arquivos TypeScript/JavaScript, comparada com a base pelo símbolo
  // documentado. O achado vale para o arquivo inteiro e é reportado na linha 1.
  if (
    options.originalText &&
    (filename.endsWith(".ts") || filename.endsWith(".js") || filename.endsWith(".tsx") ||
      filename.endsWith(".jsx"))
  ) {
    const lost = describeLostJsdoc(options.originalText, text);
    if (lost) report("stripped-jsdoc", `JSDoc perdido em relação à base. ${lost}`, 1);
  }

  issues.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  const hasBlockingError = issues.some((issue) => issue.severity === "error");

  return {
    valid: !hasBlockingError,
    issues,
  };
}

/**
 * Inspeciona os bytes de um arquivo. UTF-8 inválido é um achado (nunca é descartado em silêncio)
 * e o BOM inicial é preservado para ser detectado.
 */
export function scanDraftBytes(
  bytes: Uint8Array,
  options: { filename?: string; originalText?: string } = {},
): DraftSanitizeReport {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    const lossy = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    const index = lossy.indexOf("\u{FFFD}");
    const line = index === -1 ? 1 : lossy.slice(0, index).split(/\r?\n/).length;
    return {
      valid: false,
      issues: [{
        rule: "invalid-utf8",
        message:
          "Arquivo não é UTF-8 válido (linha da primeira substituição U+FFFD na leitura tolerante)",
        line,
        severity: "error",
      }],
    };
  }
  return sanitizeDraftText(text, options);
}
