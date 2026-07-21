// CLI invocado pelo issue-coordinator portado (opencode/skills/issue-coordinator/SKILL.md,
// issue #84) antes de montar cada comando `opencode run --dir ... --model <provider/model>`.
//
// Lê a lista de fallback ordenada de `.claude/vetor/config.json` (`modelFallback.<tier>`) e
// `.claude/vetor/status/model-health.json` (escrito pelo hook `event` da issue #83), e devolve
// no stdout o primeiro modelo/provedor saudável da lista. Se todos estiverem `degraded` e não
// expirados, sai com código 1 e nada no stdout — o coordinator interpreta isso como "não
// despache este grupo agora, mantenha QUEUED" (ver critério de aceite da issue #84).
//
// Contrato de stdin:
//   { tier?: "simple" | "complex"; fallback?: string[]; cwd?: string }
// `fallback` explícito tem prioridade sobre `tier` (permite o coordinator sobrescrever a lista
// por grupo, ex.: resposta do usuário na Fase 2 do plano). Sem nenhum dos dois, usa `tier:
// "simple"`.

import { readJson } from "./lib/project.ts";
import { resolveWorktree } from "./lib/status.ts";
import { pickHealthyModel, readModelHealthFile } from "./lib/model-health.ts";

/** Default razoável documentado no README (issue #84) — usado só na ausência de
 *  `.claude/vetor/config.json` → `modelFallback` no projeto-alvo. */
export const DEFAULT_MODEL_FALLBACK: Record<"simple" | "complex", string[]> = {
  simple: ["anthropic/claude-haiku-4-5", "anthropic/claude-sonnet-4-5"],
  complex: ["anthropic/claude-sonnet-4-5", "anthropic/claude-haiku-4-5"],
};

interface Payload {
  tier?: "simple" | "complex";
  fallback?: string[];
  cwd?: string;
}

interface VetorConfig {
  modelFallback?: Record<string, string[]>;
}

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

function resolveFallbackList(root: string, input: Payload): string[] {
  if (input.fallback && input.fallback.length > 0) return input.fallback;

  const tier = input.tier ?? "simple";
  const configPath = `${root}/.claude/vetor/config.json`;
  if (exists(configPath)) {
    try {
      const config = readJson(configPath) as VetorConfig;
      const configured = config.modelFallback?.[tier];
      if (configured && configured.length > 0) return configured;
    } catch {
      // config.json ilegível: cai no default embutido em vez de travar o dispatch.
    }
  }

  return DEFAULT_MODEL_FALLBACK[tier];
}

async function main() {
  const raw = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer());

  let input: Payload;
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }

  const cwd = input.cwd ?? Deno.cwd();
  const worktree = await resolveWorktree(cwd);
  const root = worktree?.root ?? cwd;

  const fallback = resolveFallbackList(root, input);
  const health = readModelHealthFile(`${root}/.claude/vetor/status/model-health.json`);
  const chosen = pickHealthyModel(fallback, health, Date.now());

  if (!chosen) {
    console.error(
      `Todos os modelos da lista de fallback estão degraded: ${fallback.join(", ")}`,
    );
    Deno.exit(1);
  }

  console.log(chosen);
}

await main();
