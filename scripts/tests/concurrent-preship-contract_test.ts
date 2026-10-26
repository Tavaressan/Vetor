import { assert, assertMatch, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

const coordinatorSkill = await read("skills/coordinator/SKILL.md");
const monitoring = await read("skills/shared/references/issue-coordinator-monitoring.md");
const report = await read("skills/shared/references/issue-coordinator-report.md");

// Recorta a Fase 6 do coordinator (da seção "### 6" até "### 7").
const phase6 = coordinatorSkill.slice(
  coordinatorSkill.indexOf("### 6 — "),
  coordinatorSkill.indexOf("### 7 — "),
);

Deno.test("issue #494: Fase 6 despacha /vetor:ship --prepare em paralelo, um Agent por worktree verde", () => {
  assertStringIncludes(phase6, "6.a — Pre-Ship paralelo");
  assertStringIncludes(phase6, "/vetor:ship --prepare <issue#>");
  assertMatch(phase6, /\*\*todos na mesma mensagem\*\*|\*\*todos os grupos verdes/);
  assertMatch(phase6, /Despache \*\*todos na mesma mensagem\*\*, um `Agent\(\)` por worktree/);
  assertStringIncludes(phase6, "run_in_background: true");
  // o worktree já existe: subagente padrão, nunca vetor:issue-worker (que força worktree novo)
  assertMatch(phase6, /sem `subagent_type`/);
  assert(!phase6.includes('subagent_type: "vetor:issue-worker"'));
  // sucesso observado pelo status file
  assertStringIncludes(phase6, "PR_STAGED");
});

Deno.test("issue #494: Fase 5 manda acionar o Pre-Ship dos verdes sem esperar os demais workers", () => {
  const phase5 = coordinatorSkill.slice(
    coordinatorSkill.indexOf("### 5 — "),
    coordinatorSkill.indexOf("### 6 — "),
  );
  assertMatch(phase5, /não espere os demais workers/);
  assertStringIncludes(phase5, "5.e");
});

Deno.test("issue #494: CI monitorado por consulta agregada, sem gh pr checks --watch por PR", () => {
  assertStringIncludes(
    monitoring,
    "gh pr list --state open --json number,headRefName,isDraft,mergeable,statusCheckRollup",
  );
  assertMatch(monitoring, /nunca com um `gh pr checks <PR> --watch` por PR/);
  assertMatch(phase6, /Não use `gh pr checks --watch` por PR/);
  // vocabulário de checks que a classificação precisa cobrir
  for (const word of ["COMPLETED", "SUCCESS", "FAILURE", "CANCELLED", "TIMED_OUT"]) {
    assertStringIncludes(monitoring, word);
  }
});

Deno.test("issue #494: espera total converge para max(T_ci) + 60 s, com polling dentro do teto de 50 s", () => {
  assertStringIncludes(phase6, "max(T_ci) + 60 s");
  assertStringIncludes(monitoring, "max(T_ci) + 60 s");
  assertMatch(phase6, /a cada ≤ 45 s/);
  assertMatch(monitoring, /no máximo 45 s por espera \(teto de polling de 50 s/);
});

Deno.test("issue #494: falha de pre-ship entra no vocabulário do Coordinator Report", () => {
  assertStringIncludes(report, "| #51 | ❌ Pre-ship failed |");
  assertStringIncludes(report, "`Pre-ship failed`");
});
