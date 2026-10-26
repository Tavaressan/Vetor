import { assert, assertFalse, assertMatch, assertStringIncludes } from "@std/assert";

// Issue #501 (RF-05 e RF-07 de docs/specs/autonomia-continua-e-desacoplamento-interativo.md):
// contrato estrutural da ejeção graciosa e da micro-spec JIT no coordinator. O comportamento do
// código está em ejection_test.ts, micro-spec_test.ts e decision-inbox_test.ts.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

const coordinatorSkill = await read("skills/coordinator/SKILL.md");
const dispatch = await read("skills/shared/references/issue-coordinator-dispatch.md");
const report = await read("skills/shared/references/issue-coordinator-report.md");
const statusTemplate = await read("skills/shared/references/agent-status.template.md");
const vetorStatus = await read("scripts/vetor-status.sh");
const opencodeCoordinator = await read("opencode/agent/issue-coordinator.md");

const slice = (text: string, from: string, to: string) =>
  text.slice(text.indexOf(from), text.indexOf(to));

const phase2 = slice(coordinatorSkill, "### 2 — ", "### 3 — ");
const phase4 = slice(coordinatorSkill, "### 4 — ", "### 5 — ");
const phase5 = slice(coordinatorSkill, "### 5 — ", "### 6 — ");
const ejection = slice(phase5, "**5.f", "### 6 — ");
const labels = slice(
  coordinatorSkill,
  "#### Labels de triagem no GitHub",
  "#### Detecção de issues spike",
);
const microSpec = dispatch.slice(dispatch.indexOf("### Micro-spec JIT"));

Deno.test("issue #501: a Fase 5.f define os gatilhos da ejeção graciosa", () => {
  assert(ejection.length > 0, "seção 5.f ausente");
  assertStringIncludes(ejection, "Ejeção graciosa");
  assertStringIncludes(ejection, "`FAILED_MAX_ITERATIONS` definitivo");
  assertMatch(ejection, /Timeout de bloqueio/);
  // com o circuit breaker acionado o impasse é de infraestrutura, não da issue
  assertMatch(ejection, /circuit breaker[\s\S]{0,200}não ejete/i);
});

Deno.test("issue #501: o comentário diagnóstico sai por arquivo/stdin, sem escapes de shell", () => {
  assertStringIncludes(ejection, 'scripts/eject-comment.ts"');
  assertStringIncludes(ejection, "gh issue comment <N> --body-file -");
  assertMatch(ejection, /--kind <failed-max-iterations\|blocked-timeout>/);
});

Deno.test("issue #501: a label needs-human só é aplicada se já existir, e nunca é criada", () => {
  assertMatch(
    labels,
    /\|[^\n]*`EJECTED`[^\n]*\|\s*`needs-human`\s*\|\s*—\s*\|\s*—\s*\|\s*Não aplica\s*\|/,
  );
  assertStringIncludes(ejection, 'gh issue edit <N> --add-label "needs-human"');
  assertMatch(ejection, /só se a label já existir/);
  assertMatch(ejection, /nunca[\s\S]{0,40}`gh label create`/i);
  // sem a label, o motivo fica no comentário e no relatório
  assertMatch(ejection, /comentário e (?:no )?relatório/);
});

Deno.test("issue #501: a label de ejeção também é removida ao despachar a issue de novo", () => {
  assertMatch(labels, /`needs-human`[\s\S]{0,300}remove/i);
  assertMatch(phase4, /Remoção de labels de triagem antes do dispatch[\s\S]{0,500}`needs-human`/);
});

Deno.test("issue #501: o worktree é limpo com segurança e a branch nunca é apagada", () => {
  assertStringIncludes(ejection, 'vetor-checks.sh" safe-remove-worktree');
  assertMatch(ejection, /git add -u/);
  assertMatch(ejection, /FAIL_ANALYSIS\.md/);
  assertMatch(ejection, /A branch nunca é apagada/);
  assertMatch(ejection, /não faz push|não publica/i);
  assertStringIncludes(ejection, "Status: EJECTED");
  assertStringIncludes(ejection, 'decision-inbox.ts" drop');
});

Deno.test("issue #501: ejetar libera a onda e pula só os dependentes diretos", () => {
  assertMatch(dispatch, /`EJECTED` conta como resolvido/);
  assertMatch(dispatch, /dependentes diretos[\s\S]{0,200}`SKIPPED \(bloqueada por #N\)`/);
  assertMatch(ejection, /segue para a próxima issue|despache o próximo `QUEUED`/);
});

Deno.test("issue #501: o gate de Spec oferece a micro-spec JIT como padrão, sem pergunta de remoção", () => {
  assertMatch(phase2, /Despachar com micro-spec JIT[^\n]*\(Recommended\)/);
  assertMatch(phase2, /micro-spec JIT[\s\S]{0,300}sem interromper o dispatch/);
  // em headless a micro-spec também é gerada, sem perguntar
  assertMatch(phase2, /micro-spec JIT: <path>|micro-spec JIT\)/);
});

Deno.test("issue #501: a micro-spec JIT vive no dispatch, com path, prazo, validação e fallback", () => {
  assert(microSpec.length > 0, "seção 'Micro-spec JIT' ausente em issue-coordinator-dispatch.md");
  assertStringIncludes(microSpec, "docs/specs/micro/<issue#>-<slug>.md");
  assertMatch(microSpec, /10 s/);
  assertStringIncludes(microSpec, "--micro-spec");
  assertMatch(microSpec, /haiku/);
  // o root não é sujo: o coordinator escreve num diretório ignorado e o worker grava no worktree
  assertStringIncludes(microSpec, ".claude/vetor/cache/micro-specs/");
  assertMatch(microSpec, /Não escreva em `docs\/specs\/micro\/` do root/);
  assertMatch(microSpec, /primeiro commit/);
  assertMatch(microSpec, /despache sem micro-spec/);
  assertStringIncludes(phase4, "Micro-spec JIT");
});

Deno.test("issue #501: o formato da micro-spec pede 1 objetivo, 3 critérios e 2 non-goals", () => {
  assertMatch(microSpec, /## Objetivo/);
  assertMatch(microSpec, /## Critérios de aceite/);
  assertMatch(microSpec, /## Non-goals/);
  assertMatch(microSpec, /exatamente 3 critérios/);
  assertMatch(microSpec, /exatamente 2 non-goals/);
});

Deno.test("issue #501: EJECTED consta no template, no vetor-status.sh e no relatório dos dois modos", () => {
  assertMatch(statusTemplate, /\*\*`EJECTED`\*\*[^\n]*apenas pelo coordinator/);
  assertStringIncludes(vetorStatus, "EJECTED");
  const listed = report.match(/`EJECTED`/g) ?? [];
  assert(listed.length >= 2, "EJECTED deve constar nas listas do modo interativo e do headless");
  assertMatch(report, /\| #54 \| 🧯 EJECTED \|/);
});

Deno.test("issue #501: o espelho OpenCode registra que a ejeção graciosa não se aplica lá", () => {
  assertMatch(opencodeCoordinator, /ejeção graciosa[\s\S]{0,200}não se aplica/i);
  assert(opencodeCoordinator.split(/\r?\n/).length < 150);
  assertFalse(opencodeCoordinator.includes("Circuit Breaker"));
});
