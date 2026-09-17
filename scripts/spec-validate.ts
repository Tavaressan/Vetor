// CLI de `/vetor:spec-validate` (#220) — valida a qualidade de uma Spec já persistida (path em
// disco) contra o Quality Model (spec-quality.ts) usando os dimension checkers de
// spec-quality-checkers.ts, e imprime um Quality Report em markdown (Score/Status/Strengths/
// Gaps/Suggestions).
//
// Uso:
//   deno run -A scripts/spec-validate.ts <path> [--config <path>]
//
// Mesmo padrão de scripts/knowledge-doc.ts: uma SKILL.md é prosa interpretada por um agente e não
// pode importar módulos TypeScript diretamente — este wrapper expõe scripts/lib/spec-quality*.ts
// como CLI para skills/spec-validate/SKILL.md e para uso interno de skills/spec/SKILL.md.

import { parseSpec } from "./lib/spec-parser.ts";
import {
  checkClarity,
  checkCompleteness,
  checkEdgeCases,
  checkScope,
  checkTestability,
} from "./lib/spec-quality-checkers.ts";
import { computeQuality, type QualityResult, resolveThresholds } from "./lib/spec-quality.ts";

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx === -1 ? undefined : args[idx + 1];
}

async function readConfig(path: string): Promise<unknown> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return null;
  }
}

export function validateSpecText(text: string, config?: unknown): QualityResult {
  const parsed = parseSpec(text);
  return computeQuality(
    {
      completeness: checkCompleteness(parsed),
      testability: checkTestability(parsed),
      clarity: checkClarity(parsed),
      scope: checkScope(parsed),
      edgeCases: checkEdgeCases(parsed),
    },
    resolveThresholds(config as Parameters<typeof resolveThresholds>[0]),
  );
}

function list(items: string[], emptyLabel: string): string {
  return items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : `- ${emptyLabel}`;
}

export function renderReport(specPath: string, result: QualityResult): string {
  const dimensionRows =
    (Object.entries(result.dimensions) as [string, { score: number; max: number }][])
      .map(([dim, d]) => `| ${dim} | ${d.score}/${d.max} |`)
      .join("\n");

  return [
    "# Spec Quality Report",
    "",
    `Spec: ${specPath}`,
    "",
    `Score: ${result.score}/100`,
    `Status: ${result.gate}`,
    "",
    "## Dimensions",
    "",
    "| Dimension | Score |",
    "|---|---:|",
    dimensionRows,
    "",
    "## Strengths",
    "",
    list(result.strengths, "Nenhum ponto forte identificado."),
    "",
    "## Gaps",
    "",
    list(result.gaps, "Nenhum gap identificado."),
    "",
    "## Suggestions",
    "",
    list(result.suggestions, "Nenhuma sugestão identificada."),
    "",
  ].join("\n");
}

async function main() {
  const [specPath, ...rest] = Deno.args;
  if (!specPath) {
    console.error("Uso: spec-validate.ts <path> [--config <path>]");
    Deno.exit(1);
  }

  let text: string;
  try {
    text = await Deno.readTextFile(specPath);
  } catch (err) {
    console.error(`ERRO: não foi possível ler "${specPath}": ${(err as Error).message}`);
    Deno.exit(1);
    return;
  }

  const configPath = flagValue(rest, "--config") ?? ".claude/vetor/config.json";
  const config = await readConfig(configPath);
  const result = validateSpecText(text, config);
  console.log(renderReport(specPath, result));
}

if (import.meta.main) {
  await main();
}
