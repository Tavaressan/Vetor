// Auto-detecção da estrutura de testes do projeto.
// Gera .claude/vetor/module-test-map.md e persiste o runtime detectado em
// .claude/vetor/config.json (consumido por prepare-worktree.ts e pelas skills).
//
// Substitui scripts/auto-detect.sh. Diferenças: --force funciona de verdade e o
// runtime detectado é persistido em vez de descartado.

import { detectConventions, detectProject, type ProjectInfo, readJson } from "./lib/project.ts";
import { renderRules, RULES_DIR } from "./lib/rules.ts";

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
  command: string;
}

/** Um módulo pode estar no subdiretório direto ou um nível abaixo (monorepos rasos). */
function detectModules(root: ProjectInfo): Module[] {
  const modules: Module[] = [];

  for (const entry of Deno.readDirSync(".")) {
    if (!entry.isDirectory || IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;

    const info = detectProject(entry.name);
    if (info.runtime !== "unknown") {
      modules.push({ name: entry.name, command: `cd ${entry.name} && ${info.testCommand}` });
      continue;
    }

    // Nada neste nível: procura um módulo um nível abaixo.
    let nested: Module | null = null;
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
    } else if (root.runtime !== "unknown") {
      modules.push({ name: entry.name, command: `cd ${entry.name} && ${root.testCommand}` });
    }
  }

  return modules;
}

function renderMap(root: ProjectInfo, modules: Module[]): string {
  const rows = modules.length > 0
    ? modules.map((m) => `| \`${m.name}\` | \`${m.command}\` | Auto-detectado |`).join("\n")
    : `| \`root\` | \`${
      root.testCommand || "AJUSTE: comando de teste não detectado"
    }\` | Módulo raiz |`;

  const mapping = modules.length > 0
    ? modules.map((m) => `| \`${m.name}/\` | \`${m.name}\` |`).join("\n")
    : "| `./` | `root` |";

  return `# Module Test Map — Auto-Gerado

Gerado pela auto-detecção do Vetor (runtime: **${root.runtime}**).
Revise os comandos: eles são executados de forma headless pelo \`fix-loop-agent\` e pelo \`worktree-ship\`.

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

function writeConfig(info: ProjectInfo): void {
  // Preserva chaves já existentes (ex.: maxConcurrentWorkers).
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
  // quem já rodou o /vetor antes só as receberia com --force — que destruiria o map.
  const mapSkipped = mapExisted && !force;

  Deno.mkdirSync(TARGET_DIR, { recursive: true });

  const root = detectProject(".");
  const modules = detectModules(root);

  if (!mapSkipped) Deno.writeTextFileSync(MAP_FILE, renderMap(root, modules));
  writeConfig(root);
  const rules = writeRules(root, force);

  console.log(JSON.stringify({
    status: mapSkipped ? "skipped" : mapExisted ? "overwritten" : "created",
    runtime: root.runtime,
    packageManager: root.packageManager,
    testCommand: root.testCommand,
    modules: modules.map((m) => m.name),
    path: MAP_FILE,
    rules,
  }));
}

main();
