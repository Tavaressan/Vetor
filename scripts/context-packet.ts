// CLI do ContextPacket (RF-07, issue #496) — monta o JSON que o coordinator injeta no prompt do
// issue-worker. Uma SKILL.md é prosa interpretada por um agente e não importa TypeScript; este
// wrapper expõe scripts/lib/orchestrator/context-packet.ts (mesmo padrão de spec-validate.ts).
//
// Uso:
//   deno run -A scripts/context-packet.ts (--issue <N> | --issue-json <path>) \
//     --module-test-map <path> --slug <slug> --branch <branch> --base <default-branch> \
//     [--worktree <path>] [--conventions <texto>] [--target-files <a,b>] \
//     [--repo-root <path>] [--format json|prompt]
//
// `--issue <N>` busca título e body com `gh issue view`; `--issue-json` lê um arquivo
// `{ number, title, body }` (uso offline e testes). `--module-test-map` é o arquivo resolvido a
// partir do root do repositório (project-conventions.md), nunca do cwd do worktree.
// `--target-files` (separados por vírgula) substitui os arquivos inferidos do título e do body.
// `--worktree` é omitido no primeiro dispatch com `isolation: "worktree"`, quando o path ainda
// não existe.
//
// Opcional: `--micro-spec <path>` injeta a micro-spec JIT (issue #501) em `context.microSpec`.
// Repo Map (issue #507, RF-04 de docs/specs/repo-map-ast-context-packet.md): com
// `--repo-root <path>` o CLI gera o mapa escopado (módulo + arquivos-alvo do pacote) a partir desse
// root e o grava em `context.repoMap`. O ponto de integração é este CLI, e não o
// prepare-worktree.ts da Spec, porque o pacote é montado no dispatch, antes de o worktree existir;
// o root do repositório principal também é onde mora o cache compartilhado, então o mapa não nasce
// frio em cada worktree. Falha ao gerar o mapa é aviso: o pacote sai sem o campo.
// `--format prompt` emite o bloco `json` (sem o mapa) seguido da tag `<repo_map>`, pronto para abrir
// o prompt do worker; o padrão (`json`) emite só o JSON do pacote.

import {
  buildContextPacket,
  type ContextPacket,
  renderContextPacketPrompt,
} from "./lib/orchestrator/context-packet.ts";
import { validateMicroSpec } from "./lib/orchestrator/micro-spec.ts";
import { run } from "./lib/project.ts";
import { buildRepoMap } from "./repo-map.ts";

interface IssueData {
  number: number;
  title: string;
  body: string;
}

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx === -1 ? undefined : args[idx + 1];
}

function fail(message: string): never {
  console.error(`context-packet: ${message}`);
  Deno.exit(1);
}

function requireFlag(args: string[], flag: string): string {
  return flagValue(args, flag) ?? fail(`flag obrigatória ausente: ${flag}`);
}

// Fronteira externa (arquivo ou saída do `gh`): confere o formato antes de usar.
function parseIssue(raw: string, origin: string): IssueData {
  let data: Partial<Record<keyof IssueData, unknown>>;
  try {
    data = JSON.parse(raw);
  } catch {
    return fail(`${origin} não é JSON válido`);
  }
  if (
    typeof data?.number !== "number" || typeof data.title !== "string" ||
    (data.body !== null && typeof data.body !== "string")
  ) {
    return fail(`${origin} precisa ter { number: número, title: texto, body: texto }`);
  }
  return { number: data.number, title: data.title, body: data.body ?? "" };
}

async function loadIssue(args: string[]): Promise<IssueData> {
  const issueJson = flagValue(args, "--issue-json");
  if (issueJson) return parseIssue(await Deno.readTextFile(issueJson), "--issue-json");

  const issueRef = flagValue(args, "--issue") ?? fail("informe --issue <N> ou --issue-json <path>");
  if (!/^\d+$/.test(issueRef)) fail(`--issue deve ser um número de issue, recebido: ${issueRef}`);

  const result = await run(
    "gh",
    ["issue", "view", issueRef, "--json", "number,title,body"],
    Deno.cwd(),
  );
  if (result.code !== 0) fail(`gh issue view ${issueRef} falhou: ${result.stderr.trim()}`);
  return parseIssue(result.stdout, `gh issue view ${issueRef}`);
}

// `--micro-spec <path>` (issue #501): micro-spec JIT escrita pelo coordinator num arquivo (nunca na
// linha de comando). O texto vem de um modelo leve, então é validado antes de entrar no pacote; se
// for inválido a CLI falha e o coordinator despacha sem micro-spec.
async function loadMicroSpec(args: string[]): Promise<string | undefined> {
  const path = flagValue(args, "--micro-spec");
  if (path === undefined) return undefined;
  const content = await Deno.readTextFile(path).catch(() =>
    fail(`não consegui ler --micro-spec: ${path}`)
  );
  const problems = validateMicroSpec(content);
  if (problems.length > 0) fail(`micro-spec inválida: ${problems.join("; ")}`);
  return content;
}

// O mapa é um complemento: qualquer falha vira aviso em stderr e o pacote segue sem `repoMap`.
async function generateRepoMap(
  root: string,
  packet: ContextPacket,
  moduleTestMap: string,
): Promise<string | undefined> {
  try {
    const result = await buildRepoMap({
      root,
      module: packet.context.module,
      moduleTestMap,
      files: packet.context.targetFiles,
    });
    for (const warning of result.warnings) console.error(`context-packet: repo-map: ${warning}`);
    return result.markdown === "" ? undefined : result.markdown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`context-packet: repo-map omitido: ${message}`);
    return undefined;
  }
}
}

if (import.meta.main) {
  const args = Deno.args;
  const moduleTestMapPath = requireFlag(args, "--module-test-map");
  const slug = requireFlag(args, "--slug");
  const branch = requireFlag(args, "--branch");
  const baseBranch = requireFlag(args, "--base");
  const format = flagValue(args, "--format") ?? "json";
  if (format !== "json" && format !== "prompt") {
    fail(`--format deve ser "json" ou "prompt", recebido: ${format}`);
  }

  const issue = await loadIssue(args);
  const moduleTestMap = await Deno.readTextFile(moduleTestMapPath).catch(() =>
    fail(`não consegui ler --module-test-map: ${moduleTestMapPath}`)
  );

  try {
    const input = {
      issue,
      slug,
      worktree: { path: flagValue(args, "--worktree"), branch, baseBranch },
      moduleTestMap,
      microSpec: await loadMicroSpec(args),
      conventions: flagValue(args, "--conventions"),
      targetFiles: flagValue(args, "--target-files")?.split(",").map((file) => file.trim())
        .filter(Boolean),
    };
    let packet = buildContextPacket(input);
    // O mapa depende do módulo e dos arquivos-alvo que o próprio pacote acabou de resolver.
    const repoRoot = flagValue(args, "--repo-root");
    const repoMap = repoRoot ? await generateRepoMap(repoRoot, packet, moduleTestMap) : undefined;
    if (repoMap !== undefined) packet = buildContextPacket({ ...input, repoMap });

    if (format === "prompt") console.info(renderContextPacketPrompt(packet));
    else console.log(JSON.stringify(packet, null, 2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
