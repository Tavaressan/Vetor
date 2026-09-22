// CLI invocado pelo issue-coordinator portado (opencode/agent/issue-coordinator.md,
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
//
// Issue #312: não há default embutido de provider/modelo. Um default assumindo `anthropic/...`
// direto falha com "Unexpected server error" (erro genérico do opencode real, sem pista da causa)
// em qualquer ambiente configurado só com outro provider (ex.: OpenRouter) — não há como adivinhar
// o provider certo sem heurística especulativa. Sem `fallback` explícito e sem `modelFallback.<tier>`
// em `.claude/vetor/config.json`, o script falha cedo (código 1, sem stdout) com mensagem acionável
// em vez de devolver um modelo que o `opencode run` downstream pode rejeitar.

import { readJson } from "./lib/project.ts";
import { resolveWorktree } from "./lib/status.ts";
import { pickHealthyModel, readModelHealthFile } from "./lib/model-health.ts";

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

/**
 * Issue #307: no Git Bash do Windows, `$(pwd)` produz um path POSIX-style (`/c/Users/...`), não
 * nativo (`C:\Users\...`). `Deno.Command`/`Deno.statSync` no Windows não resolvem esse formato —
 * `git rev-parse` falha ao spawnar (`No such cwd`) e `Deno.statSync` trata `/c/...` como relativo à
 * raiz da unidade atual, nunca encontrando o `config.json` real. Normaliza só no Windows (no
 * Linux/macOS `/c/Users/x` já é um path absoluto legítimo, nunca deve ser reescrito).
 */
export function normalizeCwd(cwd: string): string {
  if (Deno.build.os !== "windows") return cwd;
  const match = cwd.match(/^\/([a-zA-Z])\/(.*)$/);
  if (!match) return cwd;
  const [, drive, rest] = match;
  return `${drive.toUpperCase()}:/${rest}`;
}

/** `null` significa "sem lista resolvível" — nem `fallback` explícito, nem `modelFallback.<tier>`
 *  configurado em `config.json` (issue #312: sem default embutido, ver nota acima). */
function resolveFallbackList(root: string, input: Payload): string[] | null {
  if (input.fallback && input.fallback.length > 0) return input.fallback;

  const tier = input.tier ?? "simple";
  const configPath = `${root}/.claude/vetor/config.json`;
  if (exists(configPath)) {
    try {
      const config = readJson(configPath) as VetorConfig;
      const configured = config.modelFallback?.[tier];
      if (configured && configured.length > 0) return configured;
    } catch {
      // config.json ilegível: trata como "não configurado" — cai no erro acionável do main().
    }
  }

  return null;
}

async function main() {
  const raw = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer());

  let input: Payload;
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }

  const cwd = normalizeCwd(input.cwd ?? Deno.cwd());
  const worktree = await resolveWorktree(cwd);
  const root = worktree?.root ?? cwd;

  const tier = input.tier ?? "simple";
  const fallback = resolveFallbackList(root, input);
  if (!fallback) {
    const configPath = `${root}/.claude/vetor/config.json`;
    console.error(
      `modelFallback.${tier} não configurado em ${configPath} e nenhum "fallback" explícito foi ` +
        `passado. Configure "modelFallback.${tier}": ["<provider>/<model>", ...] em ` +
        `.claude/vetor/config.json com um provider/modelo válido para o ambiente atual (confira com ` +
        `"opencode models" e "opencode auth list") antes do primeiro dispatch.`,
    );
    Deno.exit(1);
  }

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
