// Script descartável da issue #620 (revisado): classifica issues por heurística
// determinística a partir de metadados existentes e compara com evidência do PR
// que fechou cada uma. O gabarito de operação/requisitos vem só do PR (título
// do PR mergeado e tipos de arquivos alterados), nunca do título/labels da issue.
//
// Uso (a partir da raiz do repo):
//   deno run -A docs/investigations/metadados-para-classificacao/analisar.ts \
//     --issues /tmp/vetor-issues-620.json \
//     --out docs/investigations/metadados-para-classificacao/resultado.json \
//     --fetch-prs --repo Tavaressan/Vetor --limit 50
//
// Cache local opcional de PRs: --pr-cache <path> (não deve ser commitado).

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

type Requirements = {
  filesystem?: boolean;
  terminal?: boolean;
  browser?: boolean;
  git?: boolean;
  parallelism?: boolean;
  longContext?: boolean;
};

type TaskProfile = {
  domains: string[];
  operations: string[];
  complexity: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
  requirements: Requirements;
  confidence: number;
  confidenceSignals: Record<string, number>;
  rationale: string[];
};

type Actual = {
  domains: string[];
  operations: string[];
  operationsEvidence: string[];
  requirements: Requirements; // só longContext/browser são observáveis; demais marcados como não observáveis
  requirementsEvidence: string[];
  complexity: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
  prNumbers: number[];
  prTitles: string[];
  filesChanged: number;
  pathsSample: string[];
};

type Compare = {
  domainOk: boolean;
  operationOk: boolean;
  complexityOk: boolean;
  riskOk: boolean;
  requirementsObservable: {
    browser: { predicted: boolean; actual: boolean; ok: boolean; actualPositive: boolean };
    longContext: { predicted: boolean; actual: boolean; ok: boolean; actualPositive: boolean };
  };
  overallStrict: "acerto" | "parcial" | "erro" | "sem-pr";
  notes: string[];
};

type CompactRow = {
  number: number;
  state: string;
  labels: string[];
  title: string;
  predicted: {
    domains: string[];
    operations: string[];
    complexity: string;
    risk: string;
    requirements: Requirements;
    confidence: number;
  };
  actual?: {
    domains: string[];
    operations: string[];
    operationsEvidence: string[];
    complexity: string;
    risk: string;
    requirements: Requirements;
    requirementsEvidence: string[];
    filesChanged: number;
    prNumbers: number[];
  };
  ok?: {
    domain: boolean;
    operation: boolean;
    complexity: boolean;
    risk: boolean;
    browser: boolean;
    longContext: boolean;
    overallStrict: string;
  };
  notes: string[];
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
  "tsx",
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
  const t = (title ?? "").trim();
  const m = t.match(/^([a-z]+)(?:\(([^)]+)\))?!?:/i);
  if (m) return { op: m[1].toLowerCase(), domainHint: m[2]?.toLowerCase() };
  if (/^spike\b/i.test(t)) return { op: "spike" };
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
  for (const e of MODULE_PREFIXES) if (path.startsWith(e.prefix)) return e.module;
  return "root";
}
function modulesForPaths(paths: string[]): string[] {
  return [...new Set(paths.map(moduleForPath))];
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

  const ops = new Set<string>();
  if (op) {
    ops.add(op);
    signals.titlePrefix = 1;
    rationale.push(`prefixo de título: ${op}`);
  }
  if (labels.includes("spike") || /spike/i.test(title)) ops.add("spike");
  if (labels.includes("bug") || op === "fix") ops.add("fix");
  if (labels.includes("enhancement") || op === "feat" || op === "enhancement") {
    ops.add("implement");
  }
  if (op === "docs" || labels.includes("documentation")) ops.add("docs");
  if (op === "refactor") ops.add("refactor");
  if (op === "test") ops.add("test");
  if (op === "perf") ops.add("optimize");
  if (ops.size === 0) ops.add("change");

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
  };
  for (const l of labels) {
    if (labelModuleMap[l]) {
      domains.add(labelModuleMap[l]);
      signals.label = (signals.label ?? 0) + 0.25;
    }
  }
  if (domainHint) {
    for (const d of domainHint.split(/[,\s/]+/).filter(Boolean)) domains.add(d);
    signals.titleScope = 0.2;
  }
  for (const m of targetModules) domains.add(domainFromModule(m));
  if (targets.length) signals.targetFiles = 0.3;
  if (domains.size === 0) domains.add("indefinido");

  const req: Requirements = {
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

  let complexity: TaskProfile["complexity"] = "low";
  const moduleCount = new Set(
    targetModules.length ? targetModules : labels.filter((l) => labelModuleMap[l]),
  ).size;
  if (ac.length >= 5 || body.length > 3000 || moduleCount >= 3) complexity = "high";
  else if (ac.length >= 3 || body.length > 1200 || moduleCount >= 2 || ops.has("spike")) {
    complexity = "medium";
  }

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

  let conf = 0.2;
  if (signals.titlePrefix) conf += 0.2;
  if (signals.label) conf += Math.min(0.2, signals.label);
  if (signals.targetFiles) conf += 0.2;
  if (ac.length > 0) {
    conf += 0.1;
    signals.acceptanceCriteria = 0.1;
  }
  if (domainHint) conf += 0.1;
  conf = Math.min(1, Number(conf.toFixed(2)));

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

async function runCmd(cmd: string[]) {
  const p = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    stdout: "piped",
    stderr: "piped",
  });
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
  const r = await runCmd([
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

function isDocPath(p: string): boolean {
  return /^(docs|wiki)\//.test(p) || /\.md$/i.test(p) && /^(docs|wiki)\//.test(p);
}
function isTestPath(p: string): boolean {
  return /(^|\/)(tests?|__tests__)\//.test(p) || /(_test|\.test|\.spec)\.[^/]+$/.test(p);
}

function classifyActual(issue: Issue, prInfos: PRInfo[]): Actual | undefined {
  if (prInfos.length === 0) return undefined;
  const paths = prInfos.flatMap((p) => p.files.map((f) => f.path));
  const uniqPaths = [...new Set(paths)];
  const mods = modulesForPaths(uniqPaths);
  const domains = [...new Set(mods.map(domainFromModule))];

  // Operação: SOMENTE evidência do PR (prefixo do título do PR e tipos de arquivo). Nunca issue.
  const ops = new Set<string>();
  const opEvidence: string[] = [];
  for (const pr of prInfos) {
    const pop = parseTitleOp(pr.title).op;
    if (pop) {
      ops.add(pop);
      opEvidence.push(`PR #${pr.number} título: ${pop}`);
    }
  }
  const allDocs = uniqPaths.length > 0 && uniqPaths.every((p) => /^(docs|wiki)\//.test(p));
  const allTests = uniqPaths.length > 0 && uniqPaths.every((p) => isTestPath(p));
  if (allDocs) {
    ops.add("docs");
    opEvidence.push("arquivos: somente docs/wiki");
  }
  if (allTests) {
    ops.add("test");
    opEvidence.push("arquivos: somente testes");
  }
  if (ops.has("spike")) opEvidence.push("prefixo spike no PR");
  if (ops.has("fix")) opEvidence.push("prefixo fix no PR");
  if (ops.has("feat") || ops.has("enhancement")) ops.add("implement");
  if (ops.size === 0) ops.add("change");

  // Requisitos: somente longContext e browser são observáveis por evidência do diff.
  // terminal/git/filesystem são quase constantes em PRs de código/docs neste fluxo e não medem necessidade.
  const req: Requirements = {
    filesystem: undefined,
    terminal: undefined,
    git: undefined,
    parallelism: undefined,
    browser: false,
    longContext: uniqPaths.length > 8 || ops.has("spike"),
  };
  const reqEvidence: string[] = [];
  const joined = uniqPaths.join(" ").toLowerCase();
  if (/browser|playwright|puppeteer|e2e/.test(joined)) {
    req.browser = true;
    reqEvidence.push("caminho sugere browser/e2e");
  }
  if (req.longContext) {
    reqEvidence.push(
      ops.has("spike")
        ? "spike/investigação (evidência de contexto longo pelo tipo de tarefa no PR)"
        : `${uniqPaths.length} arquivos alterados`,
    );
  }
  reqEvidence.push(
    "terminal/git/filesystem/parallelism não observáveis de forma confiável pelo diff; excluídos da acurácia de requisitos",
  );

  let complexity: TaskProfile["complexity"] = "low";
  const total = uniqPaths.length;
  if (total >= 10 || mods.length >= 3) complexity = "high";
  else if (total >= 4 || mods.length >= 2) complexity = "medium";

  let risk: TaskProfile["risk"] = "low";
  if (
    mods.some((m) => m === "hooks") ||
    uniqPaths.some((p) => /safety|guard|permission|auth|secret/.test(p))
  ) risk = "high";
  else if (mods.some((m) => ["scripts", "cli", "agents"].includes(m))) risk = "medium";
  if (mods.every((m) => m === "docs" || m === "wiki")) risk = "low";

  return {
    domains,
    operations: [...ops],
    operationsEvidence: opEvidence,
    requirements: req,
    requirementsEvidence: reqEvidence,
    complexity,
    risk,
    prNumbers: prInfos.map((p) => p.number),
    prTitles: prInfos.map((p) => p.title),
    filesChanged: total,
    pathsSample: uniqPaths.slice(0, 12),
  };
}

function intersectNonEmpty(a: string[], b: string[]): boolean {
  const B = new Set(b);
  return a.some((x) => B.has(x));
}

function compare(pred: TaskProfile, actual?: Actual): Compare {
  if (!actual) {
    return {
      domainOk: false,
      operationOk: false,
      complexityOk: false,
      riskOk: false,
      requirementsObservable: {
        browser: { predicted: false, actual: false, ok: false, actualPositive: false },
        longContext: { predicted: false, actual: false, ok: false, actualPositive: false },
      },
      overallStrict: "sem-pr",
      notes: ["sem PR associado para comparação"],
    };
  }
  const notes: string[] = [];
  const domainOk = intersectNonEmpty(pred.domains, actual.domains);
  const operationOk = intersectNonEmpty(pred.operations, actual.operations);
  const complexityOk = pred.complexity === actual.complexity;
  const riskOk = pred.risk === actual.risk ||
    (pred.risk === "medium" && actual.risk === "low") ||
    (pred.risk === "low" && actual.risk === "medium");

  const browserPred = Boolean(pred.requirements.browser);
  const browserAct = Boolean(actual.requirements.browser);
  const lcPred = Boolean(pred.requirements.longContext);
  const lcAct = Boolean(actual.requirements.longContext);
  const reqObs = {
    browser: {
      predicted: browserPred,
      actual: browserAct,
      ok: browserPred === browserAct,
      actualPositive: browserAct,
    },
    longContext: {
      predicted: lcPred,
      actual: lcAct,
      ok: lcPred === lcAct,
      actualPositive: lcAct,
    },
  };

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

  // Overall estrito considera 4 dimensões principais; requisitos observáveis reportados à parte.
  const score = [domainOk, operationOk, complexityOk, riskOk].filter(Boolean).length;
  let overallStrict: Compare["overallStrict"] = "erro";
  if (score === 4) overallStrict = "acerto";
  else if (score >= 2) overallStrict = "parcial";
  return {
    domainOk,
    operationOk,
    complexityOk,
    riskOk,
    requirementsObservable: reqObs,
    overallStrict,
    notes,
  };
}

function summarize(rows: { predicted: TaskProfile; actual?: Actual; compare: Compare }[]) {
  const withPr = rows.filter((r) => r.compare.overallStrict !== "sem-pr");
  const counts = { acerto: 0, parcial: 0, erro: 0, "sem-pr": 0 } as Record<string, number>;
  for (const r of rows) counts[r.compare.overallStrict]++;
  const dim = (k: "domainOk" | "operationOk" | "complexityOk" | "riskOk") =>
    withPr.filter((r) => r.compare[k]).length;
  const browser = withPr.map((r) => r.compare.requirementsObservable.browser);
  const lc = withPr.map((r) => r.compare.requirementsObservable.longContext);
  const reqStat = (arr: typeof browser) => ({
    comparable: arr.length,
    actualPositives: arr.filter((x) => x.actualPositive).length,
    correct: arr.filter((x) => x.ok).length,
    accuracy: arr.length ? Number((arr.filter((x) => x.ok).length / arr.length).toFixed(3)) : null,
  });
  return {
    total: rows.length,
    withPr: withPr.length,
    countsStrict: counts,
    partialCriterion:
      "parcial = 2 ou 3 das 4 dimensões principais corretas (domínio, operação, complexidade, risco); acerto = 4/4; erro = 0 ou 1/4. Requisitos observáveis (browser, longContext) reportados separadamente.",
    note:
      "A contagem 'parcial ou melhor' não é apresentada como resultado principal por ser leniente.",
    byDimension: {
      domain: withPr.length ? Number((dim("domainOk") / withPr.length).toFixed(3)) : null,
      operation_from_pr_evidence_only: withPr.length
        ? Number((dim("operationOk") / withPr.length).toFixed(3))
        : null,
      complexity: withPr.length ? Number((dim("complexityOk") / withPr.length).toFixed(3)) : null,
      risk: withPr.length ? Number((dim("riskOk") / withPr.length).toFixed(3)) : null,
    },
    requirementsObservableOnly: {
      browser: reqStat(browser),
      longContext: reqStat(lc),
      excluded:
        "terminal, git, filesystem e parallelism foram excluídos da acurácia: no gabarito por diff/PR eles são quase constantes ou não observáveis, então não medem capacidade real.",
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
      for (const ref of iss.closedByPullRequestsReferences ?? []) {
        if (!prCache[String(ref.number)]) {
          const info = await fetchPR(ref.number, repo, prCache);
          if (info) console.error(`fetched PR #${ref.number}`);
        }
      }
    }
    await Deno.writeTextFile(cachePath, JSON.stringify(prCache, null, 2));
  }

  const full = [];
  for (const iss of issues) {
    const predicted = classify(iss);
    const prInfos = (iss.closedByPullRequestsReferences ?? [])
      .map((r) => prCache[String(r.number)]).filter(Boolean) as PRInfo[];
    const actual = classifyActual(iss, prInfos);
    const compareRes = compare(predicted, actual);
    full.push({ iss, predicted, actual, compare: compareRes });
  }

  const summary = summarize(full);
  const compact: CompactRow[] = full.map(({ iss, predicted, actual, compare: c }) => ({
    number: iss.number,
    state: iss.state,
    labels: iss.labels.map((l) => l.name),
    title: iss.title,
    predicted: {
      domains: predicted.domains,
      operations: predicted.operations,
      complexity: predicted.complexity,
      risk: predicted.risk,
      requirements: predicted.requirements,
      confidence: predicted.confidence,
    },
    ...(actual
      ? {
        actual: {
          domains: actual.domains,
          operations: actual.operations,
          operationsEvidence: actual.operationsEvidence,
          complexity: actual.complexity,
          risk: actual.risk,
          requirements: actual.requirements,
          requirementsEvidence: actual.requirementsEvidence,
          filesChanged: actual.filesChanged,
          prNumbers: actual.prNumbers,
        },
      }
      : {}),
    ...(actual
      ? {
        ok: {
          domain: c.domainOk,
          operation: c.operationOk,
          complexity: c.complexityOk,
          risk: c.riskOk,
          browser: c.requirementsObservable.browser.ok,
          longContext: c.requirementsObservable.longContext.ok,
          overallStrict: c.overallStrict,
        },
      }
      : {
        ok: {
          domain: false,
          operation: false,
          complexity: false,
          risk: false,
          browser: false,
          longContext: false,
          overallStrict: c.overallStrict,
        },
      }),
    notes: c.notes,
  }));

  const header = {
    generatedAt: new Date().toISOString(),
    repo,
    source: issuesPath,
    methodology: {
      operationGroundTruth:
        "Somente prefixo convencional do título do PR mergeado e/ou tipo de arquivo alterado (somente docs/wiki -> docs; somente testes -> test). Nunca título ou labels da issue.",
      requirementsGroundTruth:
        "Apenas browser e longContext por evidência do diff; terminal/git/filesystem/parallelism excluídos por serem quase constantes ou não observáveis.",
      strictScore: summary.partialCriterion,
    },
    summary,
  };
  const headerJson = JSON.stringify(header, null, 2);
  const issuesJson = compact.map((r) => "    " + JSON.stringify(r)).join(",\n");
  const outText = headerJson.slice(0, -2) + ',\n  "issues": [\n' + issuesJson + "\n  ]\n}\n";
  await Deno.writeTextFile(outPath, outText);
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.main) main();
