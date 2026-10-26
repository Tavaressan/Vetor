// Gates determinísticos da entrega autônoma em --headless (Issue #497, RF-05).
//
// O merge sem humano só acontece se os QUATRO gates passarem: CI 100% SUCCESS, zero achados
// impeditivos nas revisões consultivas, zero colisões em `vetor-checks.sh migrations` e
// `mergeable == MERGEABLE`. Cada gate devolve PASS, FAIL (definitivo) ou PENDING (ainda sem dado
// suficiente: CI rodando, revisão não publicada, GitHub recalculando). Na dúvida, nunca PASS.

export type GateStatus = "PASS" | "FAIL" | "PENDING";
export type GateName = "ci" | "reviews" | "migrations" | "mergeable";

export interface GateResult {
  gate: GateName;
  status: GateStatus;
  detail: string;
}

/** Item de `statusCheckRollup`: CheckRun (status/conclusion) ou StatusContext (state). */
export interface RollupEntry {
  __typename?: string;
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string;
  state?: string;
}

export interface PrComment {
  author?: { login?: string };
  body: string;
}

const result = (gate: GateName, status: GateStatus, detail: string): GateResult => ({
  gate,
  status,
  detail,
});

/** Gate 1 — todos os checks concluídos com SUCCESS; NEUTRAL/SKIPPED também reprovam (gate estrito). */
export function evaluateCiGate(rollup: RollupEntry[] | null | undefined): GateResult {
  if (!rollup || rollup.length === 0) {
    return result("ci", "PENDING", "nenhum check reportado ainda");
  }

  const failed: string[] = [];
  const pending: string[] = [];
  for (const entry of rollup) {
    const name = entry.name ?? entry.context ?? "(sem nome)";
    const isStatusContext = entry.__typename === "StatusContext" ||
      (entry.state !== undefined && entry.status === undefined);

    if (isStatusContext) {
      if (entry.state === "SUCCESS") continue;
      if (entry.state === "PENDING" || entry.state === "EXPECTED") pending.push(name);
      else failed.push(`${name}=${entry.state ?? "?"}`);
      continue;
    }

    if (entry.status !== "COMPLETED") {
      pending.push(name);
    } else if (entry.conclusion !== "SUCCESS") {
      failed.push(`${name}=${entry.conclusion ?? "?"}`);
    }
  }

  if (failed.length > 0) return result("ci", "FAIL", `checks sem SUCCESS: ${failed.join(", ")}`);
  if (pending.length > 0) {
    return result("ci", "PENDING", `checks em andamento: ${pending.join(", ")}`);
  }
  return result("ci", "PASS", `${rollup.length} check(s) com SUCCESS`);
}

/** Gate 4 — `mergeable == MERGEABLE`; UNKNOWN (GitHub recalculando) nunca vale como MERGEABLE. */
export function evaluateMergeableGate(state: string | null | undefined): GateResult {
  if (state === "MERGEABLE") return result("mergeable", "PASS", "MERGEABLE");
  if (state === "CONFLICTING") return result("mergeable", "FAIL", "CONFLICTING");
  return result("mergeable", "PENDING", `estado ${state || "indisponível"}`);
}

/** Gate 3 — saída de `vetor-checks.sh migrations`: 0 = sem colisão. */
export function evaluateMigrationsGate(
  outcome: { code: number; output: string } | null,
): GateResult {
  if (outcome === null) {
    return result("migrations", "PENDING", "verificação de migrations indisponível");
  }
  if (outcome.code === 0) return result("migrations", "PASS", "sem colisão de versão");
  return result(
    "migrations",
    "FAIL",
    outcome.output.trim().slice(0, 300) || `exit ${outcome.code}`,
  );
}

/**
 * Mesma dispensa do ship §8.5: PR só com `.md` em docs/ ou wiki/, `*.md` na raiz ou lockfiles não
 * dispara revisão de código, então a ausência de comentário de revisão não é pendência.
 */
export function isReviewExempt(files: string[]): boolean {
  if (files.length === 0) return false;
  return files.every((file) => {
    const path = file.replace(/\\/g, "/");
    if (/^(docs|wiki)\/.+\.md$/.test(path)) return true;
    if (/^[^/]+\.md$/.test(path)) return true;
    return /(^|\/)(package-lock\.json|deno\.lock)$/.test(path) || /\.lock$/.test(path);
  });
}

const CODE_REVIEW_HEADER = /^\s*## Code Review \(Vetor\)/i;
const SECURITY_REVIEW_HEADER = /^\s*## Security Review \(Vetor\)/i;
// Linha de tabela do code-review com severidade `blocker` (agents/code-review.md).
const BLOCKER_ROW = /^\|\s*blocker\s*\|/gim;
// Relatório de segurança: "Severity: High", "Severidade: Crítica", linha de tabela com a severidade.
const SECURITY_BLOCKING = [
  /(severity|severidade)[^\n]*\b(critical|cr[ií]tic[ao]|high|alta|blocker)\b/gi,
  /^\|\s*(critical|crítica|critica|high|alta|blocker)\s*\|/gim,
];

/**
 * Gate 2 — revisões consultivas. Só conta comentário publicado pelo mesmo usuário autenticado do
 * `gh`: o merge é irreversível e qualquer pessoa com acesso de comentário poderia forjar um
 * "Code Review (Vetor)" limpo. Vale o comentário mais recente de cada tipo. Code review ausente em PR
 * de código é PENDING (o subagente roda em background); security review ausente é aceito, pois a skill
 * nativa pode não existir na sessão (ship §8.5).
 */
export function evaluateReviewsGate(input: {
  files: string[];
  comments: PrComment[];
  viewer: string | null;
}): GateResult {
  if (isReviewExempt(input.files)) {
    return result("reviews", "PASS", "revisões dispensadas (PR só de docs/lockfile)");
  }
  if (!input.viewer) {
    return result("reviews", "PENDING", "autor das revisões não verificável (gh api user falhou)");
  }

  const own = input.comments.filter((c) => c.author?.login === input.viewer);
  const latest = (header: RegExp) => [...own].reverse().find((c) => header.test(c.body));

  const codeReview = latest(CODE_REVIEW_HEADER);
  if (!codeReview) {
    return result("reviews", "PENDING", "code review ainda não publicado no PR");
  }

  const blockers = codeReview.body.match(BLOCKER_ROW)?.length ?? 0;
  if (blockers > 0) {
    return result("reviews", "FAIL", `code review com ${blockers} achado(s) blocker`);
  }

  const security = latest(SECURITY_REVIEW_HEADER);
  if (security) {
    const hits = SECURITY_BLOCKING.reduce((n, re) => n + (security.body.match(re)?.length ?? 0), 0);
    if (hits > 0) {
      return result(
        "reviews",
        "FAIL",
        `security review com ${hits} achado(s) crítico/alto/blocker`,
      );
    }
    return result("reviews", "PASS", "code review sem blocker; security review sem achado crítico");
  }
  return result("reviews", "PASS", "code review sem blocker (security review não publicado)");
}

/** FAIL se algum gate falhou; senão PENDING se algum depende de dado futuro; senão PASS. */
export function combineGates(results: GateResult[]): GateStatus {
  if (results.some((r) => r.status === "FAIL")) return "FAIL";
  if (results.some((r) => r.status === "PENDING")) return "PENDING";
  return "PASS";
}

export interface GateDeps {
  /** `gh <args>`; ok=false em qualquer falha (rede, HTTP, autenticação). */
  gh(args: string[]): Promise<{ ok: boolean; stdout: string }>;
  /** Roda a verificação de migrations no worktree contra `origin/<default>`; null se não rodou. */
  migrations(
    worktree: string,
    defaultBranch: string,
  ): Promise<{ code: number; output: string } | null>;
}

interface PrView {
  statusCheckRollup?: RollupEntry[];
  mergeable?: string;
  comments?: PrComment[];
  files?: { path: string }[];
}

/** Coleta os dados do PR e avalia os quatro gates, na ordem ci, reviews, migrations, mergeable. */
export async function evaluateAutoShipGates(
  options: { pr: string; worktree: string; defaultBranch: string },
  deps: GateDeps,
): Promise<GateResult[]> {
  const view = await deps.gh([
    "pr",
    "view",
    options.pr,
    "--json",
    "statusCheckRollup,mergeable,comments,files",
  ]);

  let pr: PrView | null = null;
  if (view.ok) {
    try {
      pr = JSON.parse(view.stdout) as PrView;
    } catch {
      pr = null;
    }
  }
  if (!pr) {
    const detail = "gh pr view indisponível";
    return (["ci", "reviews", "migrations", "mergeable"] as GateName[]).map((g) =>
      result(g, "PENDING", detail)
    );
  }

  const user = await deps.gh(["api", "user", "--jq", ".login"]);
  const viewer = user.ok ? user.stdout.trim() || null : null;

  return [
    evaluateCiGate(pr.statusCheckRollup),
    evaluateReviewsGate({
      files: (pr.files ?? []).map((f) => f.path),
      comments: pr.comments ?? [],
      viewer,
    }),
    evaluateMigrationsGate(await deps.migrations(options.worktree, options.defaultBranch)),
    evaluateMergeableGate(pr.mergeable),
  ];
}
