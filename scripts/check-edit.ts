// Diagnostics por edição (hook PostToolUse, matcher Edit|Write).
//
// Motivação (issue #36): sem isto, o issue-worker só descobre erro de tipo, import quebrado
// ou símbolo inexistente RODANDO O TESTE — e cada descoberta dessas queima uma das 5
// iterações do fix-loop. Aqui o erro volta junto com o resultado do próprio Edit, e o
// worker corrige na hora, sem gastar iteração.
//
// Contrato do Claude Code: exit 0 + `hookSpecificOutput.additionalContext` injeta o texto
// ao lado do resultado da tool. Hooks disparam dentro de subagentes, então isto alcança o
// worker. Sem erro → silêncio absoluto: ruído a cada edição custaria mais do que resolve.

import { detectProject, readJson } from "./lib/project.ts";
import { isWithin } from "./lib/guard.ts";

const CHECKABLE = /\.(ts|tsx|mts|cts)$/;
const TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 4_000;

interface HookInput {
  tool_input?: { file_path?: string };
  cwd?: string;
}

function quiet(): never {
  Deno.exit(0);
}

function emit(diagnostics: string): never {
  const text = diagnostics.length > MAX_OUTPUT
    ? `${diagnostics.slice(0, MAX_OUTPUT)}\n[...saída truncada]`
    : diagnostics;

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        `Typecheck do arquivo editado falhou. Corrija antes de rodar os testes:\n\n${text}`,
    },
  }));
  Deno.exit(0);
}

/** Diretório do projeto mais próximo do arquivo — cobre monorepo, sem sair do cwd. */
function nearestProjectDir(filePath: string, cwd: string): string | null {
  let dir = filePath.replaceAll("\\", "/").split("/").slice(0, -1).join("/");

  while (dir && isWithin(dir, cwd)) {
    if (detectProject(dir).runtime !== "unknown") return dir;
    const parent = dir.split("/").slice(0, -1).join("/");
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/** Um typecheck lento não pode segurar a edição: estourou o tempo, não diz nada. */
async function runWithTimeout(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; output: string } | null> {
  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(), TIMEOUT_MS);

  try {
    const result = await new Deno.Command(cmd, {
      args,
      cwd,
      // Sem NO_COLOR a saída vem cheia de escapes ANSI, que só ocupariam contexto do worker.
      env: { NO_COLOR: "1" },
      stdout: "piped",
      stderr: "piped",
      signal: timer.signal,
    }).output();

    const decoder = new TextDecoder();
    return {
      code: result.code,
      output: (decoder.decode(result.stdout) + decoder.decode(result.stderr)).trim(),
    };
  } catch {
    // Binário ausente ou timeout: sem diagnóstico a reportar.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** tsc local do projeto. Sem ele instalado, não há typecheck a fazer. */
function localTsc(dir: string): string | null {
  const bin = Deno.build.os === "windows"
    ? `${dir}/node_modules/.bin/tsc.cmd`
    : `${dir}/node_modules/.bin/tsc`;
  return exists(bin) ? bin : null;
}

const NEXT_TYPEGEN_DIAGNOSTIC =
  /error TS2304: Cannot find name '(?:LayoutProps|PageProps|RouteContext)'\.?$/;

export function filterNextTypegenDiagnostics(output: string, usesNext: boolean): string {
  if (!usesNext) return output;
  return output.split("\n").filter((line) => !NEXT_TYPEGEN_DIAGNOSTIC.test(line.trim())).join("\n")
    .trim();
}

function usesNext(dir: string): boolean {
  try {
    const pkg = JSON.parse(Deno.readTextFileSync(`${dir}/package.json`));
    return Boolean(
      pkg.dependencies?.next || pkg.devDependencies?.next || pkg.peerDependencies?.next,
    );
  } catch {
    return false;
  }
}

/**
 * Raiz do projeto: o ancestral mais próximo com `.git` (diretório, ou arquivo em worktree
 * linkado). Num monorepo o `dir` do tsc é o subpacote, mas config e cache do Vetor vivem na raiz.
 */
function findProjectRoot(dir: string): string {
  const start = dir.replaceAll("\\", "/");
  let current = start;

  while (current) {
    if (exists(`${current}/.git`)) return current;
    const parent = current.split("/").slice(0, -1).join("/");
    if (parent === current) break;
    current = parent;
  }

  return start;
}

/**
 * Typecheck de Node/TypeScript no PostToolUse é opt-in (issue #514, spike #394): em projetos
 * médios o `tsc` síncrono adiciona de 2,5s a 15s a cada Edit/Write. Ative com
 * `hooks.typecheckOnEdit: true` em `.claude/vetor/config.json` (na raiz do projeto) ou com
 * `VETOR_TYPECHECK_ON_EDIT=true`. O caminho Deno (`deno check`) não passa por aqui.
 */
export function shouldCheckNode(dir: string): boolean {
  if (Deno.env.get("VETOR_TYPECHECK_ON_EDIT") === "true") return true;

  const configPath = `${findProjectRoot(dir)}/.claude/vetor/config.json`;
  if (!exists(configPath)) return false;

  try {
    const config = readJson(configPath) as { hooks?: { typecheckOnEdit?: unknown } } | null;
    return config?.hooks?.typecheckOnEdit === true;
  } catch {
    // config inválido: mantém o opt-out padrão em vez de quebrar o hook
    return false;
  }
}

/**
 * Garante o cache do Vetor e devolve o `--tsBuildInfoFile` do `dir`. Um buildinfo por pacote
 * evita que dois pacotes do monorepo descartem o cache um do outro a cada edição.
 */
export function prepareTsCache(dir: string): string {
  const root = findProjectRoot(dir);
  const cacheDir = `${root}/.claude/vetor/cache`;

  try {
    Deno.mkdirSync(cacheDir, { recursive: true });
    // Auto-ignorado: a entrada `.claude/vetor/cache/` no .gitignore da raiz não cobriria um
    // cache em subpacote, e projetos já instalados nem teriam a entrada.
    if (!exists(`${cacheDir}/.gitignore`)) {
      Deno.writeTextFileSync(`${cacheDir}/.gitignore`, "*\n");
    }
  } catch {
    // Sem cache gravável o tsc só perde o ganho incremental.
  }

  const relative = dir.replaceAll("\\", "/").slice(root.length).replace(/^\//, "");
  const name = relative ? `tsc-${relative.replaceAll("/", "_")}.tsbuildinfo` : "tsc.tsbuildinfo";
  return `${cacheDir}/${name}`;
}

async function main() {
  const raw = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer());

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    quiet();
  }

  const filePath = input.tool_input?.file_path;
  const cwd = input.cwd ?? Deno.cwd();
  if (!filePath || !CHECKABLE.test(filePath) || !isWithin(filePath, cwd)) quiet();

  const dir = nearestProjectDir(filePath, cwd);
  if (!dir) quiet();

  const { runtime } = detectProject(dir);

  if (runtime === "deno") {
    const result = await runWithTimeout("deno", ["check", filePath], dir);
    if (result && result.code !== 0 && result.output) emit(result.output);
    quiet();
  }

  if (runtime === "node") {
    // Issue #514: o tsc síncrono por edição é opt-in; o typecheck do projeto roda no
    // checkpoint do /vetor:fix, antes dos testes.
    if (!shouldCheckNode(dir)) quiet();

    // Sem tsconfig o tsc não sabe as opções do projeto; um check com defaults produziria
    // erros que não são erros do projeto.
    if (!exists(`${dir}/tsconfig.json`)) quiet();
    const tsc = localTsc(dir);
    if (!tsc) quiet();

    const result = await runWithTimeout(tsc, [
      "--noEmit",
      "--incremental",
      "--tsBuildInfoFile",
      prepareTsCache(dir),
    ], dir);
    if (result && result.code !== 0 && result.output) {
      const diagnostics = filterNextTypegenDiagnostics(result.output, usesNext(dir));
      if (diagnostics) emit(diagnostics);
    }
    quiet();
  }

  quiet();
}

if (import.meta.main) await main();
