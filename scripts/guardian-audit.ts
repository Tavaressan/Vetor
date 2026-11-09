// Auditoria determinística do /vetor:guardian (issue #578).
//
// Somente leitura: nunca escreve arquivo nem altera estado do git ou do GitHub. Cada check devolve
// status, achados e, quando houver, a correção proposta (comando que a skill aplica só com
// aprovação). O check de banco de dados exige julgamento e fica fora daqui
// (skills/guardian/references/database.md).
//
// Uso: deno run -A scripts/guardian-audit.ts [--format json|md] [<root>]
// Exit: 0 = nenhum achado | 1 = há achados | 2 = uso incorreto.
// Em agendamento (cron, timer, CI), `--format md` dá o relatório sem LLM: exit 0 = silêncio.

import { auditAiMemory, auditGraphFreshness } from "./guardian-knowledge.ts";

export type Exec = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<{ code: number; stdout: string }>;

export interface Fix {
  kind:
    | "rewrite-json"
    | "safe-remove-worktree"
    | "archive-orphan-status"
    | "dependabot-rebase"
    | "design-review-issue";
  description: string;
  /** Comando a rodar depois da aprovação; ausente quando a correção pede julgamento. */
  command?: string;
}

export interface Finding {
  message: string;
  path?: string;
  fix?: Fix;
}

export interface CheckResult {
  id: string;
  name: string;
  status: "ok" | "finding" | "skipped" | "error";
  findings: Finding[];
  detail?: string;
}

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "target",
  ".next",
  "__pycache__",
  ".venv",
]);
const STALE_WORKTREE_DAYS = 7;
const STALE_PRACTICES_DAYS = 90;

export const defaultExec: Exec = async (command, args, cwd) => {
  try {
    const out = await new Deno.Command(command, { args, cwd, stdout: "piped", stderr: "null" })
      .output();
    return { code: out.code, stdout: new TextDecoder().decode(out.stdout) };
  } catch {
    return { code: 127, stdout: "" };
  }
};

const checksScript = new URL("./vetor-checks.sh", import.meta.url).pathname;
const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

function result(id: string, name: string, findings: Finding[], detail?: string): CheckResult {
  return { id, name, status: findings.length > 0 ? "finding" : "ok", findings, detail };
}
const skipped = (id: string, name: string, detail: string): CheckResult => ({
  id,
  name,
  status: "skipped",
  findings: [],
  detail,
});

function* walk(dir: string, skip: (path: string) => boolean): Generator<string> {
  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync(dir)];
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    if (skip(path) || EXCLUDED_DIRS.has(entry.name)) continue;
    if (entry.isDirectory) yield* walk(path, skip);
    else if (entry.isFile) yield path;
    if (entry.isDirectory) yield `${path}/`;
  }
}

function checkJson(root: string): CheckResult {
  const skip = (p: string) => p === `${root}/.claude/worktrees`;
  const findings: Finding[] = [];
  let count = 0;
  for (const base of [".claude", ".reversa"]) {
    for (const path of walk(`${root}/${base}`, skip)) {
      if (!path.endsWith(".json")) continue;
      count++;
      try {
        JSON.parse(Deno.readTextFileSync(path).replace(/^﻿/, ""));
      } catch (error) {
        const rel = path.slice(root.length + 1);
        findings.push({
          message: `JSON inválido em ${rel}: ${(error as Error).message}`,
          path: rel,
          fix: {
            kind: "rewrite-json",
            description: "reescrever com jq se o erro for trivial (vírgula final, encoding)",
          },
        });
      }
    }
  }
  return result("json", "JSON validity", findings, `${count} arquivos verificados`);
}

/** Buracos, duplicatas e nomes fora da convenção Flyway `V<N>__<descrição>.sql`. */
export function migrationFindings(files: string[], dir: string): Finding[] {
  const findings: Finding[] = [];
  const versions = new Map<number, string[]>();
  for (const file of files.filter((f) => f.startsWith("V"))) {
    const match = file.match(/^V(\d+)__.+\.sql$/);
    if (!match) {
      findings.push({
        message: `nome fora da convenção V<N>__<descrição>.sql: ${file}`,
        path: dir,
      });
      continue;
    }
    const version = Number(match[1]);
    versions.set(version, [...(versions.get(version) ?? []), file]);
  }
  for (const [version, names] of versions) {
    if (names.length > 1) {
      findings.push({ message: `versão V${version} duplicada: ${names.join(", ")}`, path: dir });
    }
  }
  const sorted = [...versions.keys()].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > 1) {
      findings.push({
        message: `buraco de versão: V${sorted[i - 1]} → V${sorted[i]}`,
        path: dir,
      });
    }
  }
  return findings;
}

function checkMigrations(root: string): CheckResult {
  const name = "Sequência de migrations";
  const skip = (p: string) => p === `${root}/.claude/worktrees`;
  for (const path of walk(root, skip)) {
    if (!path.endsWith("/db/migration/")) continue;
    const dir = path.slice(0, -1);
    const files = [...Deno.readDirSync(dir)].filter((e) => e.isFile).map((e) => e.name);
    return result("migrations", name, migrationFindings(files, dir.slice(root.length + 1)));
  }
  return skipped("migrations", name, "no migrations dir");
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
}

async function worktrees(root: string, exec: Exec): Promise<WorktreeEntry[] | null> {
  const out = await exec("git", ["worktree", "list", "--porcelain"], root);
  if (out.code !== 0) return null;
  return out.stdout.trim().split(/\n\n+/).map((block) => ({
    path: block.match(/^worktree (.+)$/m)?.[1] ?? "",
    branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null,
  }));
}

function checkWorktreeLocation(root: string, list: WorktreeEntry[]): CheckResult {
  const findings = list.slice(1)
    .filter((w) => !w.path.startsWith(`${root}/.claude/worktrees/`))
    .map((w) => ({ message: `worktree fora de .claude/worktrees/: ${w.path}`, path: w.path }));
  return result("worktree-location", "Worktrees fora de .claude/worktrees/", findings);
}

function checkResidualDirs(root: string, list: WorktreeEntry[]): CheckResult {
  const registered = new Set(list.map((w) => w.path));
  let dirs: string[] = [];
  try {
    dirs = [...Deno.readDirSync(`${root}/.claude/worktrees`)]
      .filter((e) => e.isDirectory)
      .map((e) => `${root}/.claude/worktrees/${e.name}`);
  } catch {
    return skipped("residual-dirs", "Diretórios residuais", "sem .claude/worktrees/");
  }
  const findings = dirs.filter((d) => !registered.has(d)).map((d) => ({
    message: `diretório residual (fora do git worktree list): ${d}. Inspecione antes de apagar.`,
    path: d,
  }));
  return result("residual-dirs", "Diretórios residuais em .claude/worktrees/", findings);
}

async function checkWorktreeAudit(root: string, exec: Exec): Promise<CheckResult> {
  const name = "Auditoria de worktrees";
  const audit = await exec("bash", [checksScript, "worktree-audit"], root);
  if (audit.code !== 0) return { ...skipped("worktree-audit", name, "worktree-audit falhou") };
  const prOut = await exec("gh", [
    "pr",
    "list",
    "--state",
    "all",
    "--limit",
    "500",
    "--json",
    "headRefName,number,state",
  ], root);
  let prs: Array<{ headRefName: string; number: number; state: string }> | null = null;
  try {
    prs = prOut.code === 0 ? JSON.parse(prOut.stdout) : null;
  } catch {
    prs = null;
  }
  const findings: Finding[] = [];
  for (const line of lines(audit.stdout)) {
    const [path, branch, age, , uncommitted] = line.split("|");
    if (uncommitted === "yes") {
      findings.push({ message: `trabalho não commitado em ${path}; nunca remover`, path });
      continue;
    }
    if (Number(age) <= STALE_WORKTREE_DAYS) continue;
    const pr = prs?.find((p) => p.headRefName === branch);
    if (pr?.state === "OPEN") continue;
    const unpushed = await exec("git", [
      "-C",
      path,
      "rev-list",
      "--count",
      `origin/${branch}..${branch}`,
    ], root);
    const safe = prs !== null && unpushed.code === 0 && unpushed.stdout.trim() === "0";
    const prLabel = prs === null
      ? "PR desconhecido (gh indisponível)"
      : pr
      ? `PR #${pr.number} ${pr.state}`
      : "sem PR";
    findings.push({
      message: `worktree ${path} (${branch}) com ${age} dias, ${prLabel}` +
        (safe ? "; candidata a remoção" : "; há commits fora do remoto ou estado incerto"),
      path,
      fix: safe
        ? {
          kind: "safe-remove-worktree",
          description: "remover o worktree limpo, sem PR aberto e sem commits locais",
          command: `bash "$SKILL_DIR/../../scripts/vetor-checks.sh" safe-remove-worktree ${path}`,
        }
        : undefined,
    });
  }
  return result("worktree-audit", name, findings);
}

async function checkOrphanStatus(root: string, exec: Exec): Promise<CheckResult> {
  const out = await exec("bash", [checksScript, "find-orphan-status"], root);
  if (out.code !== 0) return skipped("orphan-status", "Status files órfãos", "comando falhou");
  const findings = lines(out.stdout).map((path) => ({
    message: `status file órfão (worktree removido): ${path}`,
    path,
    fix: {
      kind: "archive-orphan-status" as const,
      description: "mover para .claude/vetor/status/archive/ (reversível)",
      command: `bash "$SKILL_DIR/../../scripts/vetor-checks.sh" archive-orphan-status ${path}`,
    },
  }));
  return result("orphan-status", "Status files órfãos", findings);
}

async function checkDependabot(root: string, exec: Exec): Promise<CheckResult> {
  const name = "PRs do Dependabot com rebase pendente";
  const out = await exec("gh", [
    "pr",
    "list",
    "--author",
    "app/dependabot",
    "--state",
    "open",
    "--json",
    "number,title,mergeable,mergeStateStatus",
  ], root);
  if (out.code !== 0) return skipped("dependabot", name, "gh indisponível");
  const prs = JSON.parse(out.stdout || "[]") as Array<
    { number: number; title: string; mergeable: string; mergeStateStatus: string }
  >;
  const findings = prs
    .filter((p) =>
      p.mergeable === "CONFLICTING" || ["DIRTY", "BEHIND"].includes(p.mergeStateStatus)
    )
    .map((p) => ({
      message: `PR do Dependabot #${p.number} precisa de rebase (${p.mergeStateStatus})`,
      fix: {
        kind: "dependabot-rebase" as const,
        description: `comentar "@dependabot rebase" no PR #${p.number} via --body-file`,
      },
    }));
  return result("dependabot", name, findings, `${prs.length} PRs abertos`);
}

async function checkDocker(root: string, exec: Exec): Promise<CheckResult> {
  const name = "Containers Docker do projeto";
  const project = (root.split("/").pop() ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const out = await exec("docker", [
    "ps",
    "-a",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--format",
    "{{.Names}}|{{.State}}|{{.Status}}",
  ], root);
  if (out.code !== 0) return skipped("docker", name, "Docker indisponível");
  const containers = lines(out.stdout).map((l) => l.split("|"));
  if (containers.length === 0) return skipped("docker", name, "nenhum container do projeto");
  const findings = containers
    .filter(([, state, status]) => state !== "running" || /unhealthy/.test(status ?? ""))
    .map(([container, state, status]) => ({
      message: `container ${container} em estado ${state} (${status})`,
    }));
  return result("docker", name, findings, `${containers.length} containers`);
}

async function checkArchitecturalRisk(root: string, exec: Exec): Promise<CheckResult> {
  const name = "Risco arquitetural (deletion test)";
  const out = await exec("bash", [checksScript, "architectural-risk"], root);
  const rows = out.code === 0 ? lines(out.stdout).map((l) => l.split("|")) : [];
  if (rows.length === 0) {
    return skipped("architectural-risk", name, "nenhum módulo tocado nos últimos 7 dias");
  }
  const findings = rows.filter(([, , candidate]) =>
    candidate === "candidate=yes" || candidate === "yes"
  )
    .map(([module, fanIn]) => ({
      message: `módulo ${module} com fan-in alto (${fanIn.replace(/^fan-in=/, "")})`,
      fix: {
        kind: "design-review-issue" as const,
        description:
          `criar issue de revisão de design para ${module} (rodapé 🤖 Gerado por /vetor:guardian)`,
      },
    }));
  return result("architectural-risk", name, findings, `${rows.length} módulos analisados`);
}

function fromKnowledgeMessage(id: string, name: string, message: string): CheckResult {
  if (message.startsWith("Aviso")) return result(id, name, [{ message }]);
  if (message.startsWith("Informativo")) return skipped(id, name, message);
  return { id, name, status: "ok", findings: [], detail: message };
}

function checkPracticesStaleness(root: string, now: number): CheckResult {
  const name = "Staleness das regras de best-practices";
  const dir = `${root}/.claude/rules/vetor/best-practices`;
  let files: string[];
  try {
    files = [...Deno.readDirSync(dir)].filter((e) => e.name.endsWith(".md")).map((e) => e.name);
  } catch {
    return skipped("practices-staleness", name, "sem regras de best-practices");
  }
  const findings: Finding[] = [];
  for (const file of files) {
    const date = Deno.readTextFileSync(`${dir}/${file}`).match(
      /via Context7 em (\d{4}-\d{2}-\d{2})/,
    )?.[1];
    if (!date) continue;
    const days = Math.floor((now - Date.parse(date)) / 86_400_000);
    if (days > STALE_PRACTICES_DAYS) {
      findings.push({
        message:
          `regra ${file} desatualizada (${days} dias); considere /vetor:stack-practices --refresh`,
        path: `.claude/rules/vetor/best-practices/${file}`,
      });
    }
  }
  return result("practices-staleness", name, findings, `${files.length} regras`);
}

export async function runAudit(
  root: string,
  exec: Exec = defaultExec,
  now = Date.now(),
): Promise<CheckResult[]> {
  const list = await worktrees(root, exec);
  const safely = async (
    id: string,
    name: string,
    run: () => Promise<CheckResult> | CheckResult,
  ) => {
    try {
      return await run();
    } catch (error) {
      return { id, name, status: "error" as const, findings: [], detail: String(error) };
    }
  };
  return [
    await safely("json", "JSON validity", () => checkJson(root)),
    await safely("migrations", "Sequência de migrations", () => checkMigrations(root)),
    list === null
      ? skipped("worktree-location", "Worktrees fora de .claude/worktrees/", "git indisponível")
      : checkWorktreeLocation(root, list),
    list === null
      ? skipped("residual-dirs", "Diretórios residuais", "git indisponível")
      : checkResidualDirs(root, list),
    await safely("worktree-audit", "Auditoria de worktrees", () => checkWorktreeAudit(root, exec)),
    await safely("orphan-status", "Status files órfãos", () => checkOrphanStatus(root, exec)),
    await safely("dependabot", "Dependabot", () => checkDependabot(root, exec)),
    await safely("docker", "Containers Docker", () => checkDocker(root, exec)),
    await safely(
      "architectural-risk",
      "Risco arquitetural",
      () => checkArchitecturalRisk(root, exec),
    ),
    await safely(
      "graph-freshness",
      "Frescor da cartografia Graphify",
      async () =>
        fromKnowledgeMessage(
          "graph-freshness",
          "Frescor da cartografia Graphify",
          await auditGraphFreshness(root),
        ),
    ),
    await safely("ai-memory", "Saúde do servidor ai-memory", async () =>
      fromKnowledgeMessage(
        "ai-memory",
        "Saúde do servidor ai-memory",
        await auditAiMemory(`${root}/.mcp.json`),
      )),
    await safely(
      "practices-staleness",
      "Staleness das regras de best-practices",
      () => checkPracticesStaleness(root, now),
    ),
  ];
}

export function renderMarkdown(results: CheckResult[], date: string): string {
  const found = results.flatMap((r) => r.findings.map((f) => `- ${r.name}: ${f.message}`));
  const passed = results.filter((r) => r.status === "ok").map((r) =>
    `- ${r.name}: ✅${r.detail ? ` ${r.detail}` : ""}`
  );
  const skippedList = results.filter((r) => r.status === "skipped" || r.status === "error")
    .map((r) => `- ${r.name}: ${r.status === "error" ? "erro" : "skipped"} (${r.detail ?? ""})`);
  return [
    `## Guardian Report — ${date}`,
    "",
    "### Found (problemas detectados)",
    ...(found.length ? found : ["- nenhum"]),
    "",
    "### Hardened (verificações que passaram)",
    ...(passed.length ? passed : ["- nenhuma"]),
    "",
    "### Skipped",
    ...(skippedList.length ? skippedList : ["- nenhum"]),
  ].join("\n");
}

if (import.meta.main) {
  const args = [...Deno.args];
  const formatAt = args.indexOf("--format");
  const format = formatAt >= 0 ? args.splice(formatAt, 2)[1] : "json";
  if (!["json", "md"].includes(format) || args.some((a) => a.startsWith("--")) || args.length > 1) {
    console.error("Uso: guardian-audit.ts [--format json|md] [<root>]");
    Deno.exit(2);
  }
  const root = (args[0] ?? Deno.cwd()).replace(/\/$/, "");
  const results = await runAudit(root);
  console.log(
    format === "md"
      ? renderMarkdown(results, new Date().toISOString().slice(0, 10))
      : JSON.stringify(results, null, 2),
  );
  Deno.exit(results.some((r) => r.findings.length > 0) ? 1 : 0);
}
