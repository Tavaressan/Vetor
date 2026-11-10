// Script descartável da issue #620: classifica issues por heurística determinística
// a partir de metadados existentes e compara com o que o PR que fechou cada uma precisou.
//
// Uso (a partir da raiz do repo):
//   deno run -A docs/investigations/metadados-para-classificacao/analisar.ts \
//     --issues /tmp/vetor-issues-620.json --out docs/investigations/metadados-para-classificacao/resultado.json
//
// Sem --fetch-prs usa só os dados já embutidos no resultado (se existir cache em
// docs/investigations/metadados-para-classificacao/pr-cache.json).

type IssueLabel = { name: string; description?: string; color?: string };
type PRRef = {
  number: number;
  repository?: { owner?: { login?: string }; name?: string };
};
type Issue = {
  number: number;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED";
  labels: IssueLabel[];
  closedAt?: string | null;
  createdAt?: string;
  url?: string;
  closedByPullRequestsReferences?: PRRef[];
};

type PRFile = { path: string; additions: number; deletions: number };
type PRInfo = { number: number; files: PRFile[]; title: string; state: string };

type TaskProfile = {
  domains: string[];
  operations: string[];
  complexity: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
  requirements: {
    filesystem?: boolean;
    terminal?: boolean;
    browser?: boolean;
    git?: boolean;
    parallelism?: boolean;
    longContext?: boolean;
  };
  confidence: number; // 0..1
  confidenceSignals: Record<string, number>;
  rationale: string[];
};

type Actual = {
  domains: string[];
  operations: string[];
  requirements: TaskProfile["requirements"];
  complexity: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
  prNumbers: number[];
  filesChanged: number;
  pathsSample: string[];
};

type Row = {
  number: number;
  title: string;
  state: string;
  labels: string[];
  predicted: TaskProfile;
  actual?: Actual;
  comparison?: {
    domainOk: boolean;
    operationOk: boolean;
    complexityOk: boolean;
    riskOk: boolean;
    requirementsOk: boolean;
    overall: "acerto" | "parcial" | "erro" | "sem-pr";
    notes: string[];
  };
};

const CHECKLIST_ITEM_RE = /^[ \t]*[-*][ \t]+\[[ xX]\][ \t]+(.+?)[ \t]*$/gm;
const BACKTICK_TOKEN_RE = /`([^`\n]+)`/g;
const PATH_TOKEN_RE = /^[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z][A-Za-z0-9]*$/;
const ROOT_FILE_EXT = new Set([
  "cjs",
  "js",
  "json",
  "jsonc",
  "lock",
  "md",
  "mjs",
  "toml",
  "ts",
  "yaml",
  "yml",
  "sh",
  "sql",
  "css",
  "html",
  "rs",
  "py",
  "go",
  "java",
]);

function flag(name: string): string | undefined {
  const i = Deno.args.indexOf(name);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return Deno.args.includes(name);
}

function extractAcceptanceCriteria(body: string): string[] {
  return [...(body ?? "").matchAll(CHECKLIST_ITEM_RE)].map((m) => m[1]);
}
function extractTargetFiles(text: string): string[] {
  const files = new Set<string>();
  for (const m of (text ?? "").matchAll(BACKTICK_TOKEN_RE)) {
    const token = m[1].trim().replaceAll("\\", "/");
    if (!PATH_TOKEN_RE.test(token)) continue;
    const ext = token.slice(token.lastIndexOf(".") + 1);
    if (token.includes("/") || ROOT_FILE_EXT.has(ext)) files.add(token);
  }
  return [...files];
}

function parseTitleOp(title: string): { op?: string; domainHint?: string } {
  const t = title.trim();
  const m = t.match(/^([a-z]+)(?:\(([^)]+)\))?!?:/i);
  if (m) return { op: m[1].toLowerCase(), domainHint: m[2]?.toLowerCase() };
  const spike = t.match(/^spike\b/i);
  if (spike) return { op: "spike" };
  return {};
}

const MODULE_PREFIXES: { prefix: string; module: string }[] = [
  { prefix: "cli/", module: "cli" },
  { prefix: "scripts/", module: "scripts" },
  { prefix: "skills/", module: "skills" },
  { prefix: "agents/", module: "agents" },
  { prefix: "hooks/", module: "hooks" },
  { prefix: "opencode/", module: "opencode" },
  { prefix: "docs/", module: "docs" },
  { prefix: "wiki/", module: "wiki" },
  { prefix: ".github/", module: "ci" },
  { prefix: "tests/", module: "tests" },
];

function moduleForPath(p: string): string {
  const path = p.replace(/^\.?\//, "");
  for (const e of MODULE_PREFIXES) {
    if (path.startsWith(e.prefix)) return e.module;
  }
  // catch-all root
  return "root";
}
function modulesForPaths(paths: string[]): string[] {
  const set = new Set(paths.map(moduleForPath));
  return [...set];
}

function domainFromModule(mod: string): string {
  const map: Record<string, string> = {
    cli: "cli/instalador",
    scripts: "scripts/automação",
    skills: "skills/fluxos",
    agents: "agents",
    hooks: "hooks/segurança",
    opencode: "compat-opencode",
    docs: "documentação",
    wiki: "documentação",
    ci: "ci/infra",
    tests: "testes",
    root: "núcleo/config",
  };
  return map[mod] ?? mod;
}

function classify(issue: Issue): TaskProfile {
  const labels = issue.labels.map((l) => l.name);
  const title = issue.title;
  const body = issue.body ?? "";
  const { op, domainHint } = parseTitleOp(title);
  const ac = extractAcceptanceCriteria(body);
  const targets = extractTargetFiles(`${title}\n${body}`);
  const targetModules = modulesForPaths(targets);
  const rationale: string[] = [];
  const signals: Record<string, number> = {};

  // operations
  const ops = new Set<string>();
  if (op) {
    ops.add(op);
    signals.titlePrefix = 1;
    rationale.push(`prefixo de título: ${op}`);
  }
  if (labels.includes("spike") || /spike/i.test(title)) ops.add("spike");
  if (labels.includes("bug") || op === "fix") ops.add("fix");
  if (labels.includes("enhancement") || op === "feat" || op === "enhancement") ops.add("implement");
  if (op === "docs" || labels.includes("documentation")) ops.add("docs");
  if (op === "refactor") ops.add("refactor");
  if (op === "test") ops.add("test");
  if (op === "perf") ops.add("optimize");
  if (ops.size === 0) {
    ops.add("change");
    rationale.push("operação inferida como mudança genérica");
  }

  // domains from labels and targets
  const domains = new Set<string>();
  const labelModuleMap: Record<string, string> = {
    scripts: "scripts/automação",
    cli: "cli/instalador",
    skills: "skills/fluxos",
    hooks: "hooks/segurança",
    agents: "agents",
    docs: "documentação",
    compat: "compatibilidade",
    spec: "spec/design",
    "ai-generated": "backlog",
  };
  for (const l of labels) {
    if (labelModuleMap[l]) {
      domains.add(labelModuleMap[l]);
      signals.label = (signals.label ?? 0) + 0.25;
    }
  }
  if (domainHint) {
    const dh = domainHint.split(/[,\s/]+/).filter(Boolean);
    for (const d of dh) domains.add(d);
    signals.titleScope = 0.2;
    rationale.push(`escopo no título: ${domainHint}`);
  }
  for (const m of targetModules) domains.add(domainFromModule(m));
  if (targets.length) {
    signals.targetFiles = 0.3;
    rationale.push(`arquivos-alvo inferidos: ${targets.slice(0, 5).join(", ")}`);
  }
  if (domains.size === 0) domains.add("indefinido");

  // requirements
  const req: TaskProfile["requirements"] = {
    filesystem: true,
    git: true,
    terminal: false,
    browser: false,
    parallelism: false,
    longContext: false,
  };
  const text = `${title}\n${body}`.toLowerCase();
  if (/deno|npm|gh |git |bash|script|teste|test|lint|fmt|check|ci|build|rodar|execut/.test(text)) {
    req.terminal = true;
  }
  if (/browser|navegador|playwright|puppeteer|chrome|ui visual|screenshot|e2e web/.test(text)) {
    req.browser = true;
  }
  if (/paralel|onda|workers?|subagente|sub-agent|concurrent|simult/.test(text)) {
    req.parallelism = true;
  }
  if (
    /spec|adr|investiga|relatório|document|amostra|inventário|muitos arquivos|codebase|repositório inteiro/
      .test(text) || body.length > 2500
  ) req.longContext = true;
  if (ops.has("spike") || ops.has("docs")) {
    req.terminal = true;
    req.longContext = true;
  }
  rationale.push(
    `requisitos: ${Object.entries(req).filter(([, v]) => v).map(([k]) => k).join(", ")}`,
  );

  // complexity
  let complexity: TaskProfile["complexity"] = "low";
  const moduleCount =
    new Set(targetModules.length ? targetModules : labels.filter((l) => labelModuleMap[l])).size;
  if (ac.length >= 5 || body.length > 3000 || moduleCount >= 3) complexity = "high";
  else if (ac.length >= 3 || body.length > 1200 || moduleCount >= 2 || ops.has("spike")) {
    complexity = "medium";
  }
  rationale.push(
    `complexidade ${complexity} (AC=${ac.length}, body=${body.length}, módulos=${moduleCount})`,
  );

  // risk
  let risk: TaskProfile["risk"] = "low";
  if (
    labels.includes("bug") &&
    /hook|safety|security|guard|permission|merge|delete|push|credential|secret|auth/i.test(text)
  ) risk = "high";
  else if (
    labels.includes("bug") || ops.has("refactor") ||
    /safety|hook|merge|worktree|isolat|permission/i.test(text)
  ) risk = "medium";
  if (ops.has("docs") && !/safety|hook|security/i.test(text)) risk = "low";
  if (ops.has("spike")) risk = "low";
  rationale.push(`risco ${risk}`);

  // confidence: based on available structured signals
  let conf = 0.2; // base
  if (signals.titlePrefix) conf += 0.2;
  if (signals.label) conf += Math.min(0.2, signals.label);
  if (signals.targetFiles) conf += 0.2;
  if (ac.length > 0) {
    conf += 0.1;
    signals.acceptanceCriteria = 0.1;
    rationale.push(`${ac.length} critérios de aceite`);
  }
  if (domainHint) conf += 0.1;
  conf = Math.min(1, Number(conf.toFixed(2)));
  if (conf < 0.45) rationale.push("confiança baixa: poucos sinais estruturais");
  else if (conf < 0.7) rationale.push("confiança média");
  else rationale.push("confiança alta");

  return {
    domains: [...domains],
    operations: [...ops],
    complexity,
    risk,
    requirements: req,
    confidence: conf,
    confidenceSignals: signals,
    rationale,
  };
}

async function run(cmd: string[], cwd?: string) {
  const p = new Deno.Command(cmd[0], { args: cmd.slice(1), cwd, stdout: "piped", stderr: "piped" });
  const o = await p.output();
  return {
    code: o.code,
    out: new TextDecoder().decode(o.stdout),
    err: new TextDecoder().decode(o.stderr),
  };
}

async function fetchPR(
  pr: number,
  repo: string,
  cache: Record<string, PRInfo>,
): Promise<PRInfo | undefined> {
  if (cache[String(pr)]) return cache[String(pr)];
  const r = await run([
    "gh",
    "pr",
    "view",
    String(pr),
    "--repo",
    repo,
    "--json",
    "number,title,state,files",
  ]);
  if (r.code !== 0) return undefined;
  try {
    const j = JSON.parse(r.out);
    const info: PRInfo = {
      number: j.number,
      title: j.title,
      state: j.state,
      files: (j.files ?? []).map((f: any) => ({
        path: f.path,
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
      })),
    };
    cache[String(pr)] = info;
    return info;
  } catch {
    return undefined;
  }
}

function classifyActual(issue: Issue, prInfos: PRInfo[]): Actual | undefined {
  if (prInfos.length === 0) return undefined;
  const paths = prInfos.flatMap((p) => p.files.map((f) => f.path));
  const uniqPaths = [...new Set(paths)];
  const mods = modulesForPaths(uniqPaths);
  const domains = [...new Set(mods.map(domainFromModule))];
  const ops = new Set<string>();
  const title = issue.title.toLowerCase();
  const { op } = parseTitleOp(issue.title);
  if (op) ops.add(op);
  if (/fix/i.test(issue.title) || issue.labels.some((l) => l.name === "bug")) ops.add("fix");
  if (/feat|enhancement/i.test(issue.title) || issue.labels.some((l) => l.name === "enhancement")) {
    ops.add("implement");
  }
  if (mods.every((m) => m === "docs" || m === "wiki")) ops.add("docs");
  if (/spike/i.test(issue.title) || issue.labels.some((l) => l.name === "spike")) ops.add("spike");
  if (/refactor/i.test(issue.title)) ops.add("refactor");
  if (uniqPaths.some((p) => /_test\.|\.test\.|tests\//.test(p))) ops.add("test");

  const req: TaskProfile["requirements"] = {
    filesystem: true,
    git: true,
    terminal: true, // PR implica git/terminal
    browser: false,
    parallelism: false,
    longContext: uniqPaths.length > 8 || ops.has("spike"),
  };
  const text = uniqPaths.join(" ").toLowerCase();
  if (/browser|playwright|puppeteer|e2e/.test(text)) req.browser = true;

  let complexity: TaskProfile["complexity"] = "low";
  const total = uniqPaths.length;
  if (total >= 10 || mods.length >= 3) complexity = "high";
  else if (total >= 4 || mods.length >= 2) complexity = "medium";

  let risk: TaskProfile["risk"] = "low";
  if (
    mods.some((m) => m === "hooks") ||
    uniqPaths.some((p) => /safety|guard|permission|auth|secret/.test(p))
  ) risk = "high";
  else if (
    mods.some((m) => ["scripts", "cli", "agents"].includes(m)) ||
    issue.labels.some((l) => l.name === "bug")
  ) risk = "medium";
  if (mods.every((m) => m === "docs" || m === "wiki")) risk = "low";

  return {
    domains,
    operations: [...ops],
    requirements: req,
    complexity,
    risk,
    prNumbers: prInfos.map((p) => p.number),
    filesChanged: total,
    pathsSample: uniqPaths.slice(0, 12),
  };
}

function intersectNonEmpty(a: string[], b: string[]): boolean {
  const B = new Set(b);
  return a.some((x) => B.has(x));
}
function reqMatch(pred: TaskProfile["requirements"], act: TaskProfile["requirements"]): boolean {
  // browser false-positive is bad; others lenient
  const keys = ["filesystem", "terminal", "browser", "git", "parallelism", "longContext"] as const;
  let ok = 0, total = 0;
  for (const k of keys) {
    total++;
    if (Boolean(pred[k]) === Boolean(act[k])) ok++;
  }
  return ok >= 5; // allow 1 miss
}

function compare(pred: TaskProfile, actual?: Actual): Row["comparison"] {
  if (!actual) {
    return {
      domainOk: false,
      operationOk: false,
      complexityOk: false,
      riskOk: false,
      requirementsOk: false,
      overall: "sem-pr",
      notes: ["sem PR associado para comparação"],
    };
  }
  const notes: string[] = [];
  const domainOk = intersectNonEmpty(pred.domains, actual.domains) ||
    (pred.domains.includes("indefinido") && false);
  const operationOk = intersectNonEmpty(pred.operations, actual.operations);
  const complexityOk = pred.complexity === actual.complexity;
  const riskOk = pred.risk === actual.risk || (pred.risk === "medium" && actual.risk === "low") ||
    (pred.risk === "low" && actual.risk === "medium");
  const requirementsOk = reqMatch(pred.requirements, actual.requirements);
  if (!domainOk) {
    notes.push(`domínio previsto=${pred.domains.join("|")} real=${actual.domains.join("|")}`);
  }
  if (!operationOk) {
    notes.push(`op prevista=${pred.operations.join("|")} real=${actual.operations.join("|")}`);
  }
  if (!complexityOk) {
    notes.push(`complexidade prevista=${pred.complexity} real=${actual.complexity}`);
  }
  if (!riskOk) notes.push(`risco previsto=${pred.risk} real=${actual.risk}`);
  if (!requirementsOk) notes.push(`requisitos divergiram`);
  const score =
    [domainOk, operationOk, complexityOk, riskOk, requirementsOk].filter(Boolean).length;
  let overall: "acerto" | "parcial" | "erro" = "erro";
  if (score >= 4) overall = "acerto";
  else if (score >= 2) overall = "parcial";
  return { domainOk, operationOk, complexityOk, riskOk, requirementsOk, overall, notes };
}

function summarize(rows: Row[]) {
  const withPr = rows.filter((r) => r.comparison && r.comparison.overall !== "sem-pr");
  const counts = { acerto: 0, parcial: 0, erro: 0, "sem-pr": 0 } as Record<string, number>;
  for (const r of rows) counts[r.comparison?.overall ?? "sem-pr"]++;
  const dim = (k: keyof NonNullable<Row["comparison"]>) =>
    withPr.filter((r) => (r.comparison as any)[k]).length;
  const byConfidence = {
    high: rows.filter((r) => r.predicted.confidence >= 0.7),
    mid: rows.filter((r) => r.predicted.confidence >= 0.45 && r.predicted.confidence < 0.7),
    low: rows.filter((r) => r.predicted.confidence < 0.45),
  };
  const acc = (arr: Row[]) => {
    const w = arr.filter((r) => r.comparison && r.comparison.overall !== "sem-pr");
    if (!w.length) return null;
    return Number(
      (w.filter((r) => r.comparison?.overall === "acerto").length / w.length).toFixed(3),
    );
  };
  return {
    total: rows.length,
    withPr: withPr.length,
    counts,
    accuracyOverall: withPr.length ? Number((counts.acerto / withPr.length).toFixed(3)) : null,
    accuracyPartialOrBetter: withPr.length
      ? Number(((counts.acerto + counts.parcial) / withPr.length).toFixed(3))
      : null,
    byDimension: {
      domain: withPr.length ? Number((dim("domainOk") / withPr.length).toFixed(3)) : null,
      operation: withPr.length ? Number((dim("operationOk") / withPr.length).toFixed(3)) : null,
      complexity: withPr.length ? Number((dim("complexityOk") / withPr.length).toFixed(3)) : null,
      risk: withPr.length ? Number((dim("riskOk") / withPr.length).toFixed(3)) : null,
      requirements: withPr.length
        ? Number((dim("requirementsOk") / withPr.length).toFixed(3))
        : null,
    },
    byConfidenceBucket: {
      high_ge_0_7: { n: byConfidence.high.length, accuracy: acc(byConfidence.high) },
      mid_0_45_0_7: { n: byConfidence.mid.length, accuracy: acc(byConfidence.mid) },
      low_lt_0_45: { n: byConfidence.low.length, accuracy: acc(byConfidence.low) },
    },
  };
}

async function main() {
  const issuesPath = flag("--issues") ?? "/tmp/vetor-issues-620.json";
  const outPath = flag("--out") ??
    "docs/investigations/metadados-para-classificacao/resultado.json";
  const cachePath = flag("--pr-cache") ??
    "docs/investigations/metadados-para-classificacao/pr-cache.json";
  const repo = flag("--repo") ?? "Tavaressan/Vetor";
  const limit = Number(flag("--limit") ?? "50");
  const doFetch = hasFlag("--fetch-prs");

  const issues: Issue[] = JSON.parse(await Deno.readTextFile(issuesPath)).slice(0, limit);
  let prCache: Record<string, PRInfo> = {};
  try {
    prCache = JSON.parse(await Deno.readTextFile(cachePath));
  } catch { /* ok */ }

  if (doFetch) {
    for (const iss of issues) {
      const refs = iss.closedByPullRequestsReferences ?? [];
      for (const ref of refs) {
        if (!prCache[String(ref.number)]) {
          const info = await fetchPR(ref.number, repo, prCache);
          if (info) console.error(`fetched PR #${ref.number}`);
        }
      }
    }
    await Deno.writeTextFile(cachePath, JSON.stringify(prCache, null, 2));
  }

  const rows: Row[] = [];
  for (const iss of issues) {
    const predicted = classify(iss);
    const refs = iss.closedByPullRequestsReferences ?? [];
    const prInfos = refs.map((r) => prCache[String(r.number)]).filter(Boolean) as PRInfo[];
    const actual = classifyActual(iss, prInfos);
    const comparison = compare(predicted, actual);
    rows.push({
      number: iss.number,
      title: iss.title,
      state: iss.state,
      labels: iss.labels.map((l) => l.name),
      predicted,
      actual,
      comparison,
    });
  }

  const summary = summarize(rows);
  const out = { generatedAt: new Date().toISOString(), repo, source: issuesPath, summary, rows };
  await Deno.writeTextFile(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.main) main();
