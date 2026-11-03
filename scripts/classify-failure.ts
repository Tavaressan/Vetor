// Classifica uma falha de teste/build e recomenda o próximo passo (Decision Adapter experimental,
// docs/investigations/decision-adapter.md). Só recomenda — nunca executa a ação.
//
// Uso: echo '<FailureContext JSON>' | deno run --allow-read --allow-net=localhost:11434 \
//        scripts/classify-failure.ts [--config <path>]
//
// Com `decisionAdapter.enabled` ausente ou false (default) responde só com a baseline
// determinística e não abre conexão nenhuma. `--allow-net` só é necessário com o experimento
// ligado; sem ele a chamada cai no fallback com `network_denied`.
//
// Exit 0 + DecisionResult JSON no stdout. Exit 2 se o contexto de entrada for inválido.

import { classifyFailure } from "./lib/decision-adapter/classifier.ts";
import { loadConfig } from "./lib/decision-adapter/config.ts";
import { parseFailureContext } from "./lib/decision-adapter/context.ts";
import { DecisionMetrics } from "./lib/decision-adapter/metrics.ts";
import { OllamaDecisionProvider } from "./lib/decision-adapter/ollama.ts";

const DEFAULT_CONFIG_PATH = ".claude/vetor/config.json";

function configPathFromArgs(args: string[]): string {
  const index = args.indexOf("--config");
  return index >= 0 && args[index + 1] ? args[index + 1] : DEFAULT_CONFIG_PATH;
}

async function main() {
  const { config, errors } = loadConfig(configPathFromArgs(Deno.args));
  for (const error of errors) console.error(`[decision-adapter] config ignorada: ${error}`);

  let raw: unknown;
  try {
    raw = JSON.parse(await new Response(Deno.stdin.readable).text());
  } catch {
    console.error("[decision-adapter] stdin não é JSON válido");
    Deno.exit(2);
  }
  const parsed = parseFailureContext(raw);
  if (!parsed.ok) {
    console.error(`[decision-adapter] ${parsed.error}`);
    Deno.exit(2);
  }

  const metrics = new DecisionMetrics();
  const provider = config.enabled
    ? new OllamaDecisionProvider(config.endpoint, config.model)
    : undefined;
  const result = await classifyFailure(parsed.context, { config, provider, metrics });

  if (config.debug) {
    console.error(`[decision-adapter] ${JSON.stringify(metrics.snapshot())}`);
    if (result.fallbackDetail) {
      console.error(`[decision-adapter] fallback: ${result.fallbackDetail}`);
    }
  }
  // O detalhe pode ecoar a mensagem de erro do servidor: só aparece com debug, e no stderr.
  delete result.fallbackDetail;
  console.log(JSON.stringify(result));
}

if (import.meta.main) await main();
