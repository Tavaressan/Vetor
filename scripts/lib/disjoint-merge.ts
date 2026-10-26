// Detecção de conjuntos disjuntos de arquivos e módulos para fast-path de squash merge (Issue #495, RF-03/RF-04).
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface TouchedFilesCache {
  branch: string;
  head?: string;
  generated_at?: string;
  default_branch?: string;
  modules?: Record<string, string[]>;
  files: string[];
}

export interface DisjointResult {
  disjoint: boolean;
  overlappingFiles: string[];
  overlappingModules: string[];
}

export interface BranchOverlap extends DisjointResult {
  branch: string;
}

/** Executa `git <args>` no repositório e devolve o stdout, ou null se o git sair com erro. */
export type GitRunner = (args: string[]) => string | null;

export interface ModulePrefix {
  prefix: string;
  module: string;
}

/**
 * Normaliza o nome da branch substituindo barras por traços, conforme convenção dos status files.
 */
export function sanitizeBranchName(branch: string): string {
  return branch.replace(/\//g, "-");
}

/**
 * Lê o cache <repo-root>/.claude/vetor/status/<branch>-touched-files.json se existir.
 */
export function loadTouchedFiles(
  repoRoot: string,
  branch: string,
): TouchedFilesCache | null {
  const sanitized = sanitizeBranchName(branch);
  const cachePath = join(
    repoRoot,
    ".claude",
    "vetor",
    "status",
    `${sanitized}-touched-files.json`,
  );

  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const raw = Deno.readTextFileSync(cachePath);
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.files)) {
      return null;
    }
    return parsed as TouchedFilesCache;
  } catch {
    return null;
  }
}

/**
 * Extrai os nomes dos módulos a partir de um cache de arquivos tocados.
 */
export function extractModules(cache: TouchedFilesCache): string[] {
  if (cache.modules && typeof cache.modules === "object") {
    return Object.keys(cache.modules).filter((m) => m.trim().length > 0);
  }
  return [];
}

/**
 * Lê a tabela "Prefixo do path | Módulo" do module-test-map.md (seção "Detecção de módulo por
 * arquivos alterados"). Mesma extração do `architectural-risk` em vetor-checks.sh: a tabela vai do
 * cabeçalho "Prefixo do path" até a primeira linha em branco.
 */
export function parseModulePrefixes(mapMarkdown: string): ModulePrefix[] {
  const lines = mapMarkdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.includes("Prefixo do path"));
  if (start < 0) return [];

  const clean = (cell: string) => cell.trim().replace(/^`/, "").replace(/`$/, "").trim();
  const result: ModulePrefix[] = [];
  for (const line of lines.slice(start)) {
    if (line.trim() === "") break;
    const cells = line.split("|");
    if (cells.length < 3) continue;
    const prefix = clean(cells[1]);
    const module = clean(cells[2]);
    if (!prefix || prefix.startsWith("Prefixo") || prefix.startsWith("---")) continue;
    result.push({ prefix, module });
  }
  return result;
}

/**
 * Agrupa arquivos por módulo: a primeira linha da tabela cujo prefixo casa vence; "./" é o
 * catch-all de repositório de módulo único (mesma regra do `architectural-risk`).
 */
export function mapFilesToModules(
  files: string[],
  prefixes: ModulePrefix[],
): Record<string, string[]> {
  const modules: Record<string, string[]> = {};
  for (const file of files) {
    const hit = prefixes.find((p) => p.prefix === "./" || file.startsWith(p.prefix));
    if (!hit) continue;
    (modules[hit.module] ??= []).push(file);
  }
  return modules;
}

function defaultGitRunner(repoRoot: string): GitRunner {
  return (args) => {
    try {
      const out = new Deno.Command("git", {
        args: ["-C", repoRoot, ...args],
        stdout: "piped",
        stderr: "null",
      }).outputSync();
      return out.success ? new TextDecoder().decode(out.stdout) : null;
    } catch {
      return null;
    }
  };
}

/** Branch default via `origin/HEAD`; null se o remoto não definir. */
export function resolveDefaultBranch(
  repoRoot: string,
  runGit: GitRunner = defaultGitRunner(repoRoot),
): string | null {
  const out = runGit(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  const name = out?.trim().replace(/^refs\/remotes\/origin\//, "");
  return name ? name : null;
}

/**
 * Recalcula os arquivos tocados quando o cache não existe (RF-03, edge case "ausência de dados no
 * touched-files cache"): `git diff --name-only origin/<default>...<branch>`, que lista só as
 * mudanças da branch desde o merge-base, mesmo que a default já tenha avançado ou o PR já tenha
 * sido squash-mergeado. Os módulos vêm da tabela do module-test-map.md; sem tabela, `modules`
 * fica vazio e só a interseção de arquivos é avaliada. Tenta a branch local e depois `origin/<branch>`.
 */
export function computeTouchedFiles(
  repoRoot: string,
  branch: string,
  defaultBranch: string,
  runGit: GitRunner = defaultGitRunner(repoRoot),
): TouchedFilesCache | null {
  for (const ref of [branch, `origin/${branch}`]) {
    const out = runGit(["diff", "--name-only", `origin/${defaultBranch}...${ref}`]);
    if (out === null) continue;

    const files = out.split(/\r?\n/).map((f) => f.trim()).filter((f) => f.length > 0);
    const mapPath = join(repoRoot, ".claude", "vetor", "module-test-map.md");
    const prefixes = existsSync(mapPath) ? parseModulePrefixes(Deno.readTextFileSync(mapPath)) : [];
    return {
      branch,
      default_branch: defaultBranch,
      modules: mapFilesToModules(files, prefixes),
      files,
    };
  }
  return null;
}

/**
 * Avalia se dois conjuntos de arquivos e módulos são completamente disjuntos.
 * files(A) ∩ files(B) == ∅ E modules(A) ∩ modules(B) == ∅.
 */
export function evaluateDisjoint(
  a: TouchedFilesCache,
  b: TouchedFilesCache,
): DisjointResult {
  const filesA = new Set(a.files.map((f) => f.replace(/\\/g, "/")));
  const filesB = new Set(b.files.map((f) => f.replace(/\\/g, "/")));

  const overlappingFiles: string[] = [];
  for (const f of filesA) {
    if (filesB.has(f)) {
      overlappingFiles.push(f);
    }
  }

  const modulesA = new Set(extractModules(a));
  const modulesB = new Set(extractModules(b));

  const overlappingModules: string[] = [];
  for (const m of modulesA) {
    if (modulesB.has(m)) {
      overlappingModules.push(m);
    }
  }

  const disjoint = overlappingFiles.length === 0 && overlappingModules.length === 0;

  return {
    disjoint,
    overlappingFiles,
    overlappingModules,
  };
}

/**
 * Avalia o candidato contra cada uma das outras branches da onda, não só contra uma: o squash merge
 * sem re-teste só é seguro se nada que entrou na default depois do CI do candidato o sobrepõe, e
 * quais PRs entram antes depende da ordem em que os CIs fecham. A resposta lista cada branch que
 * sobrepõe, para o coordinator decidir no momento do merge.
 */
export function evaluateAgainstOthers(
  candidate: TouchedFilesCache,
  others: TouchedFilesCache[],
): { disjoint: boolean; overlaps: BranchOverlap[] } {
  const overlaps: BranchOverlap[] = [];
  for (const other of others) {
    const result = evaluateDisjoint(candidate, other);
    if (!result.disjoint) overlaps.push({ branch: other.branch, ...result });
  }
  return { disjoint: overlaps.length === 0, overlaps };
}
