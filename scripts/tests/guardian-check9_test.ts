import { assertEquals } from "@std/assert";

// Mock para simular a detecção de arquivos deletados e contagem de fan-in
interface DeletedFileAnalysis {
  filePath: string;
  fanIn: number;
  isHighRisk: boolean; // true se fan-in > 5
}

/**
 * Analisa arquivos deletados para detectar risco arquitetural via fan-in
 */
function analyzeDeletedFiles(
  deletedFiles: string[],
  fanInCounts: Record<string, number>,
): DeletedFileAnalysis[] {
  const threshold = 5; // fan-in threshold para risco alto
  return deletedFiles.map((file) => ({
    filePath: file,
    fanIn: fanInCounts[file] ?? 0,
    isHighRisk: (fanInCounts[file] ?? 0) > threshold,
  }));
}

/**
 * Valida se Check 9 detecta corretamente arquivos com alto fan-in
 */
Deno.test("Check 9: detecta arquivo deletado com alto fan-in", () => {
  const deletedFiles = ["lib/core/auth.ts"];
  const fanInCounts = {
    "lib/core/auth.ts": 8, // 8 referências — alto risco
  };

  const result = analyzeDeletedFiles(deletedFiles, fanInCounts);

  assertEquals(result.length, 1);
  assertEquals(result[0].filePath, "lib/core/auth.ts");
  assertEquals(result[0].fanIn, 8);
  assertEquals(result[0].isHighRisk, true); // threshold é 5, 8 > 5
});

Deno.test("Check 9: não marca como risco se fan-in é baixo", () => {
  const deletedFiles = ["lib/utils/deprecated-helper.ts"];
  const fanInCounts = {
    "lib/utils/deprecated-helper.ts": 2, // 2 referências — baixo risco
  };

  const result = analyzeDeletedFiles(deletedFiles, fanInCounts);

  assertEquals(result.length, 1);
  assertEquals(result[0].filePath, "lib/utils/deprecated-helper.ts");
  assertEquals(result[0].fanIn, 2);
  assertEquals(result[0].isHighRisk, false); // threshold é 5, 2 < 5
});

Deno.test("Check 9: threshold de 5 é exato", () => {
  const deletedFiles = [
    "exact-threshold.ts",
    "above-threshold.ts",
    "below-threshold.ts",
  ];
  const fanInCounts = {
    "exact-threshold.ts": 5, // exatamente no threshold
    "above-threshold.ts": 6, // acima do threshold
    "below-threshold.ts": 4, // abaixo do threshold
  };

  const result = analyzeDeletedFiles(deletedFiles, fanInCounts);

  assertEquals(result[0].isHighRisk, false); // 5 é não > 5
  assertEquals(result[1].isHighRisk, true); // 6 > 5
  assertEquals(result[2].isHighRisk, false); // 4 < 5
});

Deno.test("Check 9: detecta múltiplos arquivos deletados", () => {
  const deletedFiles = [
    "lib/high-risk.ts",
    "lib/low-risk.ts",
    "lib/medium-risk.ts",
  ];
  const fanInCounts = {
    "lib/high-risk.ts": 12,
    "lib/low-risk.ts": 1,
    "lib/medium-risk.ts": 5,
  };

  const result = analyzeDeletedFiles(deletedFiles, fanInCounts);

  assertEquals(result.length, 3);
  assertEquals(result.filter((r) => r.isHighRisk).length, 1); // apenas 1 é alto risco
  assertEquals(result[0].isHighRisk, true);
  assertEquals(result[1].isHighRisk, false);
  assertEquals(result[2].isHighRisk, false);
});

Deno.test("Check 9: arquivo sem referências não é risco", () => {
  const deletedFiles = ["lib/orphaned.ts"];
  const fanInCounts = {}; // nenhuma referência

  const result = analyzeDeletedFiles(deletedFiles, fanInCounts);

  assertEquals(result[0].fanIn, 0);
  assertEquals(result[0].isHighRisk, false);
});
