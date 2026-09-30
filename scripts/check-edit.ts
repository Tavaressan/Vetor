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

import { detectProject } from "./lib/project.ts";
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

function localBin(dir: string, name: string): string | null {
  const bin = Deno.build.os === "windows"
    ? `${dir}/node_modules/.bin/${name}.cmd`
    : `${dir}/node_modules/.bin/${name}`;
  return exists(bin) ? bin : null;
}

/** tsc local do projeto. Sem ele instalado, não há typecheck a fazer. */
function localTsc(dir: string): string | null {
  return localBin(dir, "tsc");
}

/** Detecta se o diretório do projeto usa Next.js. */
export function isNextProject(dir: string): boolean {
  if (
    exists(`${dir}/next.config.js`) ||
    exists(`${dir}/next.config.mjs`) ||
    exists(`${dir}/next.config.ts`)
  ) {
    return true;
  }
  if (exists(`${dir}/package.json`)) {
    try {
      const pkg = JSON.parse(Deno.readTextFileSync(`${dir}/package.json`)) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return Boolean(pkg.dependencies?.next || pkg.devDependencies?.next);
    } catch {
      return false;
    }
  }
  return false;
}

export const NEXT_FALSE_POSITIVE_TYPES = ["LayoutProps", "PageProps", "RouteContext"];

/**
 * Filtra diagnósticos falsos positivos de tipos globais gerados pelo Next.js (issue #345).
 * Em Next.js App Router, tipos como LayoutProps, PageProps e RouteContext são gerados
 * dinamicamente por next typegen / build e podem acusar TS2304/TS2552 em tsc puro.
 */
export function filterNextDiagnostics(output: string): string {
  const lines = output.split(/\r?\n/);
  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  const isErrorHeader = (line: string): boolean => {
    return /:\d+(:\d+)?\s*-\s*error\s+TS\d+:/i.test(line) ||
      /\(\d+,\d+\):\s*error\s+TS\d+:/i.test(line);
  };

  for (const line of lines) {
    if (isErrorHeader(line)) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
      }
      currentBlock = [line];
    } else {
      currentBlock.push(line);
    }
  }
  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  const validBlocks = blocks.filter((block) => {
    const text = block.join("\n");
    const isFalsePositive = NEXT_FALSE_POSITIVE_TYPES.some((typeName) => {
      const exactMatch = new RegExp(`error TS(?:2304|2552):.*['"]${typeName}['"]`);
      return exactMatch.test(text);
    });
    return !isFalsePositive;
  });

  const remaining = validBlocks
    .map((b) => b.filter((l) => !/^Found \d+ errors?/.test(l.trim())).join("\n").trim())
    .filter((b) => b.length > 0)
    .join("\n\n")
    .trim();

  return remaining;
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
    // Sem tsconfig o tsc não sabe as opções do projeto; um check com defaults produziria
    // erros que não são erros do projeto.
    if (!exists(`${dir}/tsconfig.json`)) quiet();
    const tsc = localTsc(dir);
    if (!tsc) quiet();

    const isNext = isNextProject(dir);
    if (isNext) {
      const nextBin = localBin(dir, "next");
      if (nextBin) {
        // Tenta gerar os tipos globais do Next.js antes do tsc (issue #345)
        await runWithTimeout(nextBin, ["typegen"], dir);
      }
    }

    const result = await runWithTimeout(tsc, ["--noEmit"], dir);
    if (result && result.code !== 0 && result.output) {
      const output = isNext ? filterNextDiagnostics(result.output) : result.output;
      if (output) emit(output);
    }
    quiet();
  }

  quiet();
}

if (import.meta.main) {
  await main();
}
