import { assertEquals } from "@std/assert";
import {
  type DraftSanitizeRule,
  sanitizeDraftText,
  scanDraftBytes,
} from "../lib/draft-sanitizer.ts";

// Fixtures por sequências de escape: o fonte nunca carrega o byte corrompido nem o caractere
// acentuado quebrado, só a sua descrição em texto ASCII. Usa-se a forma \u{...} porque o
// `deno fmt` converte \uXXXX de volta no caractere literal (e \x.. e \u{...} ele preserva).

function rulesOf(text: string, filename: string, originalText?: string): DraftSanitizeRule[] {
  return sanitizeDraftText(text, { filename, originalText }).issues.map((issue) => issue.rule);
}

Deno.test("DraftSanitizer - texto limpo é válido", () => {
  const code = `
export function add(a: number, b: number): number {
  return a + b;
}
`;
  const report = sanitizeDraftText(code, { filename: "math.ts" });
  assertEquals(report.valid, true);
  assertEquals(report.issues.length, 0);
});

Deno.test("DraftSanitizer - texto acentuado correto, TAB, CRLF e '?' de pergunta são limpos", () => {
  const text = "a\u{e7}\u{e3}o n\u{e3}o \u{e9} voc\u{ea}\t(tab)\r\nQual \u{e9} o status\u{3f}\r\n";
  const report = sanitizeDraftText(text, { filename: "notas.md" });
  assertEquals(report.issues, []);
  assertEquals(report.valid, true);
});

Deno.test("DraftSanitizer - achados trazem linha e ficam ordenados por linha", () => {
  const text = "limpa\nlinha com nulo \u0000\nlimpa\nlinha com mojibake \u{c3}\u{a9}\n";
  const report = sanitizeDraftText(text, { filename: "code.ts" });

  assertEquals(report.valid, false);
  assertEquals(report.issues.map((issue) => [issue.rule, issue.line]), [
    ["utf8-control-chars", 2],
    ["mojibake", 4],
  ]);
});

Deno.test("DraftSanitizer - detecta bytes de controle fora de TAB, LF e CR", () => {
  for (const control of ["\u0000", "\u0003", "\u001b", "\x7f"]) {
    assertEquals(rulesOf(`const s = 'a${control}b';`, "code.ts"), ["utf8-control-chars"]);
  }
});

Deno.test("DraftSanitizer - TAB, LF e CR não são bytes de controle", () => {
  assertEquals(rulesOf("a\tb\r\nc\rd\n", "code.ts"), []);
});

Deno.test("DraftSanitizer - detecta BOM no início do arquivo e na emenda de arquivos concatenados", () => {
  assertEquals(rulesOf("\u{feff}const x = 1;", "code.ts"), ["bom"]);
  const report = sanitizeDraftText("linha 1\n\u{feff}linha 2", { filename: "code.ts" });
  assertEquals(report.issues.map((issue) => [issue.rule, issue.line]), [["bom", 2]]);
});

Deno.test("DraftSanitizer - sem BOM ou com U+FEFF no meio de uma regex não acusa BOM", () => {
  assertEquals(rulesOf("const x = 1;\n", "code.ts"), []);
  assertEquals(rulesOf("texto.replace(/^\u{feff}/, '');", "code.ts"), []);
});

Deno.test("DraftSanitizer - detecta mojibake: U+00C3 com continuação, U+00E2 U+20AC e U+FFFD", () => {
  const samples = [
    "\u{c3}\u{a9}", // "é" lido como Latin-1
    "\u{c3}\u{a3}", // "ã"
    "\u{c3}\u{ad}", // "í" (a continuação é o hífen suave U+00AD)
    "\u{c3}\u{20ac}", // "À" lido como cp1252 (a continuação é o euro)
    "\u{e2}\u{20ac}\u{2122}", // aspa simples tipográfica
    "\u{e2}\u{20ac}",
    "aten\u{fffd}\u{fffd}o",
  ];
  for (const sample of samples) {
    assertEquals(rulesOf(`texto ${sample} fim`, "doc.md"), ["mojibake"], sample);
  }
});

Deno.test("DraftSanitizer - texto acentuado legítimo não é mojibake", () => {
  const samples = [
    "N\u{c3}O", // "NÃO" em caixa alta
    "A\u{c7}\u{c3}O",
    "a\u{e7}\u{e3}o",
    "p\u{e2}ncreas",
    "\u{c3} ", // Ã seguido de espaço
    "fim\u{c3}", // Ã no fim da linha
  ];
  for (const sample of samples) {
    assertEquals(rulesOf(`texto ${sample}`, "doc.md"), [], sample);
  }
});

Deno.test("DraftSanitizer - detecta acento trocado por '?' no meio da palavra", () => {
  const question = "\u{3f}";
  const samples = [
    `n${question}o`,
    `informa${question}${question}o`,
    `A${question}${question}O`,
    `Voc${question}s`,
  ];
  for (const sample of samples) {
    assertEquals(rulesOf(`texto "${sample}", fim`, "doc.md"), ["question-mark-accent"], sample);
  }
});

Deno.test("DraftSanitizer - '?' de pergunta, URL, regex e ternário não são acento trocado", () => {
  const question = "\u{3f}";
  const samples = [
    `Qual \u{e9} o status${question}`,
    `ok${question}`,
    `https://example.com/p${question}id=1`,
    `const v = a${question}.b;`,
    `/colou${question}r/`,
    `x${question}y:z`,
    `a ${question}${question} b`,
    `a ${question} b : c`,
  ];
  for (const sample of samples) {
    assertEquals(rulesOf(sample, "code.ts"), [], sample);
  }
});

Deno.test("DraftSanitizer - detecta sequências mal escapadas em Markdown (`n)", () => {
  const samples = [
    "# T\u{ed}tulo`n`nEste \u{e9} um par\u{e1}grafo quebrado por codex`ncom mais texto.",
    "`n`n## Se\u{e7}\u{e3}o",
    "fim da frase.`nOutra linha",
  ];
  for (const sample of samples) {
    const report = sanitizeDraftText(sample, { filename: "README.md" });
    assertEquals(report.valid, false, sample);
    assertEquals(report.issues.map((issue) => issue.rule), ["corrupted-markdown-escape"], sample);
  }
});

Deno.test("DraftSanitizer - código inline, fence e span de crase dupla não são `n corrompido", () => {
  const samples = [
    "Use `npm test` e `name`.",
    "```nginx",
    "`` `n ``",
    "A sequ\u{ea}ncia (`n`) \u{e9} citada na documenta\u{e7}\u{e3}o.",
  ];
  for (const sample of samples) {
    assertEquals(rulesOf(sample, "README.md"), [], sample);
  }
});

Deno.test("DraftSanitizer - a regra de `n vale só para Markdown", () => {
  assertEquals(rulesOf("t\u{ed}tulo`n`ntexto", "code.ts"), []);
});

Deno.test("DraftSanitizer - detecta declare -A em scripts shell", () => {
  const sh = "#!/bin/bash\ndeclare -A MAPA_CONFIG\nMAPA_CONFIG['chave']='valor'";
  const report = sanitizeDraftText(sh, { filename: "setup.sh" });

  assertEquals(report.valid, false);
  assertEquals(report.issues.length, 1);
  assertEquals(report.issues[0].rule, "bash-declare-assoc");
  assertEquals(report.issues[0].line, 2);
});

Deno.test("DraftSanitizer - declare -a, comentário e declare -A fora de .sh não acusam", () => {
  assertEquals(rulesOf("declare -a LISTA\nLISTA=(a b)", "setup.sh"), []);
  assertEquals(rulesOf("  # sem `declare -A` no bash 3.2\nx=1", "setup.sh"), []);
  assertEquals(rulesOf("declare -A MAPA", "NOTAS.md"), []);
});

const jsdocOriginal = `
/**
 * Adiciona dois números inteiros.
 * @param a Primeiro valor
 * @param b Segundo valor
 */
export function add(a: number, b: number) {
  return a + b;
}

/** Subtrai dois números. */
export function sub(a: number, b: number) {
  return a - b;
}
`;

Deno.test("DraftSanitizer - remoção de todos os blocos JSDoc é erro e invalida o rascunho", () => {
  const draft = `
export function add(a: number, b: number) {
  return a + b;
}

export function sub(a: number, b: number) {
  return a - b;
}
`;
  const report = sanitizeDraftText(draft, { filename: "math.ts", originalText: jsdocOriginal });

  assertEquals(report.issues.length, 1);
  assertEquals(report.issues[0].rule, "stripped-jsdoc");
  assertEquals(report.issues[0].severity, "error");
  assertEquals(report.issues[0].line, 1);
  assertEquals(report.valid, false);
});

Deno.test("DraftSanitizer - remoção de apenas um bloco JSDoc também é erro", () => {
  const draft = `
/**
 * Adiciona dois números inteiros.
 */
export function add(a: number, b: number) {
  return a + b;
}

export function sub(a: number, b: number) {
  return a - b;
}
`;
  assertEquals(rulesOf(draft, "math.ts", jsdocOriginal), ["stripped-jsdoc"]);
});

Deno.test("DraftSanitizer - JSDoc reescrito, acrescentado ou sem base não acusa", () => {
  const reworded = jsdocOriginal.replace("Adiciona dois números inteiros.", "Soma dois inteiros.");
  assertEquals(rulesOf(reworded, "math.ts", jsdocOriginal), []);

  const extended = `${jsdocOriginal}\n/** Novo helper. */\nexport const x = 1;\n`;
  assertEquals(rulesOf(extended, "math.ts", jsdocOriginal), []);

  // Sem base (arquivo novo) e fora de arquivos de script não há comparação
  assertEquals(rulesOf("export const y = 2;\n", "novo.ts"), []);
  assertEquals(rulesOf("sem docs", "notas.md", jsdocOriginal), []);
});

Deno.test("scanDraftBytes - UTF-8 inválido é achado com a linha da substituição", () => {
  const bytes = new Uint8Array([0x61, 0x0a, 0x62, 0xff, 0x0a]);
  const report = scanDraftBytes(bytes, { filename: "code.ts" });

  assertEquals(report.valid, false);
  assertEquals(report.issues.map((issue) => [issue.rule, issue.line]), [["invalid-utf8", 2]]);
});

Deno.test("scanDraftBytes - UTF-8 válido com acentos é limpo", () => {
  const bytes = new TextEncoder().encode("a\u{e7}\u{e3}o n\u{e3}o\n");
  assertEquals(scanDraftBytes(bytes, { filename: "doc.md" }).issues, []);
});

Deno.test("scanDraftBytes - o BOM inicial é preservado e detectado", () => {
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);
  assertEquals(scanDraftBytes(withBom, { filename: "code.ts" }).issues.map((i) => i.rule), ["bom"]);
  assertEquals(scanDraftBytes(new Uint8Array([0x61]), { filename: "code.ts" }).issues, []);
});

Deno.test("scanDraftBytes - U+FFFD válido em UTF-8 é mojibake, não UTF-8 inválido", () => {
  const bytes = new Uint8Array([0x61, 0xef, 0xbf, 0xbd, 0x62]);
  assertEquals(scanDraftBytes(bytes, { filename: "doc.md" }).issues.map((i) => i.rule), [
    "mojibake",
  ]);
});
