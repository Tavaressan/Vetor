// Benchmark do Decision Adapter: compara a baseline determinística e o modelo local contra
// rótulos definidos a priori (scripts/tests/fixtures/decision-adapter/scenarios.json).
//
// Uso: deno run --allow-read --allow-net=localhost:11434 scripts/decision-bench.ts \
//        [--model <nome>] [--endpoint <url>] [--runs <N>] [--timeout <ms>] [--json]
//        [--fixture <path>]   (padrão: os cenários sintéticos; ex.: scenarios-real.json, #557)
//
// Sem `--model` só a baseline roda (nenhuma conexão). A baseline aplica as mesmas regras que as
// skills fix/ship descrevem em prosa, então também representa o comportamento original do Vetor.

import { classifyFailure } from "./lib/decision-adapter/classifier.ts";
import { DEFAULT_CONFIG, validateEndpoint } from "./lib/decision-adapter/config.ts";
import { parseFailureContext } from "./lib/decision-adapter/context.ts";
import { DecisionMetrics, type MetricsSnapshot } from "./lib/decision-adapter/metrics.ts";
import { OllamaDecisionProvider } from "./lib/decision-adapter/ollama.ts";
import type {
  Alternative,
  DecisionAdapterConfig,
  FailureContext,
} from "./lib/decision-adapter/types.ts";

const FIXTURE = new URL("./tests/fixtures/decision-adapter/scenarios.json", import.meta.url);

export interface Scenario {
  id: string;
  expected: Alternative;
  rationale: string;
  context: FailureContext;
}

export interface ScenarioOutcome {
  id: string;
  expected: Alternative;
  baseline: Alternative;
  /** Ação final de cada execução com o modelo (inclui fallbacks). */
  modelActions: Alternative[];
  /** Escolha crua aceita do modelo por execução, ou o motivo do fallback. */
  modelRaw: string[];
}

export interface BenchReport {
  scenarios: number;
  baselineCorrect: number;
  model?: {
    name: string;
    runs: number;
    /** Execuções em que a resposta do modelo foi aceita e estava correta. */
    modelCorrect: number;
    /** Execuções em que a ação final (com fallback) estava correta. */
    finalCorrect: number;
    total: number;
    metrics: MetricsSnapshot;
  };
  outcomes: ScenarioOutcome[];
}

export function loadScenarios(fixture: string | URL = FIXTURE): Scenario[] {
  const raw = JSON.parse(Deno.readTextFileSync(fixture)) as { scenarios: unknown[] };
  return raw.scenarios.map((s) => {
    const entry = s as Scenario;
    const parsed = parseFailureContext(entry.context);
    if (!parsed.ok) throw new Error(`cenário ${entry.id}: ${parsed.error}`);
    return { ...entry, context: parsed.context };
  });
}

export async function runBench(
  scenarios: Scenario[],
  options: { config?: DecisionAdapterConfig; provider?: OllamaDecisionProvider; runs?: number },
): Promise<BenchReport> {
  const runs = options.provider ? options.runs ?? 1 : 0;
  const metrics = new DecisionMetrics();
  const outcomes: ScenarioOutcome[] = [];
  let baselineCorrect = 0;
  let modelCorrect = 0;
  let finalCorrect = 0;

  for (const scenario of scenarios) {
    const off = await classifyFailure(scenario.context, { config: DEFAULT_CONFIG });
    if (off.action === scenario.expected) baselineCorrect++;
    const outcome: ScenarioOutcome = {
      id: scenario.id,
      expected: scenario.expected,
      baseline: off.action,
      modelActions: [],
      modelRaw: [],
    };
    for (let i = 0; i < runs; i++) {
      const result = await classifyFailure(scenario.context, {
        config: options.config!,
        provider: options.provider,
        metrics,
      });
      outcome.modelActions.push(result.action);
      if (result.action === scenario.expected) finalCorrect++;
      if (result.source === "model" && result.action === scenario.expected) modelCorrect++;
      outcome.modelRaw.push(
        result.source === "model"
          ? `${result.action} (${result.confidence?.toFixed(2) ?? "?"})`
          : result.source === "baseline"
          ? "— (regra rígida)"
          : `fallback:${result.fallbackReason}${
            result.modelChoice ? `/${result.modelChoice}` : ""
          }`,
      );
    }
    outcomes.push(outcome);
  }

  const report: BenchReport = { scenarios: scenarios.length, baselineCorrect, outcomes };
  if (options.provider) {
    report.model = {
      name: options.provider.model,
      runs,
      modelCorrect,
      finalCorrect,
      total: scenarios.length * runs,
      metrics: metrics.snapshot(),
    };
  }
  return report;
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function toMarkdown(report: BenchReport): string {
  const lines = [
    `Cenários: ${report.scenarios}`,
    `Baseline correta: ${report.baselineCorrect}/${report.scenarios}`,
  ];
  if (report.model) {
    const m = report.model;
    const l = m.metrics.latencyMs;
    lines.push(
      `Modelo ${m.name} (${m.runs} execução(ões) por cenário):`,
      `  aceito e correto: ${m.modelCorrect}/${m.total} | ação final correta (com fallback): ${m.finalCorrect}/${m.total}`,
      `  chamadas: ${m.metrics.modelCalls} | válidas: ${m.metrics.valid} | rejeitadas: ${m.metrics.rejected} | fallbacks: ${m.metrics.fallbacks} | timeouts: ${m.metrics.timeouts}`,
      `  divergências da baseline (respostas aceitas): ${m.metrics.disagreements}`,
      `  latência ms: média ${l.mean.toFixed(0)} | p50 ${l.p50.toFixed(0)} | p95 ${
        l.p95.toFixed(0)
      } | p99 ${l.p99.toFixed(0)} | máx ${l.max.toFixed(0)}`,
      `  motivos de fallback: ${JSON.stringify(m.metrics.fallbackReasons)}`,
    );
  }
  lines.push("", "| cenário | esperado | baseline | modelo |", "|---|---|---|---|");
  for (const o of report.outcomes) {
    const mark = (a: Alternative) => a === o.expected ? "✓" : "✗";
    lines.push(
      `| ${o.id} | ${o.expected} | ${o.baseline} ${mark(o.baseline)} | ${
        o.modelRaw.join(", ") || "—"
      } |`,
    );
  }
  return lines.join("\n");
}

async function main() {
  const args = Deno.args;
  const model = flag(args, "--model");
  let config: DecisionAdapterConfig | undefined;
  let provider: OllamaDecisionProvider | undefined;
  if (model) {
    const endpoint = validateEndpoint(flag(args, "--endpoint") ?? DEFAULT_CONFIG.endpoint);
    if (!endpoint) {
      console.error("--endpoint deve ser loopback (localhost, 127.0.0.1, [::1])");
      Deno.exit(2);
    }
    config = {
      ...DEFAULT_CONFIG,
      enabled: true,
      endpoint,
      model,
      timeoutMs: Number(flag(args, "--timeout") ?? DEFAULT_CONFIG.timeoutMs),
    };
    provider = new OllamaDecisionProvider(endpoint, model);
  }
  const report = await runBench(loadScenarios(flag(args, "--fixture") ?? FIXTURE), {
    config,
    provider,
    runs: Number(flag(args, "--runs") ?? 1),
  });
  console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : toMarkdown(report));
}

if (import.meta.main) await main();
