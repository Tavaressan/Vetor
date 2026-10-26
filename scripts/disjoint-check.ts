// Ponto de entrada CLI para verificação de conjuntos disjuntos (Issue #495).
//
// Uso: deno run -A scripts/disjoint-check.ts <repo-root> [--default-branch=<nome>]
//        <candidata> <outra> [<outra>...]
//
// Compara a branch candidata com CADA uma das outras branches da onda (as já integradas e as que
// ainda vão integrar). Saída:
//   DISJOINT                                   exit 0 — sem interseção de arquivos nem de módulos
//   OVERLAP: <outra> modules=[..] files=[..]   exit 1 — uma linha por branch que sobrepõe
//   exit 2 — uso incorreto, ou conjunto de arquivos tocados indisponível (sem cache nem git)
import {
  computeTouchedFiles,
  evaluateAgainstOthers,
  loadTouchedFiles,
  resolveDefaultBranch,
  sanitizeBranchName,
  type TouchedFilesCache,
} from "./lib/disjoint-merge.ts";

function printUsage(): void {
  console.error(
    "uso: deno run -A scripts/disjoint-check.ts <repo-root> [--default-branch=<nome>] " +
      "<candidata> <outra> [<outra>...]",
  );
}

if (import.meta.main) {
  const args = Deno.args;
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length < 3) {
    printUsage();
    Deno.exit(2);
  }

  const [repoRoot, candidate, ...otherBranches] = positional;
  let defaultBranch = args.find((a) => a.startsWith("--default-branch="))?.slice(17);

  // Cache primeiro; sem cache, recalcula via git (RF-03, edge case de cache ausente).
  const resolve = (branch: string): TouchedFilesCache | null => {
    const cached = loadTouchedFiles(repoRoot, branch);
    if (cached) return cached;
    defaultBranch ??= resolveDefaultBranch(repoRoot) ?? undefined;
    return defaultBranch ? computeTouchedFiles(repoRoot, branch, defaultBranch) : null;
  };

  const candidateFiles = resolve(candidate);
  const othersTouched = otherBranches.map((branch) => ({ branch, touched: resolve(branch) }));

  const missing = [
    ...(candidateFiles ? [] : [candidate]),
    ...othersTouched.filter((m) => !m.touched).map((m) => m.branch),
  ];
  if (!candidateFiles || missing.length > 0) {
    console.error(
      `ERRO: arquivos tocados indisponíveis (sem cache nem diff git) para: ${
        missing.map(sanitizeBranchName).join(", ")
      }`,
    );
    Deno.exit(2);
  }

  const { disjoint, overlaps } = evaluateAgainstOthers(
    candidateFiles,
    othersTouched.map((m) => ({ ...m.touched!, branch: m.branch })),
  );

  if (disjoint) {
    console.log("DISJOINT");
    Deno.exit(0);
  }

  for (const o of overlaps) {
    const parts: string[] = [];
    if (o.overlappingModules.length > 0) {
      parts.push(`modules=[${o.overlappingModules.join(", ")}]`);
    }
    if (o.overlappingFiles.length > 0) {
      parts.push(`files=[${o.overlappingFiles.join(", ")}]`);
    }
    console.log(`OVERLAP: ${o.branch} ${parts.join(" ")}`);
  }
  Deno.exit(1);
}
