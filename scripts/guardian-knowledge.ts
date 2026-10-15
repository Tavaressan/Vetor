import { checkAiMemory } from "./ai-memory-check.ts";

export const GRAPH_STALENESS_THRESHOLD = 5;

export async function auditGraphFreshness(
  repo = Deno.cwd(),
  threshold = GRAPH_STALENESS_THRESHOLD,
): Promise<string> {
  const paths = ["graphify-out/graph.json", "graphify-out/GRAPH_REPORT.md"];
  const mtimes: number[] = [];
  for (const path of paths) {
    try {
      mtimes.push((await Deno.stat(`${repo}/${path}`)).mtime?.getTime() ?? 0);
    } catch {
      return `Informativo: Graphify ignorado; artefato ausente (${path}).`;
    }
  }
  const generatedAt = new Date(Math.min(...mtimes));
  const since = generatedAt.toISOString().replace(/\.\d{3}Z$/, "Z");
  const result = await new Deno.Command("git", {
    args: ["rev-list", "--count", `--since=${since}`, "HEAD"],
    cwd: repo,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  const count = Number(new TextDecoder().decode(result.stdout).trim());
  return count > threshold
    ? `Aviso: Graphify desatualizado; ${count} commits desde os artefatos (limiar: ${threshold}).`
    : `Graphify atualizado; ${count} commits desde os artefatos (limiar: ${threshold}).`;
}

export async function auditAiMemory(
  configPath = ".mcp.json",
  check: typeof checkAiMemory = checkAiMemory,
): Promise<string> {
  let config: { mcpServers?: Record<string, { type?: string; url?: string }> };
  try {
    config = JSON.parse(await Deno.readTextFile(configPath));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "Informativo: ai-memory não configurado.";
    throw error;
  }
  const server = config.mcpServers?.["ai-memory"];
  if (!server || server.type !== "http" || !server.url) {
    return "Informativo: ai-memory não declarado como servidor HTTP.";
  }
  try {
    await check(server.url);
    return "ai-memory respondeu ao initialize/tools/list/memory_status.";
  } catch (error) {
    return `Aviso: servidor ai-memory indisponível: ${
      error instanceof Error ? error.message : error
    }`;
  }
}

if (import.meta.main) {
  console.log(await auditGraphFreshness());
  console.log(await auditAiMemory());
}
