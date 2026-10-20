import { assertEquals, assertStringIncludes, equal } from "@std/assert";
import { detectProject } from "../lib/project.ts";
import { detectModules, renderMap, writeConfig } from "../detect-project.ts";
import { detectKnowledgeState, FilesystemKnowledgeProvider } from "../lib/knowledge.ts";

Deno.test("projeto único com subdiretórios comuns gera apenas root", () => {
  // Simula um projeto com subdiretórios comuns (src, scripts, etc)
  // que não têm runtime próprio
  const root = detectProject(".");
  const modules = detectModules(root);

  // Deve estar vazio porque nenhum subdiretório tem runtime próprio
  equal(modules, []);
});

Deno.test("monorepo com packages detecta corretamente", () => {
  // Criar estrutura temporária de monorepo
  try {
    Deno.mkdirSync("test-packages/a", { recursive: true });
    Deno.mkdirSync("test-packages/b", { recursive: true });
    Deno.writeTextFileSync("test-packages/a/package.json", '{"name": "a"}');
    Deno.writeTextFileSync("test-packages/b/package.json", '{"name": "b"}');

    // Precisamos executar em um contexto onde podemos ler test-packages
    // Como o teste roda no diretório de teste, vamos verificar se há módulos
    const hasTestPackages = Deno.readDirSync(".").find((e) => e.name === "test-packages");

    if (hasTestPackages) {
      const modules = detectModules(detectProject("."));
      // Se houver test-packages, deve ter detectado como módulo
      const hasPackages = modules.some((m) => m.name === "test-packages");
      equal(hasPackages, true);
    }
  } finally {
    // Limpar
    try {
      Deno.removeSync("test-packages", { recursive: true });
    } catch {
      // ignorar se não existir
    }
  }
});

Deno.test("módulo sem arquivos de teste é marcado sem suíte", () => {
  const directory = Deno.makeTempDirSync();
  try {
    Deno.mkdirSync(`${directory}/scripts`, { recursive: true });
    Deno.writeTextFileSync(`${directory}/scripts/deno.json`, "{}");

    const modules = detectModules(detectProject(directory), directory);

    equal(modules, [{ name: "scripts", command: null }]);
    equal(renderMap(detectProject(directory), modules).includes("`sem suíte de testes`"), true);
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("módulo com arquivo de teste mantém o comando", () => {
  const directory = Deno.makeTempDirSync();
  try {
    Deno.mkdirSync(`${directory}/scripts`, { recursive: true });
    Deno.writeTextFileSync(`${directory}/scripts/deno.json`, "{}");
    Deno.writeTextFileSync(`${directory}/scripts/task_test.ts`, "Deno.test('ok', () => {});");

    const modules = detectModules(detectProject(directory), directory);

    equal(modules, [{ name: "scripts", command: "cd scripts && deno test -A" }]);
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

// --- Issue #224: writeConfig preserva `knowledge` e FilesystemKnowledgeProvider
// continua funcionando independentemente do que estiver (ou não) em config.json ---

Deno.test("writeConfig preserva knowledge.enabled: false; FilesystemKnowledgeProvider segue funcionando", async () => {
  const directory = Deno.makeTempDirSync();
  const originalCwd = Deno.cwd();
  try {
    Deno.mkdirSync(`${directory}/.claude/vetor`, { recursive: true });
    Deno.writeTextFileSync(
      `${directory}/.claude/vetor/config.json`,
      JSON.stringify({ knowledge: { enabled: false } }),
    );

    Deno.chdir(directory);
    const config = writeConfig(detectProject("."));

    // Critério de aceite: knowledge.enabled: false sobrevive à escrita de runtime/testCommand.
    assertEquals((config.knowledge as { enabled: boolean }).enabled, false);
    assertEquals(detectKnowledgeState(config), { status: "disabled", label: "○ Disabled" });

    // Critério de aceite: com knowledge desabilitado no config, o provider filesystem
    // continua funcionando sem erro — ele nunca lê config.json.
    const provider = new FilesystemKnowledgeProvider(`${directory}/docs`);
    await provider.create("doc.md", "conteúdo");
    assertEquals(await provider.read("doc.md"), "conteúdo");
  } finally {
    Deno.chdir(originalCwd);
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("writeConfig sem config.json prévio: knowledge ausente -> Filesystem", () => {
  const directory = Deno.makeTempDirSync();
  const originalCwd = Deno.cwd();
  try {
    Deno.mkdirSync(`${directory}/.claude/vetor`, { recursive: true });

    Deno.chdir(directory);
    const config = writeConfig(detectProject("."));

    assertEquals(config.knowledge, undefined);
    assertEquals(detectKnowledgeState(config), { status: "filesystem", label: "✓ Filesystem" });
  } finally {
    Deno.chdir(originalCwd);
    Deno.removeSync(directory, { recursive: true });
  }
});

// --- Issue #405: subdiretório ignorado pelo .gitignore não vira módulo e raiz permanece no mapa ---

Deno.test("detectModules: subdiretório no .gitignore é ignorado (git check-ignore)", () => {
  const directory = Deno.makeTempDirSync();
  try {
    new Deno.Command("git", { args: ["init", "-q"], cwd: directory }).outputSync();
    Deno.writeTextFileSync(`${directory}/.gitignore`, "ignored-sub/\npackages/ignored-nested/\n");

    Deno.mkdirSync(`${directory}/ignored-sub`, { recursive: true });
    Deno.writeTextFileSync(`${directory}/ignored-sub/package.json`, '{"name": "ignored-sub"}');

    Deno.mkdirSync(`${directory}/packages/ignored-nested`, { recursive: true });
    Deno.writeTextFileSync(`${directory}/packages/ignored-nested/package.json`, '{"name": "ignored-nested"}');

    Deno.mkdirSync(`${directory}/real-pkg`, { recursive: true });
    Deno.writeTextFileSync(`${directory}/real-pkg/package.json`, '{"name": "real-pkg", "scripts": {"test": "echo ok"}}');

    const modules = detectModules(detectProject(directory), directory);
    assertEquals(modules.map((m) => m.name), ["real-pkg"]);
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("detectModules: subdiretório no .gitignore é ignorado sem repositório git (fallback)", () => {
  const directory = Deno.makeTempDirSync();
  try {
    Deno.writeTextFileSync(`${directory}/.gitignore`, "ignored-sub/\n");

    Deno.mkdirSync(`${directory}/ignored-sub`, { recursive: true });
    Deno.writeTextFileSync(`${directory}/ignored-sub/package.json`, '{"name": "ignored-sub"}');

    const modules = detectModules(detectProject(directory), directory);
    assertEquals(modules, []);
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("renderMap: raiz com runtime detectado é sempre mapeada como módulo (./) mesmo com submódulos", () => {
  const root = {
    runtime: "deno" as const,
    packageManager: "deno",
    testCommand: "deno task test",
    needsInstall: false,
    hasDedicatedTests: true,
  };
  const modules = [{ name: "packages/a", command: "cd packages/a && npm test" }];

  const map = renderMap(root, modules);

  // A raiz deve estar presente na tabela de comandos
  assertStringIncludes(map, "| `root` | `deno task test` | Módulo raiz |");
  // O submódulo também
  assertStringIncludes(map, "| `packages/a` | `cd packages/a && npm test` | Auto-detectado |");
  // E na tabela de mapeamento, ambos devem estar presentes, com ./ para root
  assertStringIncludes(map, "| `packages/a/` | `packages/a` |");
  assertStringIncludes(map, "| `./` | `root` |");
});
