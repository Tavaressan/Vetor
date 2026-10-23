/**
 * Varredura automática de rascunhos entregues por workers delegados (issue #483).
 *
 * Uso:
 *   deno run -A scripts/draft-scan.ts <arquivo...>
 *   deno run -A scripts/draft-scan.ts --base <ref>
 *
 * Com `--base`, varre os arquivos de texto alterados em relação a `<ref>` (diff do working tree
 * contra a base, mais arquivos novos não rastreados) e compara os blocos JSDoc com a base. O
 * repositório é o do diretório atual: rode a CLI de dentro do worktree que contém o rascunho.
 *
 * Códigos de saída: 0 = limpo; 1 = achados (um por linha, `arquivo:linha: [regra] mensagem`);
 * 2 = falha interna ou de uso, com diagnóstico em stderr. Uma falha nunca sai como "limpo".
 */

import { scanDraftBytes } from "./lib/draft-sanitizer.ts";

const EXIT_CLEAN = 0;
const EXIT_FINDINGS = 1;
const EXIT_FAILURE = 2;

const USAGE = "uso: draft-scan.ts <arquivo...> | draft-scan.ts --base <ref>";

// Em modo --base só entram arquivos de texto; binários não são UTF-8 e dariam falso achado
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".md",
  ".markdown",
  ".sh",
  ".bash",
  ".yml",
  ".yaml",
  ".toml",
  ".txt",
  ".html",
  ".css",
]);

interface ScanTarget {
  /** Caminho usado para ler o arquivo no disco */
  readPath: string;
  /** Caminho exibido nos achados */
  displayPath: string;
  /** Conteúdo na base, quando o arquivo já existia (para comparar blocos JSDoc) */
  baseText?: string;
}

class UsageError extends Error {}

function isTextFile(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot !== -1 && TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

async function git(cwd: string, args: string[]): Promise<Uint8Array> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    throw new Error(`git ${args.join(" ")} falhou (código ${output.code}): ${stderr}`);
  }
  return output.stdout;
}

const decodeLossy = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

const splitNul = (bytes: Uint8Array) => decodeLossy(bytes).split("\0").filter(Boolean);

async function collectBaseTargets(
  ref: string,
): Promise<{ targets: ScanTarget[]; skipped: string[] }> {
  const root = decodeLossy(await git(Deno.cwd(), ["rev-parse", "--show-toplevel"])).trim();
  try {
    await git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    throw new Error(`base inválida: '${ref}' não é um commit`);
  }

  // Saída de name-status -z: status\0caminho\0 (sem renames, sem arquivos removidos)
  const diff = splitNul(
    await git(root, ["diff", "--name-status", "-z", "--no-renames", "--diff-filter=d", ref]),
  );
  const changed = new Map<string, boolean>();
  for (let i = 0; i + 1 < diff.length; i += 2) {
    changed.set(diff[i + 1], diff[i] !== "A");
  }
  const untracked = splitNul(await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]));
  for (const path of untracked) changed.set(path, false);

  const targets: ScanTarget[] = [];
  const skipped: string[] = [];
  for (const [path, existedInBase] of changed) {
    if (!isTextFile(path)) {
      skipped.push(path);
      continue;
    }
    const baseText = existedInBase
      ? decodeLossy(await git(root, ["show", `${ref}:${path}`]))
      : undefined;
    targets.push({ readPath: `${root}/${path}`, displayPath: path, baseText });
  }
  return { targets, skipped };
}

function parseArguments(args: string[]): { files: string[] } | { baseRef: string } {
  if (args[0] === "--base") {
    if (args.length !== 2 || args[1].startsWith("-")) {
      throw new UsageError(`--base exige exatamente uma ref. ${USAGE}`);
    }
    return { baseRef: args[1] };
  }
  if (args.length === 0 || args.some((arg) => arg.startsWith("--"))) {
    throw new UsageError(USAGE);
  }
  return { files: args };
}

export async function main(args: string[]): Promise<number> {
  try {
    const parsed = parseArguments(args);
    let targets: ScanTarget[];
    let skipped: string[] = [];
    if ("baseRef" in parsed) {
      ({ targets, skipped } = await collectBaseTargets(parsed.baseRef));
    } else {
      targets = parsed.files.map((path) => ({ readPath: path, displayPath: path }));
    }

    let findings = 0;
    for (const target of targets) {
      const report = scanDraftBytes(await Deno.readFile(target.readPath), {
        filename: target.displayPath,
        originalText: target.baseText,
      });
      for (const issue of report.issues) {
        findings++;
        console.log(`${target.displayPath}:${issue.line ?? 1}: [${issue.rule}] ${issue.message}`);
      }
    }

    for (const path of skipped) {
      console.log(`draft-scan: ignorado (extensão fora da lista de texto): ${path}`);
    }
    const summary = findings === 0 ? "nenhum achado" : `${findings} achado(s)`;
    console.log(`draft-scan: ${targets.length} arquivo(s) escaneado(s), ${summary}.`);
    return findings === 0 ? EXIT_CLEAN : EXIT_FINDINGS;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      error instanceof UsageError
        ? `draft-scan: ${message}`
        : `draft-scan: falha interna: ${message}`,
    );
    return EXIT_FAILURE;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
