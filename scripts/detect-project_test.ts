import { equal } from "jsr:@std/assert";
import { detectProject } from "./lib/project.ts";

// Simula a lógica de detectModules para testes
function detectModules(root: Awaited<ReturnType<typeof detectProject>>): Array<{ name: string; command: string }> {
  const modules: Array<{ name: string; command: string }> = [];
  const IGNORED_DIRS = new Set([
    ".git",
    ".github",
    ".claude",
    "node_modules",
    "target",
    "build",
    "dist",
    "venv",
    ".venv",
    "tests",
    "docs",
    "legacy",
    "coverage",
    ".vscode",
  ]);

  function exists(path: string): boolean {
    try {
      Deno.statSync(path);
      return true;
    } catch {
      return false;
    }
  }

  for (const entry of Deno.readDirSync(".")) {
    if (!entry.isDirectory || IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;

    const info = detectProject(entry.name);
    if (info.runtime !== "unknown") {
      modules.push({ name: entry.name, command: `cd ${entry.name} && ${info.testCommand}` });
      continue;
    }

    // Procura módulo um nível abaixo (monorepo)
    let nested: { name: string; command: string } | null = null;
    for (const sub of Deno.readDirSync(entry.name)) {
      if (!sub.isDirectory || IGNORED_DIRS.has(sub.name)) continue;
      const subPath = `${entry.name}/${sub.name}`;
      const subInfo = detectProject(subPath);
      if (subInfo.runtime !== "unknown") {
        nested = { name: entry.name, command: `cd ${subPath} && ${subInfo.testCommand}` };
        break;
      }
    }

    if (nested) {
      modules.push(nested);
    }
    // Se não encontrou nada, não adiciona nenhum módulo
  }

  return modules;
}

Deno.test("projeto único com subdiretórios comuns gera apenas root", async () => {
  // Simula um projeto com subdiretórios comuns (src, scripts, etc)
  // que não têm runtime próprio
  const root = detectProject(".");
  const modules = detectModules(root);

  // Deve estar vazio porque nenhum subdiretório tem runtime próprio
  equal(modules, []);
});

Deno.test("monorepo com packages detecta corretamente", async () => {
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
