// Avalia a heurística de falha transitória pelo texto (spike #558) contra conjuntos de cenários.
//
// Para cada fixture, compara quatro variantes da classificação:
//   baseline         — a baseline original (não lê o texto);
//   strict+guard     — baseline + padrões estritos, ignorando linhas de asserção de teste (proposta);
//   strict           — baseline + padrões estritos, sem a guarda;
//   loose            — baseline + padrões amplos ("network", "timeout", 50x solto), sem a guarda.
// Mostra acerto total e, para retry_operation, verdadeiros e falsos positivos.
//
// Uso:
//   deno run --allow-read scripts/transient-eval.ts <fixture.json> [...] [--aggregate-only] [--json]
// `--aggregate-only` omite ids e linhas casadas (use para fixtures de repositório privado).

import { loadScenarios, type Scenario } from "./decision-bench.ts";
import { allowedAlternatives } from "./lib/decision-adapter/policy.ts";
import { classifyBaseline } from "./lib/decision-adapter/baseline.ts";
import {
  detectTransient,
  LOOSE_PATTERNS,
  STRICT_PATTERNS,
} from "./lib/decision-adapter/transient.ts";
import type { Alternative } from "./lib/decision-adapter/types.ts";

type Variant = "baseline" | "strict+guard" | "strict" | "loose";
const VARIANTS: Variant[] = ["baseline", "strict+guard", "strict", "loose"];

function classify(s: Scenario, v: Variant): { action: Alternative; match?: string } {
  const base = classifyBaseline(s.context);
  if (v === "baseline" || base !== "inspect_failure") return { action: base };
  if (!allowedAlternatives(s.context).includes("retry_operation")) return { action: base };
  const m = detectTransient(s.context.errorSummary, {
    patterns: v === "loose" ? LOOSE_PATTERNS : STRICT_PATTERNS,
    guard: v === "strict+guard",
  });
  return m ? { action: "retry_operation", match: m.line } : { action: base };
}

export interface VariantReport {
  correct: number;
  total: number;
  retryTP: number;
  retryFP: number;
  retryFN: number;
  falsePositives: { id: string; line: string }[];
  falseNegatives: string[];
}

export function evaluate(scenarios: Scenario[]): Record<Variant, VariantReport> {
  const out = {} as Record<Variant, VariantReport>;
  for (const v of VARIANTS) {
    const r: VariantReport = {
      correct: 0,
      total: scenarios.length,
      retryTP: 0,
      retryFP: 0,
      retryFN: 0,
      falsePositives: [],
      falseNegatives: [],
    };
    for (const s of scenarios) {
      const { action, match } = classify(s, v);
      if (action === s.expected) r.correct++;
      if (action === "retry_operation" && s.expected === "retry_operation") r.retryTP++;
      if (action === "retry_operation" && s.expected !== "retry_operation") {
        r.retryFP++;
        r.falsePositives.push({ id: s.id, line: match ?? "(regra estruturada)" });
      }
      if (action !== "retry_operation" && s.expected === "retry_operation") {
        r.retryFN++;
        r.falseNegatives.push(s.id);
      }
    }
    out[v] = r;
  }
  return out;
}

if (import.meta.main) {
  const files = Deno.args.filter((a) => !a.startsWith("--"));
  const aggregate = Deno.args.includes("--aggregate-only");
  const all: Record<string, Record<Variant, VariantReport>> = {};
  for (const f of files) {
    const report = evaluate(loadScenarios(f));
    if (aggregate) {
      for (const v of VARIANTS) {
        report[v].falsePositives = [];
        report[v].falseNegatives = [];
      }
    }
    all[f.split("/").at(-1)!] = report;
  }
  if (Deno.args.includes("--json")) {
    console.log(JSON.stringify(all, null, 2));
  } else {
    for (const [f, report] of Object.entries(all)) {
      console.log(`\n## ${f}`);
      console.log("| variante | acerto | retry VP | retry FP | retry FN |");
      console.log("| --- | ---: | ---: | ---: | ---: |");
      for (const v of VARIANTS) {
        const r = report[v];
        console.log(
          `| ${v} | ${r.correct}/${r.total} | ${r.retryTP} | ${r.retryFP} | ${r.retryFN} |`,
        );
      }
      if (!aggregate) {
        for (const v of VARIANTS) {
          for (const fp of report[v].falsePositives) {
            console.log(`  FP ${v}: ${fp.id} — ${fp.line}`);
          }
          if (report[v].falseNegatives.length) {
            console.log(`  FN ${v}: ${report[v].falseNegatives.join(", ")}`);
          }
        }
      }
    }
  }
}
