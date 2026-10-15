// Leitura compacta do relatório produzido pelo CLI Graphify.
import { detectKnowledgeState, FilesystemKnowledgeProvider } from "./lib/knowledge.ts";
export interface GraphReportSummary {
  godNodes: string[];
  communities: string[];
}

export function parseGraphReport(
  markdown: string,
  options: { maxItems?: number } = {},
): GraphReportSummary {
  const maxItems = Math.max(0, options.maxItems ?? 10);
  const godNodes: string[] = [];
  const communities: string[] = [];
  let section = "";
  for (const line of markdown.split(/\r?\n/)) {
    if (/^##\s+God Nodes\b/i.test(line)) section = "gods";
    else if (/^##\s+Communities\b/i.test(line)) section = "communities";
    else if (/^##\s+/.test(line)) section = "";
    else if (section === "gods" && /^\s*\d+\.\s+/.test(line)) {
      if (godNodes.length < maxItems) godNodes.push(line.trim().replace(/^\d+\.\s+/, ""));
    } else if (section === "communities" && /^###\s+Community\s+/.test(line)) {
      if (communities.length < maxItems) communities.push(line.replace(/^###\s+/, "").trim());
    }
  }
  return { godNodes, communities };
}

export async function detectGraphify(
  executor: (command: string, args: string[]) => Promise<boolean> = runCommand,
): Promise<boolean> {
  return await executor("graphify", ["--help"]);
}

async function runCommand(command: string, args: string[]): Promise<boolean> {
  try {
    const child = new Deno.Command(command, { args, stdout: "null", stderr: "null" }).spawn();
    return (await child.status).success;
  } catch {
    return false;
  }
}

export async function saveGraphSummary(
  markdown: string,
  reportPath: string,
  options: { root?: string; knowledgeEnabled?: boolean } = {},
): Promise<{ summary: GraphReportSummary; knowledgePath?: string }> {
  const summary = parseGraphReport(markdown);
  if (options.knowledgeEnabled === false) return { summary };
  const compact = `# Cartografia arquitetural (Graphify)\n\nFonte: ${reportPath}\n\n## God nodes\n${
    summary.godNodes.map((item) => `- ${item}`).join("\n") || "- Não encontrados"
  }\n\n## Comunidades\n${
    summary.communities.map((item) => `- ${item}`).join("\n") || "- Não encontradas"
  }\n`;
  const provider = new FilesystemKnowledgeProvider(options.root ?? "docs");
  const path = "architecture/graphify-summary.md";
  if (await provider.exists?.(path)) await provider.update(path, compact);
  else await provider.create(path, compact);
  return { summary, knowledgePath: path };
}

async function main() {
  const reportPath = Deno.args[0] ?? "graphify-out/GRAPH_REPORT.md";
  let markdown: string;
  try {
    markdown = await Deno.readTextFile(reportPath);
  } catch {
    const graphifyInstalled = await detectGraphify();
    console.log(JSON.stringify({
      available: false,
      graphifyInstalled,
      hint:
        "Gere GRAPH_REPORT.md com a skill /graphify . no assistente; consulte https://github.com/Graphify-Labs/graphify/blob/v8/README.md",
    }));
    return;
  }
  let config = null;
  try {
    config = JSON.parse(await Deno.readTextFile(Deno.args[2] ?? ".claude/vetor/config.json"));
  } catch { /* Config ausente usa o provider padrão. */ }
  const state = detectKnowledgeState(config);
  const result = await saveGraphSummary(markdown, reportPath, {
    root: Deno.args[1] ?? "docs",
    knowledgeEnabled: state.status !== "disabled",
  });
  console.log(
    JSON.stringify({
      available: true,
      ...result.summary,
      ...(result.knowledgePath ? { knowledgePath: result.knowledgePath } : {}),
    }),
  );
}

if (import.meta.main) await main();
