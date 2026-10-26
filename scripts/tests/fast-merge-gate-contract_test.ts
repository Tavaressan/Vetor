import { assert, assertMatch, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

const coordinatorSkill = await read("skills/coordinator/SKILL.md");
const shipSkill = await read("skills/ship/SKILL.md");
const fastMergeGate = await read("skills/shared/references/fast-merge-gate.md");
const mergeScript = await read("scripts/vetor-merge.sh");
const reportReference = await read("skills/shared/references/issue-coordinator-report.md");

Deno.test("issue #495: Fase 6 do coordinator aponta para o Fast Merge Gate e para o --finalize", () => {
  assertStringIncludes(coordinatorSkill, "../shared/references/fast-merge-gate.md");
  assertStringIncludes(coordinatorSkill, "/vetor:ship --finalize <PR>");
  assertMatch(coordinatorSkill, /mergeable ==\s+MERGEABLE/);
});

Deno.test("issue #495: fast-merge-gate.md lê o cache de arquivos tocados e usa check-disjoint antes do primeiro merge", () => {
  assertStringIncludes(fastMergeGate, "<branch>-touched-files.json");
  assertStringIncludes(fastMergeGate, '"$SKILL_DIR/../../scripts/vetor-checks.sh" check-disjoint');
  assertMatch(fastMergeGate, /antes do primeiro merge/);
  // compara com todas as outras branches da onda (a ordem de merge só é conhecida depois dos CIs)
  assertMatch(fastMergeGate, /\*\*todas as outras\*\* branches\s+preparadas\s+da\s+onda/);
  assertMatch(fastMergeGate, /nenhuma branch de `S\(Pk\)` já foi\s+integrada/);
  // UNKNOWN não é MERGEABLE, com teto de espera por tentativa
  assertMatch(fastMergeGate, /`UNKNOWN`[\s\S]*Não\*\* trate como `MERGEABLE`/);
  assertMatch(fastMergeGate, /45 s/);
  // sobreposição: merge da default no worktree e só o módulo coincidente
  assertStringIncludes(fastMergeGate, 'git merge "origin/$DEFAULT_BRANCH"');
  assertMatch(fastMergeGate, /apenas a suíte do módulo coincidente/);
});

Deno.test("issue #495: merge queue detectada pela API do GitHub, com a limitação documentada", () => {
  assertStringIncludes(fastMergeGate, "Repository.mergeQueue(branch:)");
  assertMatch(fastMergeGate, /não foi exercitado contra um repositório real com fila/);
  assertStringIncludes(mergeScript, "mergeQueue(branch: $branch)");
});

Deno.test("issue #495: enfileirado (exit 4) é distinto de mergeado (exit 0) em script, ship, gate e relatório", () => {
  // script: cabeçalho define os dois códigos e o corpo sai com 4 ao enfileirar
  assertMatch(mergeScript, /# Exit: 0 = PR MERGEADO/);
  assertMatch(mergeScript, /4 = PR ENFILEIRADO/);
  assertMatch(mergeScript, /exit 4/);

  // consumidor: ship §10 não trata exit 4 como merge concluído
  assertMatch(shipSkill, /\*\*exit 4\*\* — PR \*\*enfileirado\*\*/);
  assertMatch(shipSkill, /Não é merge concluído/);
  assertStringIncludes(shipSkill, "exceto quando o §10 saiu com exit 4");

  // coordinator: reporta Enfileirado
  assertStringIncludes(fastMergeGate, "`Enfileirado`");
  assertStringIncludes(reportReference, "`Enfileirado`");
});

Deno.test("issue #495: nenhum consumidor documenta exit 0 do vetor-merge.sh como 'enfileirado'", () => {
  assert(!/exit 0[^\n]*enfileirad/i.test(shipSkill));
});
