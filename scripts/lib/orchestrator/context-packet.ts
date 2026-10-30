/**
 * ContextPacket (RF-07 de docs/specs/pipeline-ship-e-delegacao-eficiente.md, issue #496).
 *
 * Pacote JSON que o coordinator injeta no prompt inaugural do issue-worker com o que ele já
 * determinou no planejamento — critérios de aceite, módulo, comando de teste e arquivos-alvo —
 * para o worker não gastar as primeiras tool calls redescobrindo isso. Extensões entram como
 * campos opcionais em `ContextPacketContext` (ex.: `repoMap`, da Spec repo-map-ast).
 */

import { microSpecPath } from "./micro-spec.ts";

/** Identificador/versão do formato, gravado em `$schema` de todo pacote. */
export const CONTEXT_PACKET_SCHEMA = "https://vetor.dev/schemas/context-packet.v1.json";

export interface ContextPacketIssue {
  number: number;
  title: string;
  /** kebab-case, o mesmo usado na branch (`<type>/<issue#>-<slug>`). */
  slug: string;
  acceptanceCriteria: string[];
}

export interface ContextPacketWorktree {
  /**
   * Path absoluto do worktree. Ausente no primeiro dispatch com `isolation: "worktree"`: o harness
   * cria o worktree depois e o coordinator ainda não conhece o path; o worker usa o cwd.
   */
  path?: string;
  branch: string;
  baseBranch: string;
}

export interface ContextPacketContext {
  /** Módulo do `module-test-map.md` ao qual a issue pertence. */
  module: string;
  /** Comando headless do módulo, copiado do `module-test-map.md`. */
  testCommand: string;
  /** Arquivos com probabilidade de alteração: dica para começar, não restrição. */
  targetFiles: string[];
  /**
   * Micro-spec JIT (issue #501): escopo de uma página sintetizado no dispatch de uma issue
   * não-trivial sem Spec. O worker grava `content` em `path`, dentro do próprio worktree.
   */
  microSpec?: ContextPacketMicroSpec;
  conventions?: string;
  /**
   * Repo Map escopado (Markdown, `scripts/repo-map.ts`) com as assinaturas do módulo e dos vizinhos
   * imediatos. No prompt do worker ele vai na tag `<repo_map>` (ver `renderContextPacketPrompt`).
   */
  repoMap?: string;
}

export interface ContextPacketMicroSpec {
  /** `docs/specs/micro/<issue#>-<slug>.md`, relativo ao worktree. */
  path: string;
  content: string;
}

export interface ContextPacket {
  $schema: string;
  issue: ContextPacketIssue;
  worktree: ContextPacketWorktree;
  context: ContextPacketContext;
}

export interface ModuleTestMap {
  /** Módulo -> comando headless (tabela "Comandos por módulo"). */
  commands: Record<string, string>;
  /** Tabela "Detecção de módulo por arquivos alterados", na ordem do arquivo. */
  prefixes: { prefix: string; module: string }[];
}

export interface BuildContextPacketInput {
  issue: { number: number; title: string; body: string };
  slug: string;
  worktree: ContextPacketWorktree;
  /** Conteúdo do `module-test-map.md` resolvido a partir do root do repositório. */
  moduleTestMap: string;
  /** Conteúdo da micro-spec JIT já validado por `validateMicroSpec` (issue #501). */
  microSpec?: string;
  conventions?: string;
  /** Sobrescreve a inferência de arquivos-alvo a partir do título e do body. */
  targetFiles?: string[];
  /** Repo Map já gerado para o módulo/arquivos-alvo; é gravado em `context.repoMap`. */
  repoMap?: string;
}

const CHECKLIST_ITEM_RE = /^[ \t]*[-*][ \t]+\[[ xX]\][ \t]+(.+?)[ \t]*$/gm;

/** Itens de checklist (`- [ ]` / `- [x]`) do body: os critérios de aceite da issue. */
export function extractAcceptanceCriteria(body: string): string[] {
  return [...body.matchAll(CHECKLIST_ITEM_RE)].map((match) => match[1]);
}

const BACKTICK_TOKEN_RE = /`([^`\n]+)`/g;
const PATH_TOKEN_RE = /^[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z][A-Za-z0-9]*$/;
// Sem barra, só extensões de arquivo de projeto: evita tomar `Deno.test` ou `fs.existsSync` por path.
const ROOT_FILE_EXTENSIONS = new Set([
  "cjs",
  "js",
  "json",
  "jsonc",
  "lock",
  "md",
  "mjs",
  "toml",
  "ts",
  "yaml",
  "yml",
]);

/** Paths de arquivo citados entre crases no título/body, sem repetição, na ordem de aparição. */
export function extractTargetFiles(text: string): string[] {
  const files = new Set<string>();
  for (const match of text.matchAll(BACKTICK_TOKEN_RE)) {
    const token = match[1].trim().replaceAll("\\", "/");
    if (!PATH_TOKEN_RE.test(token)) continue;
    const extension = token.slice(token.lastIndexOf(".") + 1);
    if (token.includes("/") || ROOT_FILE_EXTENSIONS.has(extension)) files.add(token);
  }
  return [...files];
}

/** Lê as tabelas de comandos e de prefixos de um `module-test-map.md`. */
export function parseModuleTestMap(markdown: string): ModuleTestMap {
  const map: ModuleTestMap = { commands: {}, prefixes: [] };
  let table: "commands" | "prefixes" | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      table = null;
      continue;
    }
    const cells = trimmed.replace(/^\||\|$/g, "").split("|")
      .map((cell) => cell.trim().replace(/^`+|`+$/g, ""));

    if (/^m[óo]dulo$/i.test(cells[0])) table = "commands";
    else if (/^prefixo/i.test(cells[0])) table = "prefixes";
    else if (/^:?-+:?$/.test(cells[0]) || !cells[1]) continue;
    else if (table === "commands") map.commands[cells[0]] = cells[1];
    else if (table === "prefixes") map.prefixes.push({ prefix: cells[0], module: cells[1] });
  }
  return map;
}

/** Módulo que recebe os arquivos sem prefixo: o do `./` do mapa, ou o primeiro da tabela de comandos. */
export function catchAllModule(map: ModuleTestMap): string | undefined {
  return map.prefixes.find((entry) => entry.prefix === "./")?.module ??
    Object.keys(map.commands)[0];
}

/**
 * Módulo da issue a partir dos arquivos-alvo: cada arquivo vai para o módulo do prefixo mais
 * longo; vence o módulo com mais arquivos (empate: o primeiro a aparecer). Arquivo sem prefixo,
 * ou lista vazia, cai no módulo `./` do mapa (ou no primeiro da tabela de comandos).
 */
export function resolveModule(files: string[], map: ModuleTestMap): string {
  const fallback = catchAllModule(map);
  if (!fallback) throw new Error("module-test-map sem módulos: rode /vetor:install.");

  const counts = new Map<string, number>();
  for (const file of files) {
    let best: { prefix: string; module: string } | undefined;
    for (const entry of map.prefixes) {
      if (entry.prefix === "./" || !file.startsWith(entry.prefix)) continue;
      if (!best || entry.prefix.length > best.prefix.length) best = entry;
    }
    const module = best?.module ?? fallback;
    counts.set(module, (counts.get(module) ?? 0) + 1);
  }

  let winner = fallback;
  let max = 0;
  for (const [module, count] of counts) {
    if (count > max) {
      winner = module;
      max = count;
    }
  }
  return winner;
}

export function buildContextPacket(input: BuildContextPacketInput): ContextPacket {
  const { issue, slug, worktree, moduleTestMap, conventions, repoMap } = input;
  const targetFiles = input.targetFiles ?? extractTargetFiles(`${issue.title}\n${issue.body}`);

  const map = parseModuleTestMap(moduleTestMap);
  const module = resolveModule(targetFiles, map);
  const testCommand = map.commands[module];
  if (testCommand === undefined) {
    throw new Error(`module-test-map sem comando para o módulo "${module}": rode /vetor:install.`);
  }

  return {
    $schema: CONTEXT_PACKET_SCHEMA,
    issue: {
      number: issue.number,
      title: issue.title,
      slug,
      acceptanceCriteria: extractAcceptanceCriteria(issue.body),
    },
    worktree: {
      ...(worktree.path !== undefined && { path: worktree.path }),
      branch: worktree.branch,
      baseBranch: worktree.baseBranch,
    },
    context: {
      module,
      testCommand,
      targetFiles,
      ...(input.microSpec !== undefined && {
        microSpec: { path: microSpecPath(issue.number, slug), content: input.microSpec },
      }),
      ...(conventions !== undefined && { conventions }),
      ...(repoMap !== undefined && { repoMap }),
    },
  };
}

/**
 * Texto que abre o prompt do worker: o pacote em um bloco `json` e, se houver, o Repo Map na tag
 * `<repo_map>`. O mapa é Markdown com cercas de código; escapado dentro de uma string JSON viraria
 * uma linha ilegível, então ele sai do JSON e vai logo depois, em texto corrido.
 */
export function renderContextPacketPrompt(packet: ContextPacket): string {
  const { repoMap, ...context } = packet.context;
  const json = JSON.stringify({ ...packet, context }, null, 2);
  const block = "```json\n" + json + "\n```";
  return repoMap === undefined
    ? block
    : `${block}\n\n<repo_map>\n${repoMap.trimEnd()}\n</repo_map>`;
}
