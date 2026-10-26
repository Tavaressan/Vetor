import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import {
  buildRepoMap,
  DEFAULT_MAX_TOKENS,
  estimateTokens,
  extractSymbols,
  extractSymbolsLexical,
  isExcludedPath,
  type RepoMapResult,
} from "../repo-map.ts";

// Cria um repositório temporário (sem git) a partir de um mapa path -> conteúdo.
async function makeRepo(files: Record<string, string>): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "repo-map-" });
  for (const [path, content] of Object.entries(files)) {
    const abs = `${root}/${path}`;
    await Deno.mkdir(abs.slice(0, abs.lastIndexOf("/")), { recursive: true });
    await Deno.writeTextFile(abs, content);
  }
  return root;
}

async function withRepo(
  files: Record<string, string>,
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await makeRepo(files);
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

function allPaths(result: RepoMapResult): string[] {
  return [...result.files.map((f) => f.path), ...result.omitted].sort();
}

const SAMPLE = `import { alpha, beta as gamma } from "./alpha.ts";
import Default from "./default.ts";
import * as ns from "../ns.ts";
import "./side.ts";
import "jsr:@std/assert";
import { external } from "npm:left-pad";
export { reexported } from "./reexport.ts";
export * from "./star.ts";

/** Doc que deve ser ignorada */
export interface Runner<T> extends Base {
  name: string;
  run(input: T): Promise<void>;
}
interface NotExported { hidden: true }
export type Id = string | number;
export enum Color { Red, Green }
export class Service extends Base implements Runner<string> {
  private secret = 1;
  #hash = 2;
  protected static limit: number = 3;
  readonly id: string = "x";
  constructor(private name: string) { super(); }
  run(input: string): Promise<void> { return SECRET_BODY_MARKER; }
  protected helper(): void { SECRET_BODY_MARKER; }
  private hidden(): void { SECRET_BODY_MARKER; }
  get value(): string { return SECRET_BODY_MARKER; }
}
export class Empty {
  private only = 1;
}
export function greet(name: string, // nota
  excited = false): string {
  return SECRET_BODY_MARKER;
}
export async function load<T>(path: string): Promise<T> { return SECRET_BODY_MARKER; }
export function pick(a: string): string;
export function pick(a: number): number;
export function pick(a: unknown): unknown { return SECRET_BODY_MARKER; }
function notExported() { return SECRET_BODY_MARKER; }
export const LIMIT = 10;
export const NAME = "vetor";
export const add = (a: number, b: number): number => a + b + SECRET_BODY_MARKER;
export const config: Config = { SECRET_BODY_MARKER: 1 };
export const table = buildTable(SECRET_BODY_MARKER);
export let counter = 0;
export default function () { return SECRET_BODY_MARKER; }
`;

Deno.test("estimateTokens usa 4 caracteres por token, arredondando para cima", () => {
  assertEquals(estimateTokens(""), 0);
  assertEquals(estimateTokens("abcd"), 1);
  assertEquals(estimateTokens("abcde"), 2);
  assertEquals(DEFAULT_MAX_TOKENS, 1500);
});

Deno.test("extractSymbols cataloga contratos públicos e omite corpos", async () => {
  const { symbols, imports } = await extractSymbols("src/sample.ts", SAMPLE);
  const bySignature = new Map(symbols.map((s) => [s.name, s]));
  const sig = (name: string) => bySignature.get(name)?.signature;

  assertEquals(
    sig("Runner"),
    "export interface Runner<T> extends Base {\n  name: string;\n  run(input: T): Promise<void>;\n}",
  );
  assertEquals(sig("Id"), "export type Id = string | number;");
  assertEquals(sig("Color"), "export enum Color { Red, Green }");
  assertEquals(
    sig("Service"),
    [
      "export class Service extends Base implements Runner<string> {",
      "  protected static limit: number;",
      "  readonly id: string;",
      "  constructor(private name: string) { ... }",
      "  run(input: string): Promise<void> { ... }",
      "  protected helper(): void { ... }",
      "  get value(): string { ... }",
      "}",
    ].join("\n"),
  );
  assertEquals(sig("Empty"), "export class Empty { ... }");
  assertEquals(
    sig("greet"),
    "export function greet(name: string, excited = false): string { ... }",
  );
  assertEquals(
    sig("load"),
    "export async function load<T>(path: string): Promise<T> { ... }",
  );
  assertEquals(
    sig("pick"),
    "export function pick(a: string): string;\nexport function pick(a: number): number;",
  );
  assertEquals(sig("LIMIT"), "export const LIMIT = 10;");
  assertEquals(sig("NAME"), 'export const NAME = "vetor";');
  assertEquals(
    sig("add"),
    "export const add = (a: number, b: number): number => { ... };",
  );
  assertEquals(sig("config"), "export const config: Config = ...;");
  assertEquals(sig("table"), "export const table = ...;");
  assertEquals(sig("counter"), "export let counter = 0;");
  assertEquals(sig("default"), "export default function () { ... }");

  assertEquals(
    symbols.map((s) => s.kind),
    [
      "interface",
      "type",
      "type",
      "class",
      "class",
      "function",
      "function",
      "function",
      "const",
      "const",
      "const",
      "const",
      "const",
      "const",
      "function",
    ],
  );
  assertEquals(symbols.every((s) => s.exported), true);

  const all = symbols.map((s) => s.signature).join("\n");
  assertFalse(all.includes("SECRET_BODY_MARKER"), "corpos devem ser omitidos");
  assertFalse(all.includes("secret"), "membros private ficam de fora");
  assertFalse(all.includes("#hash"), "membros #private ficam de fora");
  assertFalse(all.includes("hidden"), "método private e interface não exportada ficam de fora");
  assertFalse(all.includes("notExported"), "funções não exportadas ficam de fora");

  const runnerLine = SAMPLE.split("\n").findIndex((l) => l.startsWith("export interface Runner"));
  assertEquals(bySignature.get("Runner")?.line, runnerLine + 1);

  assertEquals(imports, [
    { source: "./alpha.ts", importedSymbols: ["alpha", "beta"] },
    { source: "./default.ts", importedSymbols: ["default"] },
    { source: "../ns.ts", importedSymbols: ["*"] },
    { source: "./side.ts", importedSymbols: [] },
    { source: "./reexport.ts", importedSymbols: ["reexported"] },
    { source: "./star.ts", importedSymbols: ["*"] },
  ]);
});

Deno.test("extractSymbols compacta listas multilinha sem espaços nem vírgulas sobrando", async () => {
  const { symbols } = await extractSymbols(
    "a.ts",
    [
      "export function run(",
      "  cmd: string,",
      "  args: string[],",
      "): Promise<void> {",
      "  return;",
      "}",
      "export type Pair = [",
      "  string,",
      "  number,",
      "];",
    ].join("\n"),
  );
  assertEquals(symbols.map((s) => s.signature), [
    "export function run(cmd: string, args: string[]): Promise<void> { ... }",
    "export type Pair = [string, number];",
  ]);
});

Deno.test("extractSymbols é idêntico para fins de linha LF e CRLF", async () => {
  const lf = await extractSymbols("a.ts", SAMPLE);
  const crlf = await extractSymbols("a.ts", SAMPLE.replaceAll("\n", "\r\n"));
  assertEquals(crlf, lf);
});

Deno.test("extractSymbols aceita JSX e JavaScript", async () => {
  const jsx = await extractSymbols(
    "App.jsx",
    'export function App() { return <div className="x">oi</div>; }\n',
  );
  assertEquals(jsx.symbols.map((s) => s.signature), ["export function App() { ... }"]);
  const mjs = await extractSymbols(
    "a.mjs",
    "export const answer = 42;\nexport class K { m() {} }\n",
  );
  assertEquals(mjs.symbols.map((s) => s.signature), [
    "export const answer = 42;",
    "export class K {\n  m() { ... }\n}",
  ]);
});

Deno.test("extractSymbols não aborta com erro sintático e mantém o que foi reconhecido", async () => {
  const broken = [
    "export function ok(a: string): string { return a; }",
    "export const = ;",
    "export class { ",
    "export interface Tail { x: number }",
  ].join("\n");
  const { symbols } = await extractSymbols("broken.ts", broken);
  assert(symbols.some((s) => s.name === "ok"));
});

Deno.test("extractSymbolsLexical captura apenas linhas de export (fallback)", () => {
  const source = [
    "export function a(x: number): string {",
    '  return "";',
    "}",
    "export interface B {",
    "  y: 1",
    "}",
    "export const C = 1;",
    "const hidden = 2;",
    "export default class D {}",
  ].join("\n");
  assertEquals(extractSymbolsLexical(source), [
    {
      name: "a",
      kind: "function",
      line: 1,
      signature: "export function a(x: number): string { ... }",
      exported: true,
    },
    {
      name: "B",
      kind: "interface",
      line: 4,
      signature: "export interface B { ... }",
      exported: true,
    },
    { name: "C", kind: "const", line: 7, signature: "export const C = 1;", exported: true },
    {
      name: "default",
      kind: "class",
      line: 9,
      signature: "export default class D { ... }",
      exported: true,
    },
  ]);
});

Deno.test("isExcludedPath compara segmentos de diretório e protege segredos", () => {
  for (
    const excluded of [
      "node_modules/a/b.ts",
      "src/node_modules/x.js",
      "target/x.ts",
      "dist/x.js",
      "build/x.js",
      ".venv/lib/x.js",
      ".claude/worktrees/w/a.ts",
      "sub/.claude/worktrees/w/a.ts",
      ".git/hooks/x.js",
      ".env.local",
      "secrets/server.pem",
      "keys/id.key",
    ]
  ) {
    assert(isExcludedPath(excluded), `${excluded} deveria ser excluído`);
  }
  for (const kept of ["src/ok.ts", "src/distance.ts", "src/target.ts", ".claude/vetor/x.ts"]) {
    assertFalse(isExcludedPath(kept), `${kept} não deveria ser excluído`);
  }
});

Deno.test("buildRepoMap ignora diretórios excluídos e extensões não suportadas", async () => {
  const exported = "export const marker = 1;\n";
  await withRepo(
    {
      "src/keep.ts": exported,
      "src/page.tsx": "export const Page = () => null;\n",
      "src/old.cjs": "export const legacy = 1;\n",
      "src/readme.md": "# nada\n",
      "src/script.py": "def nao_parsear(): pass\n",
      "node_modules/pkg/index.js": exported,
      "target/debug/gen.ts": exported,
      "dist/out.js": exported,
      "build/out.js": exported,
      ".venv/lib/site.js": exported,
      ".claude/worktrees/w1/src/a.ts": exported,
      ".git/hooks/pre-commit.js": exported,
    },
    async (root) => {
      const result = await buildRepoMap({ root, cachePath: null });
      assertEquals(allPaths(result), ["src/keep.ts", "src/old.cjs", "src/page.tsx"]);
    },
  );
});

Deno.test("buildRepoMap usa a lista do git e respeita .gitignore", async () => {
  await withRepo(
    {
      ".gitignore": "ignored.ts\n",
      "kept.ts": "export const kept = 1;\n",
      "ignored.ts": "export const ignored = 1;\n",
      "sub/new.ts": "export const fresh = 1;\n",
    },
    async (root) => {
      const init = await new Deno.Command("git", { args: ["init", "-q"], cwd: root }).output();
      assert(init.success);
      const result = await buildRepoMap({ root, cachePath: null });
      assertEquals(allPaths(result), ["kept.ts", "sub/new.ts"]);
    },
  );
});

Deno.test("buildRepoMap devolve status empty quando não há código suportado", async () => {
  await withRepo({ "README.md": "# vazio\n", "src/a.py": "x = 1\n" }, async (root) => {
    const result = await buildRepoMap({ root, cachePath: null });
    assertEquals(result.status, "empty");
    assertEquals(result.markdown, "");
    assertEquals(result.estimatedTokens, 0);
    assertEquals(result.files, []);
  });
});

Deno.test("buildRepoMap rejeita orçamento inválido", async () => {
  await withRepo({ "a.ts": "export const a = 1;\n" }, async (root) => {
    await assertRejects(() => buildRepoMap({ root, maxTokens: 0 }), RangeError);
    await assertRejects(() => buildRepoMap({ root, maxTokens: 1.5 }), RangeError);
  });
});

function manyFiles(count: number): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const n = String(i).padStart(2, "0");
    files[`src/file${n}.ts`] = [
      `export interface Shape${n} { id: number; label: string; tags: string[] }`,
      `export function build${n}(input: Shape${n}, options: Record<string, unknown>): Shape${n} {`,
      "  return input;",
      "}",
      "",
    ].join("\n");
  }
  return files;
}

Deno.test("buildRepoMap nunca ultrapassa o orçamento de tokens", async () => {
  await withRepo(manyFiles(40), async (root) => {
    for (const maxTokens of [1, 5, 20, 100, 500, 1500]) {
      const result = await buildRepoMap({ root, maxTokens, cachePath: null });
      assertEquals(result.maxTokens, maxTokens);
      assertEquals(result.estimatedTokens, estimateTokens(result.markdown));
      assert(
        result.estimatedTokens <= maxTokens,
        `${result.estimatedTokens} tokens acima do teto ${maxTokens}`,
      );
    }
    const byDefault = await buildRepoMap({ root, cachePath: null });
    assertEquals(byDefault.maxTokens, 1500);
    assert(byDefault.estimatedTokens <= 1500);
    assert(byDefault.files.some((f) => f.listed.length > 0), "periferia condensada");
    assert(byDefault.files.some((f) => f.symbols.length > 0), "núcleo detalhado");
  });
});

Deno.test("buildRepoMap registra os arquivos omitidos num rodapé que cabe no orçamento", async () => {
  await withRepo(manyFiles(120), async (root) => {
    const result = await buildRepoMap({ root, maxTokens: 120, cachePath: null });
    assert(result.estimatedTokens <= 120);
    assert(result.omitted.length > 0);
    assertStringIncludes(result.markdown, `+${result.omitted.length} arquivos omitidos`);
    assertEquals(result.files.length + result.omitted.length, 120);
  });
});

Deno.test("buildRepoMap não poda quando tudo cabe no orçamento", async () => {
  await withRepo(manyFiles(3), async (root) => {
    const result = await buildRepoMap({ root, cachePath: null });
    assertEquals(result.omitted, []);
    assertEquals(result.files.length, 3);
    assertEquals(result.files.every((f) => f.listed.length === 0), true);
    assertStringIncludes(result.markdown, "### src/file00.ts");
    assertStringIncludes(result.markdown, "```ts");
    assertStringIncludes(result.markdown, "export interface Shape02 {");
    assertStringIncludes(result.markdown, "export function build01(input: Shape01");
    assertFalse(result.markdown.includes("omitidos"));
  });
});

Deno.test("buildRepoMap mantém detalhado o arquivo mais central e condensa a periferia", async () => {
  const files: Record<string, string> = {
    "lib/core.ts":
      "export interface Core { id: string }\nexport function coreHelper(c: Core): string { return c.id; }\n",
    "lonely/leaf.ts": `export function leafOnly(${
      Array.from({ length: 12 }, (_, i) => `argument${i}: Record<string, unknown>`).join(", ")
    }): void {}\n`,
  };
  for (let i = 1; i <= 6; i++) {
    files[`mods/m${i}.ts`] =
      `import type { Core } from "../lib/core.ts";\nexport function useCore${i}(c: Core): string { return c.id; }\n`;
  }
  await withRepo(files, async (root) => {
    const result = await buildRepoMap({ root, maxTokens: 150, cachePath: null });
    assert(result.estimatedTokens <= 150);
    assertEquals(result.files[0].path, "lib/core.ts");
    assert(result.files[0].symbols.some((s) => s.name === "Core"));
    assertStringIncludes(result.markdown, "export interface Core {\n  id: string;\n}");
    const leaf = result.files.find((f) => f.path === "lonely/leaf.ts");
    assert(leaf, "o arquivo periférico continua listado de forma condensada");
    assertEquals(leaf.symbols, []);
    assertEquals(leaf.listed, ["leafOnly"]);
    assertFalse(result.markdown.includes("argument5"));
  });
});

Deno.test("buildRepoMap é determinístico, inclusive com cache frio e morno", async () => {
  const files = manyFiles(25);
  const reversed = Object.fromEntries(Object.entries(files).reverse());
  const a = await makeRepo(files);
  const b = await makeRepo(reversed);
  try {
    const cold = await buildRepoMap({ root: a, maxTokens: 400 });
    const warm = await buildRepoMap({ root: a, maxTokens: 400 });
    const other = await buildRepoMap({ root: b, maxTokens: 400, cachePath: null });
    assertEquals(warm.markdown, cold.markdown);
    assertEquals(other.markdown, cold.markdown);
    assertEquals(other.files, cold.files);
    assertEquals(other.omitted, cold.omitted);
  } finally {
    await Deno.remove(a, { recursive: true }).catch(() => {});
    await Deno.remove(b, { recursive: true }).catch(() => {});
  }
});

Deno.test("cache incremental reaproveita arquivos inalterados e reparseia os modificados", async () => {
  await withRepo(manyFiles(6), async (root) => {
    const cachePath = `${root}/.claude/vetor/cache/repo-map.json`;

    const first = await buildRepoMap({ root });
    assertEquals(first.stats, { parsed: 6, cached: 0, cacheWritten: true });
    const cache = JSON.parse(await Deno.readTextFile(cachePath));
    assertEquals(cache.version, "1.0.0");
    assertEquals(Object.keys(cache.files).sort(), Object.keys(manyFiles(6)).sort());
    const entry = cache.files["src/file00.ts"];
    assertEquals(typeof entry.fileHash, "string");
    assertEquals(entry.fileHash.length, 40);
    assertEquals(entry.symbols.length, 2);

    const second = await buildRepoMap({ root });
    assertEquals(second.stats, { parsed: 0, cached: 6, cacheWritten: false });
    assertEquals(second.markdown, first.markdown);

    await Deno.writeTextFile(`${root}/src/file03.ts`, "export const changed = 1;\n");
    const third = await buildRepoMap({ root });
    assertEquals(third.stats, { parsed: 1, cached: 5, cacheWritten: true });
    assertStringIncludes(third.markdown, "export const changed = 1;");

    await Deno.remove(`${root}/src/file05.ts`);
    const fourth = await buildRepoMap({ root });
    assertEquals(fourth.stats, { parsed: 0, cached: 5, cacheWritten: true });
    const pruned = JSON.parse(await Deno.readTextFile(cachePath));
    assertFalse("src/file05.ts" in pruned.files);
  });
});

Deno.test("cache corrompido ou ilegível vira aviso e o mapa é reconstruído", async () => {
  await withRepo(manyFiles(2), async (root) => {
    const cachePath = `${root}/.claude/vetor/cache/repo-map.json`;
    await Deno.mkdir(`${root}/.claude/vetor/cache`, { recursive: true });
    await Deno.writeTextFile(cachePath, "{ não é json");
    const result = await buildRepoMap({ root });
    assertEquals(result.stats.parsed, 2);
    assert(result.warnings.some((w) => w.includes("cache")));
    assertEquals(JSON.parse(await Deno.readTextFile(cachePath)).version, "1.0.0");
  });
});

Deno.test("falha ao gravar o cache é aviso não bloqueante", async () => {
  await withRepo(
    { "a.ts": "export const a = 1;\n", "blocker": "arquivo, não diretório" },
    async (root) => {
      const result = await buildRepoMap({ root, cachePath: `${root}/blocker/sub/repo-map.json` });
      assertEquals(result.status, "ok");
      assertEquals(result.stats.cacheWritten, false);
      assert(result.warnings.some((w) => w.includes("cache")));
      assertStringIncludes(result.markdown, "export const a = 1;");
    },
  );
});

Deno.test("arquivos acima de 500KB são pulados com registro do motivo", async () => {
  await withRepo(
    {
      "ok.ts": "export const ok = 1;\n",
      "big.ts": `export const BIG = "${"x".repeat(600 * 1024)}";\n`,
    },
    async (root) => {
      const result = await buildRepoMap({ root, cachePath: null });
      assertEquals(allPaths(result), ["ok.ts"]);
      assertEquals(result.skipped.length, 1);
      assertEquals(result.skipped[0].path, "big.ts");
      assertStringIncludes(result.skipped[0].reason, "500KB");
    },
  );
});

async function runCli(root: string, args: string[]) {
  const script = new URL("../repo-map.ts", import.meta.url);
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", script.href, ...args],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

Deno.test("CLI imprime Markdown por padrão e JSON com --json respeitando --max-tokens", async () => {
  await withRepo(manyFiles(30), async (root) => {
    const markdown = await runCli(root, ["--max-tokens", "200"]);
    assertEquals(markdown.code, 0, markdown.stderr);
    assertStringIncludes(markdown.stdout, "### src/");
    assert(estimateTokens(markdown.stdout.trimEnd()) <= 200);

    const json = await runCli(root, ["--json", "--max-tokens=200"]);
    assertEquals(json.code, 0, json.stderr);
    const parsed = JSON.parse(json.stdout);
    assertEquals(parsed.status, "ok");
    assertEquals(parsed.maxTokens, 200);
    assert(parsed.estimatedTokens <= 200);
    assertEquals(parsed.markdown.trimEnd(), markdown.stdout.trimEnd());
    assert(Array.isArray(parsed.files) && Array.isArray(parsed.omitted));
  });
});

Deno.test("CLI rejeita --max-tokens inválido e flags desconhecidas", async () => {
  await withRepo({ "a.ts": "export const a = 1;\n" }, async (root) => {
    const invalid = await runCli(root, ["--max-tokens", "abc"]);
    assertEquals(invalid.code, 2);
    assertStringIncludes(invalid.stderr, "--max-tokens");
    const unknown = await runCli(root, ["--nada"]);
    assertEquals(unknown.code, 2);
    assertStringIncludes(unknown.stderr, "--nada");
  });
});
