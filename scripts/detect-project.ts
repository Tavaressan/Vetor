// Auto-detecção da estrutura de testes do projeto.
// Gera .claude/vetor/module-test-map.md e persiste o runtime detectado em
// .claude/vetor/config.json (consumido por prepare-worktree.ts e pelas skills).
//
// Substitui scripts/auto-detect.sh. Diferenças: --force funciona de verdade e o
// runtime detectado é persistido em vez de descartado.

import { detectConventions, detectProject, type ProjectInfo, readJson } from "./lib/project.ts";
import { renderRules, RULES_DIR } from "./lib/rules.ts";
import { detectKnowledgeState } from "./lib/knowledge.ts";

const TARGET_DIR = ".claude/vetor";
const MAP_FILE = `${TARGET_DIR}/module-test-map.md`;
const CONFIG_FILE = `${TARGET_DIR}/config.json`;

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

interface Module {
  name: string;
  command: string | null;
}

const TEST_FILE = /(?:_test|\.(?:test|spec))\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_test\.go$/;
const TEST_DIRS = new Set(["test", "tests", "__tests__"]);

function hasTestSuite(path: string): boolean {
  const paths = [path];

  while (paths.length > 0) {
    const current = paths.pop()!;
    for (const entry of Deno.readDirSync(current)) {
      const entryPath = `${current}/${entry.name}`;
      if (entry.isDirectory) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        if (TEST_DIRS.has(entry.name)) return true;
        paths.push(entryPath);
      } else if (entry.isFile && TEST_FILE.test(entryPath)) {
        return true;
      }
    }
  }

  return false;
}

function simpleGlobMatch(glob: string, target: string): boolean {
  if (glob === target) return true;
  const regexStr = "^" + glob
    .replace(/[.+^${}()|[\]\\]/g, (c) => "\\" + c)
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".") + "$";
  try {
    return new RegExp(regexStr).test(target);
  } catch {
    return false;
  }
}

function isIgnoredByGitignoreFile(relPath: string, rootDir: string): boolean {
  const gitignorePath = `${rootDir}/.gitignore`;
  if (!exists(gitignorePath)) return false;

  try {
    const content = Deno.readTextFileSync(gitignorePath);
    const lines = content.split(/\r?\n/);
    const normRelPath = relPath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
    const baseName = normRelPath.split("/").pop() ?? normRelPath;

    for (const rawLine of lines) {
      let line = rawLine.trim();
      if (!line || line.startsWith("#") || line.startsWith("!")) continue;
      line = line.replaceAll("\\", "/");
      if (line.endsWith("/")) line = line.slice(0, -1);
      if (line.startsWith("/")) line = line.slice(1);

      if (!line.includes("/")) {
        if (simpleGlobMatch(line, baseName)) return true;
      }
      if (simpleGlobMatch(line, normRelPath)) return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function isIgnoredByGit(relPath: string, rootDir = "."): boolean {
  try {
    const formatted = relPath.endsWith("/") ? relPath : `${relPath}/`;
    const res = new Deno.Command("git", {
      args: ["check-ignore", "-q", formatted],
      cwd: rootDir,
      stdout: "null",
      stderr: "null",
    }).outputSync();
    if (res.code === 0) return true;
    if (res.code === 1) return false;
  } catch {
    // git indisponível ou falha na execução
  }

  return isIgnoredByGitignoreFile(relPath, rootDir);
}

/** Um módulo pode estar no subdiretório direto ou um nível abaixo (monorepos rasos). */
export function detectModules(_root: ProjectInfo, directory = "."): Module[] {
  const modules: Module[] = [];

  for (const entry of Deno.readDirSync(directory)) {
    if (!entry.isDirectory || IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    if (isIgnoredByGit(entry.name, directory)) continue;

    const modulePath = `${directory}/${entry.name}`;
    const info = detectProject(modulePath);
    if (info.runtime !== "unknown") {
      modules.push({
        name: entry.name,
        command: hasTestSuite(modulePath) ? `cd ${entry.name} && ${info.testCommand}` : null,
      });
      continue;
    }

    // Nada neste nível: procura um módulo um nível abaixo.
    let nested: Module | null = null;
    for (const sub of Deno.readDirSync(modulePath)) {
      if (!sub.isDirectory || IGNORED_DIRS.has(sub.name) || sub.name.startsWith(".")) continue;
      const subRelPath = `${entry.name}/${sub.name}`;
      if (isIgnoredByGit(subRelPath, directory)) continue;
      const subPath = `${entry.name}/${sub.name}`;
      const subInfo = detectProject(`${directory}/${subPath}`);
      if (subInfo.runtime !== "unknown") {
        nested = {
          name: entry.name,
          command: hasTestSuite(`${directory}/${subPath}`)
            ? `cd ${subPath} && ${subInfo.testCommand}`
            : null,
        };
        break;
      }
    }

    if (nested) {
      modules.push(nested);
    }
  }

  return modules;
}

export function renderMap(root: ProjectInfo, modules: Module[]): string {
  const rowsList: string[] = [];
  if (root.runtime !== "unknown" || modules.length === 0) {
    const rootNote = "Módulo raiz";
    const rootCommand = root.testCommand || "AJUSTE: comando de teste não detectado";
    rowsList.push(`| \`root\` | \`${rootCommand}\` | ${rootNote} |`);
  }
  for (const m of modules) {
    rowsList.push(`| \`${m.name}\` | \`${m.command ?? "sem suíte de testes"}\` | Auto-detectado |`);
  }
  const rows = rowsList.join("\n");

  const mappingRows = modules.map((m) => `| \`${m.name}/\` | \`${m.name}\` |`);
  if (root.runtime !== "unknown" || modules.length === 0) {
    mappingRows.push("| `./` | `root` |");
  }
  const mapping = mappingRows.join("\n");

  return `# Module Test Map — Auto-Gerado

Gerado pela auto-detecção do Vetor (runtime: **${root.runtime}**).
Revise os comandos: eles são executados de forma headless pelo \`fix\` e pelo \`ship\`.

---

## Comandos por módulo

| Módulo | Comando headless | Notas |
|--------|------------------|-------|
${rows}

## Detecção de módulo por arquivos alterados

| Prefixo do path | Módulo |
|-----------------|--------|
${mapping}

## Regras de execução

### Exclusões obrigatórias
Todo \`find\`/\`grep\` executado pelas skills deve excluir:
\`.claude/worktrees/*\`, \`node_modules/\`, \`target/\`, \`build/\`, \`dist/\`, \`.venv/\`, \`__pycache__/\`.
`;
}

export function writeConfig(info: ProjectInfo): Record<string, unknown> {
  // Preserva chaves já existentes (ex.: maxConcurrentWorkers, knowledge).
  let config: Record<string, unknown> = {};
  if (exists(CONFIG_FILE)) {
    try {
      config = readJson(CONFIG_FILE) as Record<string, unknown>;
    } catch {
      console.error(`AVISO: ${CONFIG_FILE} inválido; será reescrito.`);
    }
  }

  config.maxConcurrentWorkers ??= 5;
  config.runtime = info.runtime;
  config.packageManager = info.packageManager;
  config.testCommand = info.testCommand;

  Deno.writeTextFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
  return config;
}

/** Mesmo contrato do map: arquivo existente é preservado sem --force. */
function writeRules(root: ProjectInfo, force: boolean) {
  const files = renderRules(root, detectConventions("."));
  const created: string[] = [];
  const skipped: string[] = [];

  if (files.length === 0) return { created, skipped };

  Deno.mkdirSync(RULES_DIR, { recursive: true });
  for (const file of files) {
    if (exists(file.path) && !force) {
      skipped.push(file.path);
      continue;
    }
    Deno.writeTextFileSync(file.path, file.content);
    created.push(file.path);
  }

  return { created, skipped };
}

function main() {
  const force = Deno.args.includes("--force");
  const mapExisted = exists(MAP_FILE);
  // A guarda é por arquivo: um map preexistente não impede a geração das rules, senão
  // quem já rodou o /vetor:install antes só as receberia com --force — que destruiria o map.
  const mapSkipped = mapExisted && !force;

  Deno.mkdirSync(TARGET_DIR, { recursive: true });

  const root = detectProject(".");
  const modules = detectModules(root);

  if (!mapSkipped) Deno.writeTextFileSync(MAP_FILE, renderMap(root, modules));
  const config = writeConfig(root);
  const rules = writeRules(root, force);
  const knowledge = detectKnowledgeState(config);

  console.log(JSON.stringify({
    status: mapSkipped ? "skipped" : mapExisted ? "overwritten" : "created",
    runtime: root.runtime,
    packageManager: root.packageManager,
    testCommand: root.testCommand,
    modules: modules.map((m) => m.name),
    path: MAP_FILE,
    rules,
    knowledge,
  }));
}

if (import.meta.main) main();
