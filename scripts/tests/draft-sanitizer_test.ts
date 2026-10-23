import { assertEquals } from "@std/assert";
import { sanitizeDraftText } from "../lib/draft-sanitizer.ts";

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

Deno.test("DraftSanitizer - detecta caracteres de controle crus e UTF-8 corrompido", () => {
  const corrupted = "const str = 'teste\x00nulo';\nconst broken = 'acentua\uFFFD\uFFFDo';";
  const report = sanitizeDraftText(corrupted, { filename: "code.ts" });

  assertEquals(report.valid, false);
  assertEquals(report.issues.length, 2);
  assertEquals(report.issues[0].rule, "utf8-control-chars");
  assertEquals(report.issues[0].line, 1);
  assertEquals(report.issues[1].rule, "utf8-control-chars");
  assertEquals(report.issues[1].line, 2);
});

Deno.test("DraftSanitizer - detecta sequências mal escapadas em Markdown (`n)", () => {
  const md = "# Título`n`nEste é um parágrafo quebrado por codex`ncom mais texto.";
  const report = sanitizeDraftText(md, { filename: "README.md" });

  assertEquals(report.valid, false);
  assertEquals(report.issues.length, 1);
  assertEquals(report.issues[0].rule, "corrupted-markdown-escape");
});

Deno.test("DraftSanitizer - detecta declare -A em scripts shell", () => {
  const sh = "#!/bin/bash\ndeclare -A MAPA_CONFIG\nMAPA_CONFIG['chave']='valor'";
  const report = sanitizeDraftText(sh, { filename: "setup.sh" });

  assertEquals(report.valid, false);
  assertEquals(report.issues.length, 1);
  assertEquals(report.issues[0].rule, "bash-declare-assoc");
  assertEquals(report.issues[0].line, 2);
});

Deno.test("DraftSanitizer - detecta remoção involuntária de blocos JSDoc", () => {
  const original = `
/**
 * Adiciona dois números inteiros.
 * @param a Primeiro valor
 * @param b Segundo valor
 */
export function add(a: number, b: number) {
  return a + b;
}
`;

  const draft = `
export function add(a: number, b: number) {
  return a + b;
}
`;

  const report = sanitizeDraftText(draft, {
    filename: "math.ts",
    originalText: original,
  });

  // JSDoc removido gera warning
  assertEquals(report.issues.length, 1);
  assertEquals(report.issues[0].rule, "stripped-jsdoc");
  assertEquals(report.issues[0].severity, "warning");
  assertEquals(report.valid, true); // warning não bloqueia por padrão
});
