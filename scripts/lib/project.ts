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
    return { runtime: "rust", packageManager: "cargo", testCommand: "cargo test", needsInstall: false };
  }
  if (exists(`${dir}/go.mod`)) {
    return { runtime: "go", packageManager: "go", testCommand: "go test ./...", needsInstall: false };
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
    return { runtime: "gradle", packageManager: "gradle", testCommand: "./gradlew test", needsInstall: false };
  }

  return { runtime: "unknown", packageManager: null, testCommand: "", needsInstall: false };
}

/** Executa um comando e devolve o código de saída, sem lançar. */
export async function run(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const out = await new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "piped" }).output();
    return {
      code: out.code,
      stdout: new TextDecoder().decode(out.stdout),
      stderr: new TextDecoder().decode(out.stderr),
    };
  } catch (e) {
    return { code: 127, stdout: "", stderr: String(e) };
  }
}
