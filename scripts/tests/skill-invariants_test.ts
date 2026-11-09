import { assert, assertEquals, assertMatch } from "@std/assert";
import { evaluateShellCommand } from "../lib/safety-policy.ts";
import { citationUnits, measureSkill } from "../skill-budget.ts";

// Issue #569: invariantes reais do texto das skills e agents. Não conferem redação: cada teste
// protege uma regra de segurança ou uma ligação entre arquivos que quebraria o comportamento. A
// busca é no "pacote" da skill (SKILL.md e as referências que ele alcança), então mover um trecho
// para uma referência não quebra a suíte.

const rootPath = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const read = (path: string) => Deno.readTextFileSync(`${rootPath}/${path}`);

function skillNames(): string[] {
  return [...Deno.readDirSync(`${rootPath}/skills`)]
    .filter((e) => e.isDirectory && e.name !== "shared")
    .map((e) => e.name)
    .sort();
}

/** SKILL.md mais todas as referências que ele alcança, obrigatórias ou sob demanda. */
function bundle(skill: string): string {
  const budget = measureSkill(rootPath, skill);
  return [budget.skill, ...budget.mandatory, ...budget.onDemand].map((c) => read(c.path)).join(
    "\n",
  );
}

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of Deno.readDirSync(`${rootPath}/${dir}`)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) out.push(...markdownFiles(path));
    else if (path.endsWith(".md")) out.push(path);
  }
  return out;
}

const promptFiles = [
  ...markdownFiles("skills"),
  ...markdownFiles("agents"),
  ...markdownFiles("opencode/agent"),
];

const frontmatterOf = (text: string) => text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
const NEGATION = /\b(?:nunca|não|never|proib)/i;

Deno.test("invariante: toda skill que cria issue manda terminar o corpo com o rodapé de origem", () => {
  const creators = skillNames().filter((s) =>
    read(`skills/${s}/SKILL.md`).includes("gh issue create")
  );
  assert(creators.length > 0, "nenhuma skill cria issue? a busca deve ter quebrado");
  for (const skill of creators) {
    assertMatch(
      bundle(skill),
      new RegExp(`^🤖 Gerado por \`?/vetor:${skill}\\b`, "m"),
      `${skill} cria issues sem o modelo de rodapé "🤖 Gerado por /vetor:${skill}"`,
    );
  }
});

Deno.test("invariante: o coordinator identifica a origem pelo mesmo prefixo de rodapé", () => {
  assert(
    bundle("coordinator").includes("🤖 Gerado por"),
    "o coordinator precisa particionar as issues pelo prefixo '🤖 Gerado por'",
  );
});

Deno.test("invariante: os workers declaram que não fazem push, PR nem merge", () => {
  for (
    const [file, commands] of [
      ["agents/issue-worker.md", ["git push", "gh pr create", "gh pr merge"]],
      ["opencode/agent/issue-worker.md", ["git push", "gh pr create", "gh pr merge"]],
      ["agents/ship-worker.md", ["gh pr merge"]],
    ] as const
  ) {
    const units = citationUnits(read(file));
    for (const command of commands) {
      assert(
        units.some((u) => u.includes(command) && NEGATION.test(u)),
        `${file} precisa proibir "${command}"`,
      );
    }
  }
});

Deno.test("invariante: nenhuma skill ou agent instrui a criar labels", () => {
  for (const file of promptFiles) {
    for (const unit of citationUnits(read(file))) {
      if (unit.includes("gh label create")) {
        assert(NEGATION.test(unit), `${file} cita gh label create fora de uma proibição: ${unit}`);
      }
    }
  }
});

Deno.test("invariante: nenhum bloco de shell das skills é bloqueado pelo hook de segurança", async () => {
  let fences = 0;
  for (const file of promptFiles) {
    for (const [, body] of read(file).matchAll(/```(?:bash|sh|shell)\n([\s\S]*?)```/g)) {
      fences++;
      const result = await evaluateShellCommand(body, () => Promise.resolve(null));
      assertEquals(result.decision, "allow", `${file} manda rodar um comando que o hook bloqueia`);
    }
  }
  assert(fences > 0);
});

Deno.test("invariante: todo subcomando de vetor-checks.sh citado existe no script", () => {
  const script = read("scripts/vetor-checks.sh");
  const defined = new Set([...script.matchAll(/^ {2}([a-z][a-z-]*)\)$/gm)].map((m) => m[1]));
  const cited = new Set<string>();
  for (const file of promptFiles) {
    for (const [, sub] of read(file).matchAll(/vetor-checks\.sh"?\s+([a-z][a-z-]+)/g)) {
      cited.add(sub);
      assert(defined.has(sub), `${file} cita vetor-checks.sh ${sub}, que não existe`);
    }
  }
  for (const expected of ["prepare", "finalize", "verify-status", "stalled-workers"]) {
    assert(cited.has(expected), `a busca deveria encontrar vetor-checks.sh ${expected}`);
  }
});

Deno.test("invariante: arquivos de estado de runtime do coordinator não são versionados", async () => {
  for (const path of [".claude/vetor/decision-inbox.json", ".claude/vetor/goal-audit.json"]) {
    const { code } = await new Deno.Command("git", {
      args: ["check-ignore", "-q", path],
      cwd: rootPath,
    }).output();
    assertEquals(code, 0, `${path} deveria estar no .gitignore`);
  }
});

Deno.test("invariante: os cabeçalhos que os gates do auto-ship procuram são os publicados", () => {
  const gates = read("scripts/lib/auto-ship-gates.ts");
  assert(read("agents/code-review.md").includes("## Code Review (Vetor)"));
  assert(gates.includes("Code Review \\(Vetor\\)"));
  assert(bundle("ship").includes("## Security Review (Vetor)"));
  assert(gates.includes("Security Review \\(Vetor\\)"));
});

Deno.test("invariante: o ship-worker opera no worktree existente, sem Edit, Agent nem plan mode", () => {
  const frontmatter = frontmatterOf(read("agents/ship-worker.md"));
  const tools = frontmatter.match(/^tools:.*$/m)?.[0] ?? "";
  assertMatch(frontmatter, /^name:\s*ship-worker\s*$/m);
  // `haiku`/`sonnet` reprovam no `agy plugin validate` (#337/#397): o modelo vem do dispatch.
  assertMatch(frontmatter, /^model:\s*inherit\s*$/m);
  assert(!/^isolation:/m.test(frontmatter), "isolation forçaria um worktree novo");
  for (const forbidden of ["Edit", "Agent", "EnterPlanMode", "ExitPlanMode"]) {
    assert(!new RegExp(`\\b${forbidden}\\b`).test(tools), `ship-worker não pode ter ${forbidden}`);
  }
});

Deno.test("invariante: o issue-worker não tem plan mode na allowlist", () => {
  const tools = frontmatterOf(read("agents/issue-worker.md")).match(/^tools:.*$/m)?.[0] ?? "";
  assert(tools.length > 0);
  assert(!/PlanMode/.test(tools), "issue-worker roda sem interlocutor para aprovar plano");
});

Deno.test("invariante: o ship-worker tem Write, que o ship usa para os corpos de PR", () => {
  const tools = frontmatterOf(read("agents/ship-worker.md")).match(/^tools:.*$/m)?.[0] ?? "";
  assert(/\bWrite\b/.test(tools), "sem Write o ship não grava o corpo do PR (issue #533)");
});

Deno.test("invariante: o issue-worker só enxerga as ferramentas de página do ai-memory", () => {
  const tools = frontmatterOf(read("agents/issue-worker.md")).match(/^tools:.*$/m)?.[0] ?? "";
  const memory = [...tools.matchAll(/mcp__ai-memory__(\w+)/g)].map((m) => m[1]).sort();
  assertEquals(memory, ["memory_query", "memory_read_page", "memory_write_page"]);
});

Deno.test("invariante: nenhum prompt grava caminho pessoal de usuário", () => {
  for (const file of promptFiles) {
    assert(
      !/(?:\/home\/|\/Users\/|C:\\\\Users\\\\)[a-z][\w.-]*\//.test(read(file)),
      `${file} contém um caminho pessoal`,
    );
  }
});

Deno.test("invariante: o fluxo do coordinator usa os scripts que montam o dispatch", () => {
  const coordinator = bundle("coordinator");
  for (const script of ["dispatch-prompt.ts", "context-packet.ts", "vetor-status.sh"]) {
    assert(coordinator.includes(script), `o coordinator deixou de usar ${script}`);
  }
});
