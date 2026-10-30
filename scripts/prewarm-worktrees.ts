// Pre-warming especulativo de worktrees (Spec autonomia-continua-e-desacoplamento-interativo, RF-06).
//
// O coordinator dispara `start` em background enquanto analisa afinidades e conduz a entrevista;
// quando o dispatch chega, o worktree já existe e tem as dependências preparadas. O worktree é
// criado aqui, e não pelo harness (`isolation: "worktree"`), porque o path do worktree do harness
// só é conhecido depois do `Agent()` — por isso o worker dispatchado num worktree pré-aquecido é um
// subagente padrão com `cd` (mesmo caminho do redispatch; ver `issue-coordinator-dispatch.md`).
//
// Subcomandos (JSON no stdout, avisos no stderr):
//   start   --groups '[{"slug","branch"}]' --base <default> [--root <path>]
//   status  [--root <path>]
//   claim   <slug> [--root <path>]
//   discard [--keep a,b] [--root <path>]
//
// Falha de pre-warm nunca é fatal: o grupo fica `failed` no manifest e o coordinator recorre ao
// dispatch clássico (Spec, "Error Handling"). Nada aqui força remoção ou apaga trabalho alheio.

import { prepareDeps } from "./prepare-worktree.ts";
import { normalizePath } from "./lib/guard.ts";
import { run } from "./lib/project.ts";
import { prepareFailedMarkerPath } from "./lib/status.ts";
import { parseWorktreePaths } from "./lib/worktree.ts";
import { fileURLToPath } from "node:url";

export type PrewarmState = "warming" | "ready" | "claimed" | "failed" | "discarded";

export interface PrewarmGroup {
  slug: string;
  branch: string;
}

export interface PrewarmEntry extends PrewarmGroup {
  path: string;
  state: PrewarmState;
  /** SHA da base no momento da criação; a branch só pode ser apagada enquanto ainda aponta para ele. */
  baseSha?: string;
  startedAt?: string;
  readyAt?: string;
  /** Duração do `git worktree add`, em ms. */
  worktreeMs?: number;
  /** Duração do `prepareDeps`, em ms. */
  depsMs?: number;
  /** `true` quando a instalação de dependências falhou (o worker instala o que faltar). */
  depsFailed?: boolean;
  error?: string;
}

export interface PrewarmManifest {
  version: 1;
  base: string;
  /** Ref efetivamente usado como base (`origin/<base>` ou, sem rede, a branch local). */
  baseRef: string;
  startedAt: string;
  /** Ausente enquanto o `start` ainda está rodando. */
  finishedAt?: string;
  entries: PrewarmEntry[];
}

export interface DiscardReport {
  removed: PrewarmEntry[];
  skipped: PrewarmEntry[];
  failed: PrewarmEntry[];
  /** Branches que sobreviveram por terem avançado além da base (nunca se apaga trabalho). */
  branchesKept: string[];
  durationMs: number;
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Mesmos tipos aceitos por `worktree-create`; sem `..`, espaços ou prefixo `-`.
const BRANCH_PATTERN = /^(feat|fix|chore|refactor|docs|test|ci)\/[a-z0-9][a-z0-9._-]*$/;
const BASE_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

export function manifestPath(root: string): string {
  return `${root}/.claude/vetor/prewarm.json`;
}

/** Valida a entrada antes de qualquer efeito colateral; nada é interpretado por um shell. */
export function validateGroups(input: unknown): PrewarmGroup[] {
  if (!Array.isArray(input)) throw new Error("--groups deve ser uma lista JSON de {slug, branch}.");
  if (input.length === 0) throw new Error("--groups precisa de ao menos um grupo.");
  const seen = new Set<string>();
  return input.map((raw) => {
    const { slug, branch } = (raw ?? {}) as Partial<PrewarmGroup>;
    if (typeof slug !== "string" || slug.length > 30 || !SLUG_PATTERN.test(slug)) {
      throw new Error(
        `slug inválido ${JSON.stringify(slug)}: use kebab-case com até 30 caracteres.`,
      );
    }
    if (typeof branch !== "string" || !BRANCH_PATTERN.test(branch) || branch.includes("..")) {
      throw new Error(`branch inválida ${JSON.stringify(branch)}: use <type>/<issue#>-<slug>.`);
    }
    if (seen.has(slug) || seen.has(branch)) {
      throw new Error(`grupo duplicado: ${slug} / ${branch}.`);
    }
    seen.add(slug);
    seen.add(branch);
    return { slug, branch };
  });
}

export async function readManifest(root: string): Promise<PrewarmManifest | null> {
  try {
    return JSON.parse(await Deno.readTextFile(manifestPath(root))) as PrewarmManifest;
  } catch {
    return null;
  }
}

/**
 * Sidecar de linhas simples lido pelo `vetor-status.sh` (bash, sem parser de JSON): as branches dos
 * worktrees pré-aquecidos ainda sem dono. Elas não têm status file até o dispatch, e isso não é a
 * falha anômala da issue #72.
 */
export function pendingPath(root: string): string {
  return `${root}/.claude/vetor/prewarm-pending.txt`;
}

async function writeAtomic(target: string, content: string): Promise<void> {
  await Deno.writeTextFile(`${target}.tmp`, content);
  await Deno.rename(`${target}.tmp`, target);
}

/** Escrita atômica (tmp + rename): o coordinator lê o manifest enquanto o `start` ainda roda. */
async function writeManifest(root: string, manifest: PrewarmManifest): Promise<void> {
  await Deno.mkdir(`${root}/.claude/vetor`, { recursive: true });
  // Mesma convenção dos status files: "/" da branch trocada por "-".
  const pending = manifest.entries
    .filter((e) => e.state === "warming" || e.state === "ready")
    .map((e) => `${e.branch.replaceAll("/", "-")}\n`)
    .join("");
  await writeAtomic(pendingPath(root), pending);
  await writeAtomic(manifestPath(root), JSON.stringify(manifest, null, 2));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function isRegisteredWorktree(root: string, path: string): Promise<boolean> {
  const listed = await run("git", ["worktree", "list", "--porcelain"], root);
  const target = normalizePath(path);
  return parseWorktreePaths(listed.stdout).some((p) => normalizePath(p) === target);
}

/** Base fresca: `origin/<base>` quando o fetch funciona; sem rede, a branch local (nunca fatal). */
async function resolveBase(root: string, base: string): Promise<{ ref: string; sha: string }> {
  if (!BASE_PATTERN.test(base)) throw new Error(`base inválida: ${JSON.stringify(base)}.`);
  let ref = base;
  const fetched = await run("git", ["fetch", "origin", base], root);
  if (fetched.code === 0) {
    const remote = await run("git", ["rev-parse", "--verify", "--quiet", `origin/${base}`], root);
    if (remote.code === 0) ref = `origin/${base}`;
  } else {
    console.error(`[vetor] fetch de origin/${base} indisponível; usando a branch local.`);
  }
  const sha = await run("git", ["rev-parse", "--verify", `${ref}^{commit}`], root);
  if (sha.code !== 0) {
    throw new Error(`base ${ref} não resolve para um commit: ${sha.stderr.trim()}`);
  }
  return { ref, sha: sha.stdout.trim() };
}

export async function startPrewarm(
  opts: { root: string; base: string; groups: unknown },
): Promise<PrewarmManifest> {
  const { root, base } = opts;
  const groups = validateGroups(opts.groups);

  const previous = await readManifest(root);
  if (previous?.entries.some((e) => e.state === "warming" || e.state === "ready")) {
    throw new Error(
      "o manifest anterior ainda tem worktrees pré-aquecidos pendentes; rode `discard` antes de um novo `start`.",
    );
  }

  const { ref, sha } = await resolveBase(root, base);
  const manifest: PrewarmManifest = {
    version: 1,
    base,
    baseRef: ref,
    startedAt: new Date().toISOString(),
    entries: groups.map((g) => ({
      ...g,
      path: `${root}/.claude/worktrees/${g.slug}`,
      state: "warming" as const,
      baseSha: sha,
    })),
  };
  await writeManifest(root, manifest);

  // `git worktree add` é serializado de propósito: workers paralelos disputariam o index.lock.
  for (const entry of manifest.entries) {
    entry.startedAt = new Date().toISOString();

    // Nunca entra em path ou branch existente (mesma regra de `worktree-create`).
    if (await pathExists(entry.path)) {
      entry.state = "failed";
      entry.error = `path já existe: ${entry.path}`;
    } else if (
      (await run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${entry.branch}`], root))
        .code === 0
    ) {
      entry.state = "failed";
      entry.error = `branch já existe: ${entry.branch}`;
    } else {
      const t0 = performance.now();
      // --no-track: as branches criadas pelo hook de worktree não herdam upstream da base.
      const created = await run(
        "git",
        ["worktree", "add", "--no-track", "-b", entry.branch, entry.path, ref],
        root,
      );
      entry.worktreeMs = Math.round(performance.now() - t0);
      if (created.code !== 0) {
        entry.state = "failed";
        entry.error = `git worktree add falhou: ${created.stderr.trim()}`;
      } else {
        const t1 = performance.now();
        await prepareDeps(entry.path, root);
        entry.depsMs = Math.round(performance.now() - t1);
        entry.depsFailed = await pathExists(prepareFailedMarkerPath(entry.path));
        entry.state = "ready";
        entry.readyAt = new Date().toISOString();
      }
    }
    if (entry.state === "failed") console.error(`AVISO: pre-warm de ${entry.slug}: ${entry.error}`);
    await writeManifest(root, manifest);
  }

  manifest.finishedAt = new Date().toISOString();
  await writeManifest(root, manifest);
  return manifest;
}

/** Entrega o worktree pronto uma única vez; qualquer recusa significa "use o dispatch clássico". */
export async function claimPrewarm(root: string, slug: string): Promise<PrewarmEntry> {
  const manifest = await readManifest(root);
  const entry = manifest?.entries.find((e) => e.slug === slug);
  if (!manifest || !entry) throw new Error(`grupo ${slug} não encontrado no manifest.`);
  if (entry.state !== "ready") {
    throw new Error(`grupo ${slug} não está ready (estado: ${entry.state}).`);
  }
  if (!(await isRegisteredWorktree(root, entry.path)) || !(await pathExists(entry.path))) {
    throw new Error(`worktree ausente para ${slug}: ${entry.path}`);
  }
  entry.state = "claimed";
  await writeManifest(root, manifest);
  return entry;
}

const VETOR_CHECKS = fileURLToPath(new URL("./vetor-checks.sh", import.meta.url));

/**
 * Remove os worktrees pré-aquecidos que não foram usados. Reusa `safe-remove-worktree` (não força:
 * mudanças não commitadas ou worktree travado recusam a remoção) e só apaga a branch se ela ainda
 * aponta para a base — sem `gh`, para caber no critério de remoção em menos de 10 s.
 */
export async function discardPrewarm(
  opts: { root: string; keep?: string[]; vetorChecks?: string },
): Promise<DiscardReport> {
  const { root } = opts;
  const keep = new Set(opts.keep ?? []);
  const started = performance.now();
  const report: DiscardReport = {
    removed: [],
    skipped: [],
    failed: [],
    branchesKept: [],
    durationMs: 0,
  };

  const manifest = await readManifest(root);
  for (const entry of manifest?.entries ?? []) {
    if (entry.state === "claimed" || keep.has(entry.slug)) {
      if (entry.state === "claimed" || entry.state === "ready") report.skipped.push(entry);
      continue;
    }
    if (entry.state !== "ready" && entry.state !== "warming") continue;

    // Um `warming` esquecido (sessão interrompida) pode nem ter chegado a criar o worktree.
    if (await isRegisteredWorktree(root, entry.path)) {
      const removal = await run(
        "bash",
        [opts.vetorChecks ?? VETOR_CHECKS, "safe-remove-worktree", entry.path],
        root,
      );
      if (removal.code !== 0) {
        console.error(`AVISO: discard de ${entry.slug} recusado: ${removal.stderr.trim()}`);
        report.failed.push(entry);
        continue;
      }
    }

    // Só apaga a branch se ela ainda estiver na base: update-ref com o valor antigo esperado.
    const exists = await run("git", [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${entry.branch}`,
    ], root);
    if (exists.code === 0) {
      const deleted = await run(
        "git",
        ["update-ref", "-d", `refs/heads/${entry.branch}`, entry.baseSha ?? ""],
        root,
      );
      if (deleted.code !== 0) report.branchesKept.push(entry.branch);
    }
    entry.state = "discarded";
    report.removed.push(entry);
  }

  if (manifest) await writeManifest(root, manifest);
  report.durationMs = Math.round(performance.now() - started);
  return report;
}

async function repoRoot(cwd: string): Promise<string> {
  const out = await run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  const common = out.stdout.trim();
  if (out.code !== 0 || !common) throw new Error("não é um repositório git.");
  return common.replace(/\/?\.git\/?$/, "");
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  const root = flag(rest, "--root") ?? await repoRoot(Deno.cwd());

  if (command === "start") {
    const base = flag(rest, "--base");
    const rawGroups = flag(rest, "--groups");
    if (!base || !rawGroups) throw new Error("uso: start --groups '<json>' --base <branch>");
    console.log(JSON.stringify(await startPrewarm({ root, base, groups: JSON.parse(rawGroups) })));
  } else if (command === "status") {
    console.log(JSON.stringify(await readManifest(root)));
  } else if (command === "claim") {
    const slug = rest.find((a) => !a.startsWith("--") && a !== flag(rest, "--root"));
    if (!slug) throw new Error("uso: claim <slug>");
    console.log(JSON.stringify(await claimPrewarm(root, slug)));
  } else if (command === "discard") {
    const keep = flag(rest, "--keep")?.split(",").filter(Boolean);
    console.log(JSON.stringify(await discardPrewarm({ root, keep })));
  } else {
    throw new Error("uso: prewarm-worktrees.ts <start|status|claim|discard> [opções]");
  }
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (e) {
    console.error(`ERRO: ${e instanceof Error ? e.message : e}`);
    Deno.exit(1);
  }
}
