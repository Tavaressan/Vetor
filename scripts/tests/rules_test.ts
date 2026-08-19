import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderRules } from "../lib/rules.ts";
import type { Conventions, ProjectInfo } from "../lib/project.ts";

const deno: ProjectInfo = {
  runtime: "deno",
  packageManager: "deno",
  testCommand: "deno task test",
  needsInstall: false,
};

const node: ProjectInfo = {
  runtime: "node",
  packageManager: "pnpm",
  testCommand: "pnpm test",
  needsInstall: true,
};

function only(info: ProjectInfo, conv: Conventions) {
  const files = renderRules(info, conv);
  assertEquals(files.length, 1);
  return files[0];
}

Deno.test("deno: task fmt detectada vira convenção de formatação", () => {
  const file = only(deno, { denoTasks: ["test", "fmt"] });

  assertEquals(file.path, ".claude/rules/vetor/deno.md");
  assertStringIncludes(file.content, "deno fmt");
  assertStringIncludes(file.content, 'paths:\n  - "**/*.ts"');
});

// O teste que protege o princípio do módulo: convenção não observada não é afirmada.
Deno.test("deno: sem task lint, nenhuma linha sobre lint", () => {
  const file = only(deno, { denoTasks: ["test", "fmt"] });

  assertEquals(file.content.includes("lint"), false);
});

Deno.test("deno: com package.json, não afirma ausência de node_modules", () => {
  const file = only({ ...deno, needsInstall: true }, { denoTasks: ["test"] });

  assertEquals(file.content.includes("node_modules"), false);
});

Deno.test("node: sem script de test, não inventa comando de teste", () => {
  const file = only(node, { nodeScripts: ["build"] });

  assertStringIncludes(file.content, "`pnpm`");
  assertEquals(file.content.includes("pnpm test"), false);
});

Deno.test("node: type module vira convenção de ESM", () => {
  const file = only(node, { nodeScripts: ["test"], nodeModuleType: "module" });

  assertStringIncludes(file.content, "pnpm test");
  assertStringIncludes(file.content, "type: module");
});

Deno.test("runtime fora do escopo não gera rule", () => {
  const rust: ProjectInfo = {
    runtime: "rust",
    packageManager: "cargo",
    testCommand: "cargo test",
    needsInstall: false,
  };

  assertEquals(renderRules(rust, {}), []);
});
