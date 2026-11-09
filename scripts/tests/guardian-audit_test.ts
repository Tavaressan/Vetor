import { assert, assertEquals } from "@std/assert";
import {
  type CheckResult,
  defaultExec,
  type Exec,
  migrationFindings,
  renderMarkdown,
  runAudit,
} from "../guardian-audit.ts";

// Issue #578: auditoria determinística e somente leitura do guardian.

async function git(args: string[], cwd: string) {
  const out = await new Deno.Command("git", { args, cwd, stdout: "null", stderr: "piped" })
    .output();
  if (out.code !== 0) throw new Error(new TextDecoder().decode(out.stderr));
}

/** git e bash reais; gh e docker simulados. */
function execWith(fakes: Record<string, { code: number; stdout: string }>): Exec {
  return (command, args, cwd) => {
    const key = `${command} ${args.join(" ")}`;
    const fake = Object.entries(fakes).find(([prefix]) => key.startsWith(prefix));
    if (fake) return Promise.resolve(fake[1]);
    if (command === "gh" || command === "docker") return Promise.resolve({ code: 1, stdout: "" });
    return defaultExec(command, args, cwd);
  };
}

async function fixtureRepo(): Promise<string> {
  const root = await Deno.realPath(await Deno.makeTempDir());
  await git(["init", "-q", "-b", "main"], root);
  await git(["config", "user.email", "t@example.com"], root);
  await git(["config", "user.name", "T"], root);
  await git(["commit", "-q", "--allow-empty", "-m", "init"], root);
  await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
  await Deno.writeTextFile(`${root}/.claude/vetor/config.json`, '{ "a": 1, }');
  await Deno.writeTextFile(`${root}/.claude/vetor/ok.json`, "{}");
  await Deno.writeTextFile(`${root}/.claude/vetor/status/feat-9-sumiu.md`, "Status: GREEN\n");
  await Deno.mkdir(`${root}/.claude/worktrees/residuo`, { recursive: true });
  await Deno.mkdir(`${root}/app/db/migration`, { recursive: true });
  for (
    const f of ["V1__init.sql", "V2__users.sql", "V4__orders.sql", "V4__dup.sql", "Vx_ruim.sql"]
  ) {
    await Deno.writeTextFile(`${root}/app/db/migration/${f}`, "");
  }
  await Deno.mkdir(`${root}/.claude/rules/vetor/best-practices`, { recursive: true });
  await Deno.writeTextFile(
    `${root}/.claude/rules/vetor/best-practices/deno.md`,
    "> Gerado por `/vetor:stack-practices` ... via Context7 em 2026-01-01.\n",
  );
  return root;
}

function snapshot(root: string): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of Deno.readDirSync(dir)) {
      const p = `${dir}/${e.name}`;
      if (e.name === ".git") continue;
      if (e.isDirectory) walk(p);
      else out.push(`${p}:${Deno.statSync(p).mtime?.getTime()}:${Deno.readTextFileSync(p).length}`);
      if (e.isDirectory) out.push(`${p}/`);
    }
  };
  walk(root);
  return out.sort().join("\n");
}

const byId = (results: CheckResult[], id: string) => results.find((r) => r.id === id)!;

Deno.test("guardian-audit: acha JSON inválido, migrations, residual, status órfão e regra velha", async () => {
  const root = await fixtureRepo();
  try {
    const results = await runAudit(root, execWith({}), Date.parse("2026-11-09"));
    assertEquals(byId(results, "json").findings.map((f) => f.path), [".claude/vetor/config.json"]);
    assertEquals(byId(results, "json").findings[0].fix?.kind, "rewrite-json");
    const migrations = byId(results, "migrations").findings.map((f) => f.message).join("\n");
    assert(migrations.includes("buraco de versão: V2 → V4"));
    assert(migrations.includes("V4 duplicada"));
    assert(migrations.includes("Vx_ruim.sql"));
    assertEquals(byId(results, "residual-dirs").findings.length, 1);
    const orphan = byId(results, "orphan-status");
    assertEquals(orphan.findings.length, 1);
    assert(orphan.findings[0].fix?.command?.includes("archive-orphan-status"));
    assertEquals(byId(results, "practices-staleness").findings.length, 1);
    assertEquals(byId(results, "dependabot").status, "skipped");
    assertEquals(byId(results, "docker").status, "skipped");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("guardian-audit: nunca escreve no repositório nem altera o git", async () => {
  const root = await fixtureRepo();
  try {
    const before = snapshot(root);
    await runAudit(root, execWith({}));
    assertEquals(snapshot(root), before);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("guardian-audit: Dependabot com conflito vira achado com correção de rebase", async () => {
  const root = await fixtureRepo();
  try {
    const prs = [
      { number: 7, title: "bump", mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" },
      { number: 8, title: "bump", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" },
    ];
    const results = await runAudit(
      root,
      execWith({ "gh pr list --author": { code: 0, stdout: JSON.stringify(prs) } }),
    );
    const dependabot = byId(results, "dependabot");
    assertEquals(dependabot.findings.length, 1);
    assertEquals(dependabot.findings[0].fix?.kind, "dependabot-rebase");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("guardian-audit: container parado ou unhealthy vira achado, sem correção", async () => {
  const root = await fixtureRepo();
  try {
    const results = await runAudit(
      root,
      execWith({
        "docker ps": {
          code: 0,
          stdout:
            "db|running|Up 2 hours (healthy)\napi|exited|Exited (1)\nweb|running|Up (unhealthy)\n",
        },
      }),
    );
    const docker = byId(results, "docker");
    assertEquals(docker.findings.length, 2);
    assert(docker.findings.every((f) => f.fix === undefined));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("guardian-audit: migrationFindings aceita sequência contínua", () => {
  assertEquals(migrationFindings(["V1__a.sql", "V2__b.sql", "README.md"], "db"), []);
});

Deno.test("guardian-audit: o relatório em Markdown separa Found, Hardened e Skipped", () => {
  const md = renderMarkdown([
    { id: "a", name: "A", status: "finding", findings: [{ message: "x" }] },
    { id: "b", name: "B", status: "ok", findings: [], detail: "3 arquivos" },
    { id: "c", name: "C", status: "skipped", findings: [], detail: "sem dados" },
  ], "2026-11-09");
  assert(md.includes("### Found (problemas detectados)\n- A: x"));
  assert(md.includes("- B: ✅ 3 arquivos"));
  assert(md.includes("- C: skipped (sem dados)"));
});

Deno.test("guardian-audit CLI: exit 1 com achados e Markdown no --format md", async () => {
  const root = await fixtureRepo();
  try {
    const out = await new Deno.Command("deno", {
      args: [
        "run",
        "-A",
        new URL("../guardian-audit.ts", import.meta.url).pathname,
        "--format",
        "md",
        root,
      ],
      stdout: "piped",
      stderr: "null",
    }).output();
    assertEquals(out.code, 1);
    assert(new TextDecoder().decode(out.stdout).startsWith("## Guardian Report"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
