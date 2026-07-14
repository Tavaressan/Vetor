// Detecção de runtime, gerenciador de pacotes e comando de teste de um projeto.
// Compartilhado por detect-project.ts e prepare-worktree.ts.

export type Runtime =
  | "deno"
  | "node"
  | "rust"
  | "go"
  | "python"
  | "gradle"
  | "unknown";

export interface ProjectInfo {
  runtime: Runtime;
  packageManager: string | null;
  testCommand: string;
  /** Deno com package.json precisa de `deno install`; Deno puro resolve tudo pelo cache global. */
  needsInstall: boolean;
}

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** JSON.parse rejeita BOM, comum em arquivos gerados no Windows. */
export function readJson(path: string): unknown {
  return JSON.parse(Deno.readTextFileSync(path).replace(/^﻿/, ""));
}

/** Lê o campo `tasks` de um deno.json para escolher entre `deno task test` e `deno test -A`. */
function hasDenoTestTask(dir: string): boolean {
  for (const name of ["deno.json", "deno.jsonc"]) {
    const path = `${dir}/${name}`;
    if (!exists(path)) continue;
    try {
      // jsonc com comentários falha aqui; nesse caso caímos no default (deno test -A).
      const parsed = readJson(path) as { tasks?: { test?: unknown } };
      return typeof parsed?.tasks?.test === "string";
    } catch {
      return false;
    }
  }
  return false;
}

function detectNodePackageManager(dir: string): string {
  if (exists(`${dir}/bun.lockb`) || exists(`${dir}/bun.lock`)) return "bun";
  if (exists(`${dir}/pnpm-lock.yaml`)) return "pnpm";
  if (exists(`${dir}/yarn.lock`)) return "yarn";
  return "npm";
}

export function detectProject(dir: string): ProjectInfo {
  const hasDeno = exists(`${dir}/deno.json`) || exists(`${dir}/deno.jsonc`);
  const hasPackageJson = exists(`${dir}/package.json`);

  if (hasDeno) {
    return {
      runtime: "deno",
      packageManager: "deno",
      testCommand: hasDenoTestTask(dir) ? "deno task test" : "deno test -A",
      // Sem package.json o nodeModulesDir default é "none": as deps vêm do cache
      // global $DENO_DIR, que já é compartilhado por todos os worktrees.
      needsInstall: hasPackageJson,
    };
  }

  if (hasPackageJson) {
    const pm = detectNodePackageManager(dir);
    return {
      runtime: "node",
      packageManager: pm,
      testCommand: `${pm} test`,
      needsInstall: true,
    };
  }

  if (exists(`${dir}/Cargo.toml`)) {
    return {
      runtime: "rust",
      packageManager: "cargo",
      testCommand: "cargo test",
      needsInstall: false,
    };
  }
  if (exists(`${dir}/go.mod`)) {
    return {
      runtime: "go",
      packageManager: "go",
      testCommand: "go test ./...",
      needsInstall: false,
    };
  }
  if (
    exists(`${dir}/pyproject.toml`) || exists(`${dir}/requirements.txt`) ||
    exists(`${dir}/poetry.lock`)
  ) {
    const pm = exists(`${dir}/poetry.lock`) ? "poetry" : "pip";
    return { runtime: "python", packageManager: pm, testCommand: "pytest", needsInstall: true };
  }
  if (
    exists(`${dir}/build.gradle`) || exists(`${dir}/build.gradle.kts`) ||
    exists(`${dir}/gradlew`)
  ) {
    return {
      runtime: "gradle",
      packageManager: "gradle",
      testCommand: "./gradlew test",
      needsInstall: false,
    };
  }

  return { runtime: "unknown", packageManager: null, testCommand: "", needsInstall: false };
}

/** Convenções observadas no repositório. Campo ausente = fato não encontrado. */
export interface Conventions {
  denoTasks?: string[];
  denoImportMap?: boolean;
  nodeScripts?: string[];
  nodeModuleType?: string;
  hasTsconfig?: boolean;
  formatter?: "prettier" | "biome";
  linter?: "eslint" | "biome";
}

const PRETTIER_CONFIGS = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.js",
  ".prettierrc.cjs",
  "prettier.config.js",
  "prettier.config.mjs",
  "prettier.config.cjs",
];

const ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  ".eslintrc",
  ".eslintrc.json",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.yaml",
  ".eslintrc.yml",
];

const BIOME_CONFIGS = ["biome.json", "biome.jsonc"];

function anyExists(dir: string, names: string[]): boolean {
  return names.some((name) => exists(`${dir}/${name}`));
}

function keysOf(record: unknown): string[] {
  return record && typeof record === "object" ? Object.keys(record as object) : [];
}

/**
 * Sonda as convenções do projeto. Só relata o que foi verificado em arquivo — um fato
 * não encontrado é omitido, nunca substituído por um default plausível. Uma convenção
 * inventada é pior que nenhuma: leva o agente a "consertar" código correto.
 */
export function detectConventions(dir: string): Conventions {
  const conv: Conventions = {};

  for (const name of ["deno.json", "deno.jsonc"]) {
    if (!exists(`${dir}/${name}`)) continue;
    try {
      // jsonc com comentários falha aqui; sem o parse não afirmamos nada.
      const parsed = readJson(`${dir}/${name}`) as { tasks?: unknown; imports?: unknown };
      const tasks = keysOf(parsed.tasks);
      if (tasks.length > 0) conv.denoTasks = tasks;
      if (keysOf(parsed.imports).length > 0) conv.denoImportMap = true;
    } catch { /* config ilegível: nenhum fato a relatar */ }
    break;
  }

  if (exists(`${dir}/package.json`)) {
    try {
      const parsed = readJson(`${dir}/package.json`) as { scripts?: unknown; type?: unknown };
      const scripts = keysOf(parsed.scripts);
      if (scripts.length > 0) conv.nodeScripts = scripts;
      if (typeof parsed.type === "string") conv.nodeModuleType = parsed.type;
    } catch { /* package.json ilegível: nenhum fato a relatar */ }
  }

  if (exists(`${dir}/tsconfig.json`)) conv.hasTsconfig = true;

  const hasBiome = anyExists(dir, BIOME_CONFIGS);
  if (anyExists(dir, PRETTIER_CONFIGS)) conv.formatter = "prettier";
  else if (hasBiome) conv.formatter = "biome";

  if (anyExists(dir, ESLINT_CONFIGS)) conv.linter = "eslint";
  else if (hasBiome) conv.linter = "biome";

  return conv;
}

/** Executa um comando e devolve o código de saída, sem lançar. */
export async function run(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const out = await new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "piped" })
      .output();
    return {
      code: out.code,
      stdout: new TextDecoder().decode(out.stdout),
      stderr: new TextDecoder().decode(out.stderr),
    };
  } catch (e) {
    return { code: 127, stdout: "", stderr: String(e) };
  }
}
