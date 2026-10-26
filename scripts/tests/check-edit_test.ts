import { assertEquals, assertStringIncludes } from "@std/assert";
import { filterNextTypegenDiagnostics, prepareTsCache, shouldCheckNode } from "../check-edit.ts";

const TYPEGEN_ERRORS = [
  "app/layout.tsx(1,1): error TS2304: Cannot find name 'LayoutProps'.",
  "app/page.tsx(1,1): error TS2304: Cannot find name 'PageProps'.",
  "app/api/route.ts(1,1): error TS2304: Cannot find name 'RouteContext'.",
].join("\n");

Deno.test("Next.js ignora apenas TS2304 dos tipos globais gerados pelo typegen", () => {
  assertEquals(filterNextTypegenDiagnostics(TYPEGEN_ERRORS, true), "");
  assertEquals(filterNextTypegenDiagnostics(TYPEGEN_ERRORS, false), TYPEGEN_ERRORS);
});

Deno.test("Next.js mantém diagnósticos reais junto aos tipos do typegen", () => {
  const realError =
    "app/page.tsx(2,1): error TS2322: Type 'string' is not assignable to type 'number'.";
  const output = filterNextTypegenDiagnostics(`${TYPEGEN_ERRORS}\n${realError}`, true);
  assertStringIncludes(output, realError);
  assertEquals(output.includes("LayoutProps"), false);
});

const ENV_KEY = "VETOR_TYPECHECK_ON_EDIT";

/** Roda `fn` com a env do opt-in controlada e restaura o valor original ao final. */
function withTypecheckEnv<T>(value: string | undefined, fn: () => T): T {
  const previous = Deno.env.get(ENV_KEY);
  if (value === undefined) Deno.env.delete(ENV_KEY);
  else Deno.env.set(ENV_KEY, value);
  try {
    return fn();
  } finally {
    if (previous === undefined) Deno.env.delete(ENV_KEY);
    else Deno.env.set(ENV_KEY, previous);
  }
}

/** Repositório fake: `.git` marca a raiz, `config` (se houver) vira .claude/vetor/config.json. */
function makeRepo(config?: string): string {
  const root = Deno.makeTempDirSync();
  Deno.mkdirSync(`${root}/.git`);
  if (config !== undefined) {
    Deno.mkdirSync(`${root}/.claude/vetor`, { recursive: true });
    Deno.writeTextFileSync(`${root}/.claude/vetor/config.json`, config);
  }
  return root;
}

function normalized(path: string): string {
  return path.replaceAll("\\", "/");
}

Deno.test("shouldCheckNode desativa o tsc síncrono por padrão", () => {
  const root = makeRepo();
  try {
    assertEquals(withTypecheckEnv(undefined, () => shouldCheckNode(root)), false);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("shouldCheckNode liga com VETOR_TYPECHECK_ON_EDIT=true", () => {
  const root = makeRepo();
  try {
    assertEquals(withTypecheckEnv("true", () => shouldCheckNode(root)), true);
    assertEquals(withTypecheckEnv("1", () => shouldCheckNode(root)), false);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("shouldCheckNode lê hooks.typecheckOnEdit do config.json", () => {
  const cases: Array<[string, boolean]> = [
    ['{"hooks":{"typecheckOnEdit":true}}', true],
    ['{"hooks":{"typecheckOnEdit":false}}', false],
    ['{"hooks":{"typecheckOnEdit":"true"}}', false],
    ['{"hooks":{}}', false],
    ['{"runtime":"node"}', false],
    ["{ config inválido", false],
    // BOM é comum em arquivos gerados no Windows e não pode desligar o opt-in em silêncio.
    ['﻿{"hooks":{"typecheckOnEdit":true}}', true],
  ];
  for (const [config, expected] of cases) {
    const root = makeRepo(config);
    try {
      assertEquals(withTypecheckEnv(undefined, () => shouldCheckNode(root)), expected, config);
    } finally {
      Deno.removeSync(root, { recursive: true });
    }
  }
});

Deno.test("shouldCheckNode acha o config na raiz do repo a partir de um subpacote", () => {
  const root = makeRepo('{"hooks":{"typecheckOnEdit":true}}');
  try {
    const pkg = `${root}/packages/web`;
    Deno.mkdirSync(pkg, { recursive: true });
    assertEquals(withTypecheckEnv(undefined, () => shouldCheckNode(pkg)), true);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("shouldCheckNode aceita .git como arquivo (worktree linkado)", () => {
  const root = Deno.makeTempDirSync();
  try {
    Deno.writeTextFileSync(`${root}/.git`, "gitdir: /algum/lugar\n");
    Deno.mkdirSync(`${root}/.claude/vetor`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/.claude/vetor/config.json`,
      '{"hooks":{"typecheckOnEdit":true}}',
    );
    assertEquals(withTypecheckEnv(undefined, () => shouldCheckNode(root)), true);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("prepareTsCache cria o cache que se auto-ignora e separa o buildinfo por pacote", () => {
  const root = makeRepo();
  try {
    const rootInfo = prepareTsCache(root);
    assertEquals(rootInfo, `${normalized(root)}/.claude/vetor/cache/tsc.tsbuildinfo`);
    assertEquals(
      Deno.readTextFileSync(`${root}/.claude/vetor/cache/.gitignore`),
      "*\n",
    );

    const pkg = `${root}/packages/web`;
    Deno.mkdirSync(pkg, { recursive: true });
    assertEquals(
      prepareTsCache(pkg),
      `${normalized(root)}/.claude/vetor/cache/tsc-packages_web.tsbuildinfo`,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

/** Projeto Node com um `tsc` falso que registra os argumentos recebidos e sempre falha. */
function makeNodeProject(config?: string): { root: string; file: string; log: string } {
  const root = makeRepo(config);
  const log = `${root}/tsc-args.log`;
  const windows = Deno.build.os === "windows";
  Deno.writeTextFileSync(`${root}/package.json`, '{"name":"alvo","devDependencies":{}}');
  Deno.writeTextFileSync(`${root}/tsconfig.json`, "{}");
  Deno.mkdirSync(`${root}/node_modules/.bin`, { recursive: true });
  const bin = `${root}/node_modules/.bin/${windows ? "tsc.cmd" : "tsc"}`;
  Deno.writeTextFileSync(
    bin,
    windows
      ? '@echo off\r\necho %* > "%FAKE_TSC_LOG%"\r\necho src/a.ts(1,1): error TS2322: boom\r\nexit /b 1\r\n'
      : '#!/bin/sh\necho "$@" > "$FAKE_TSC_LOG"\necho "src/a.ts(1,1): error TS2322: boom"\nexit 1\n',
  );
  if (!windows) Deno.chmodSync(bin, 0o755);
  Deno.mkdirSync(`${root}/src`);
  const file = `${root}/src/a.ts`;
  Deno.writeTextFileSync(file, "export const a: number = 'x';\n");
  return { root, file, log };
}

async function runCheckEdit(
  project: { root: string; file: string; log: string },
  optIn: boolean,
): Promise<string> {
  const script = new URL("../check-edit.ts", import.meta.url);
  const env: Record<string, string> = { FAKE_TSC_LOG: project.log };
  if (optIn) env[ENV_KEY] = "true";
  else env[ENV_KEY] = "";
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", script.href],
    cwd: project.root,
    env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode(
      JSON.stringify({ tool_input: { file_path: project.file }, cwd: project.root }),
    ),
  );
  await writer.close();
  const out = await child.output();
  return new TextDecoder().decode(out.stdout);
}

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("check-edit não roda tsc em projeto Node sem opt-in", async () => {
  const project = makeNodeProject();
  try {
    assertEquals(await runCheckEdit(project, false), "");
    assertEquals(exists(project.log), false);
  } finally {
    Deno.removeSync(project.root, { recursive: true });
  }
});

Deno.test("check-edit roda tsc --incremental com buildinfo isolado quando há opt-in", async () => {
  const project = makeNodeProject('{"hooks":{"typecheckOnEdit":true}}');
  try {
    const stdout = await runCheckEdit(project, false);
    assertStringIncludes(stdout, "TS2322");

    const args = Deno.readTextFileSync(project.log);
    assertStringIncludes(args, "--noEmit");
    assertStringIncludes(args, "--incremental");
    assertStringIncludes(args, "--tsBuildInfoFile");
    assertStringIncludes(args.replaceAll("\\", "/"), ".claude/vetor/cache/tsc.tsbuildinfo");
  } finally {
    Deno.removeSync(project.root, { recursive: true });
  }
});

Deno.test("check-edit liga o tsc também pela env VETOR_TYPECHECK_ON_EDIT=true", async () => {
  const project = makeNodeProject();
  try {
    assertStringIncludes(await runCheckEdit(project, true), "TS2322");
    assertEquals(exists(project.log), true);
  } finally {
    Deno.removeSync(project.root, { recursive: true });
  }
});
