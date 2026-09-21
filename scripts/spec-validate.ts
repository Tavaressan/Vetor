// CLI de `/vetor:spec-validate` (#220-#222) — valida a qualidade de uma Spec já persistida (path
// em disco) contra o Quality Model (spec-quality.ts) usando os dimension checkers de
// spec-quality-checkers.ts, imprime um Quality Report em Markdown (spec-quality-report.ts) e
// mantém o histórico de refinamento (spec-quality-persistence.ts) separado do arquivo da Spec.
//
// Uso:
//   deno run -A scripts/spec-validate.ts <path> [--config <path>] [--history <path>]
//
// `--history`: opcional — sobrescreve onde o estado de validação é persistido (default:
// derivado do path da Spec via `validationPathFor`, ver spec-quality-persistence.ts). Existe
// principalmente para os testes de integração deste CLI não escreverem em
// `.claude/vetor/specs/` durante a suíte.
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
import { appendValidation, renderQualityReport } from "./lib/spec-quality-report.ts";
import {
  loadValidationState,
  resolveDefaultHistoryPath,
  saveValidationState,
} from "./lib/spec-quality-persistence.ts";

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
    resolveThresholds(config),
  );
}

async function main() {
  const [specPath, ...rest] = Deno.args;
  if (!specPath) {
    console.error("Uso: spec-validate.ts <path> [--config <path>] [--history <path>]");
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
  const historyPath = flagValue(rest, "--history") ?? await resolveDefaultHistoryPath(specPath);

  const config = await readConfig(configPath);
  const result = validateSpecText(text, config);

  const existingState = await loadValidationState(historyPath);
  const { history, capReached } = appendValidation(existingState?.history ?? [], {
    timestamp: new Date().toISOString(),
    score: result.score,
    gate: result.gate,
  });

  if (!capReached) {
    await saveValidationState(historyPath, { specPath, history });
  }

  console.info(renderQualityReport(specPath, result, { history }));

  if (capReached) {
    console.info(
      `\nLimite de ${history.length - 1} ciclos de refinamento automático já foi atingido para ` +
        "esta Spec — revisão manual necessária antes de validar novamente (#203 §10). O histórico " +
        "acima não inclui esta tentativa.",
    );
  }
}

if (import.meta.main) {
  await main();
}
