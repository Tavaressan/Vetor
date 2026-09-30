// Exercita o entrypoint real de scripts/lib/deps.ts (`if (import.meta.main)`) via subprocesso — o
// comando que o passo 1 de skills/stack-practices/SKILL.md efetivamente invoca. Sem o entrypoint o
// comando termina com exit 0 e saída vazia, que a skill lê como "nenhuma lib detectada" (issue #318);
// um teste in-process de `detectStructuralDeps` (deps_test.ts) não pegaria essa regressão.

import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../lib/deps.ts", import.meta.url));

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(args: string[], opts: { cwd?: string } = {}): Promise<RunResult> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", SCRIPT, ...args],
    cwd: opts.cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("entrypoint: diretório vazio passado como argumento imprime []", async () => {
  await withTempDir(async (dir) => {
    const result = await run([dir]);
    assertEquals(result.code, 0, result.stderr);
    assertEquals(JSON.parse(result.stdout), []);
  });
});

Deno.test("entrypoint: diretório com package.json imprime as deps estruturais em JSON", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      `${dir}/package.json`,
      JSON.stringify({ dependencies: { next: "^16.3.6", lodash: "^4.17.21" } }),
    );

    const result = await run([dir]);

    assertEquals(result.code, 0, result.stderr);
    assertEquals(JSON.parse(result.stdout), [
      { name: "next", version: "16.3.6", ecosystem: "npm" },
    ]);
  });
});

Deno.test("entrypoint: sem argumento usa o diretório atual (cwd) como default", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      `${dir}/package.json`,
      JSON.stringify({ dependencies: { next: "^16.3.6" } }),
    );

    // Diretório vazio também imprimiria [] se o argumento fosse ignorado; por isso o cwd tem uma
    // dependência estrutural — só aparece na saída se o default "." for de fato o cwd.
    const result = await run([], { cwd: dir });

    assertEquals(result.code, 0, result.stderr);
    assertEquals(JSON.parse(result.stdout), [
      { name: "next", version: "16.3.6", ecosystem: "npm" },
    ]);
  });
});
