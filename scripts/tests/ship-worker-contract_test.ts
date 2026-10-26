// Contrato do subagente ship-worker (RF-06) e da injeção do ContextPacket (RF-07) de
// docs/specs/pipeline-ship-e-delegacao-eficiente.md — issue #496. As skills e os agentes são prosa
// lida por um modelo, então o contrato é travado por asserções sobre o texto.

import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
// O checkout no Windows pode trazer CRLF; normaliza para as regex de fence e de frontmatter.
const read = async (path: string) =>
  (await Deno.readTextFile(new URL(path, root))).replaceAll("\r\n", "\n");

const shipWorker = await read("agents/ship-worker.md");
const issueWorker = await read("agents/issue-worker.md");
const dispatchRef = await read("skills/shared/references/issue-coordinator-dispatch.md");
const coordinatorSkill = await read("skills/coordinator/SKILL.md");

function frontmatterOf(document: string): string {
  const match = document.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert(match, "documento sem frontmatter YAML");
  return match[1];
}

Deno.test("ship-worker: frontmatter com tools restritas, sem isolation e compatível com agy plugin validate", () => {
  const frontmatter = frontmatterOf(shipWorker);

  assertMatch(frontmatter, /^name:\s*ship-worker\s*$/m);
  assertMatch(frontmatter, /^tools:\s*\[Bash, Read, Grep, Glob\]\s*$/m);
  // `haiku`/`sonnet` quebram o `agy plugin validate` (#337/#397): o modelo barato vem do dispatch.
  assertMatch(frontmatter, /^model:\s*inherit\s*$/m);
  // O ship-worker opera no worktree que já existe; `isolation: worktree` forçaria um novo.
  assert(!/^isolation:/m.test(frontmatter), "ship-worker não deve declarar isolation");
  assertMatch(frontmatter, /^skills:\s*\[ship\]\s*$/m);
  assert(!/\b(Write|Edit)\b/.test(frontmatter.match(/^tools:.*$/m)![0]), "sem Write/Edit");
});

Deno.test("ship-worker: prompt conduz /vetor:ship --prepare, grava PR_STAGED e não bloqueia no CI", () => {
  assertStringIncludes(shipWorker, "/vetor:ship --prepare");
  assertStringIncludes(shipWorker, "PR_STAGED");
  assertStringIncludes(shipWorker, "status file");
  // monitoramento não-bloqueante: um snapshot de checks, nunca --watch
  assertMatch(shipWorker, /não[^\n]*--watch|nunca[^\n]*--watch/i);
  assertMatch(shipWorker, /snapshot/i);
  // os revisores consultivos exigem a tool Agent, que o ship-worker não tem
  assertMatch(shipWorker, /code-review[\s\S]*coordinator/i);
});

Deno.test("ship-worker: manda prefixar todo Bash com cd no worktree (cwd não persiste e não há isolation)", () => {
  const restrictions = shipWorker.slice(shipWorker.indexOf("## Restrições"));

  assertMatch(shipWorker, /Todo comando Bash começa com `cd "<path-do-worktree>" &&`/);
  assertMatch(restrictions, /Todo comando Bash começa com `cd "<path-do-worktree>" &&`/);
});

Deno.test("ship-worker: proíbe merge e push para a branch default", () => {
  const restrictions = shipWorker.slice(shipWorker.indexOf("## Restrições"));
  assert(restrictions.length > 0, "ship-worker precisa de uma seção Restrições");

  assertStringIncludes(restrictions, "gh pr merge");
  assertStringIncludes(restrictions, "vetor-merge.sh");
  assertStringIncludes(restrictions, "--finalize");
  assertMatch(restrictions, /push[^\n]*(branch default|master|main)/i);
  assertStringIncludes(restrictions, "EnterPlanMode");
});

Deno.test("dispatch: documenta o ContextPacket com os campos obrigatórios da RF-07", () => {
  const section = dispatchRef.slice(dispatchRef.indexOf("ContextPacket"));
  assert(section.length > 0, "dispatch precisa documentar o ContextPacket");

  const jsonBlock = section.match(/```json\n([\s\S]*?)```/);
  assert(jsonBlock, "dispatch precisa de um exemplo JSON do ContextPacket");
  const example = JSON.parse(jsonBlock[1]);

  assertEquals(Object.keys(example).sort(), ["$schema", "context", "issue", "worktree"]);
  assertEquals(
    Object.keys(example.issue).sort(),
    ["acceptanceCriteria", "number", "slug", "title"],
  );
  assertEquals(Object.keys(example.worktree).sort(), ["baseBranch", "branch", "path"]);
  assertEquals(
    Object.keys(example.context).sort(),
    ["conventions", "module", "targetFiles", "testCommand"],
  );

  assertStringIncludes(dispatchRef, "scripts/context-packet.ts");
  assertStringIncludes(dispatchRef, "--module-test-map");
});

Deno.test("dispatch: worktree.path é opcional no primeiro dispatch (o harness cria o worktree)", () => {
  assertMatch(dispatchRef, /`worktree\.path`[^\n]*(opcional|ausente|omit)/i);
});

Deno.test("dispatch: ship-worker é despachado no worktree existente, com modelo barato explícito", () => {
  const start = dispatchRef.indexOf('subagent_type: "vetor:ship-worker"');
  assert(start >= 0, "dispatch precisa de um exemplo Agent() do ship-worker");
  const block = dispatchRef.slice(start, dispatchRef.indexOf("})", start));

  assertStringIncludes(block, 'model: "haiku"');
  assert(!block.includes("isolation"), "ship-worker não usa isolation: worktree");
});

Deno.test("dispatch: documenta como medir a redução de tool calls de exploração (RF-07)", () => {
  assertMatch(dispatchRef, /tool calls[^\n]*(antes|primeiro teste)/i);
  assertMatch(dispatchRef, /não verificad/i);
});

Deno.test("issue-worker: usa o ContextPacket antes de qualquer busca global", () => {
  assertStringIncludes(issueWorker, "ContextPacket");
  assertStringIncludes(issueWorker, "targetFiles");
  assertStringIncludes(issueWorker, "testCommand");
  assertMatch(issueWorker, /sem[^\n]*(Glob|find)/i);
});

Deno.test("coordinator Fase 4: manda montar o ContextPacket no dispatch do worker", () => {
  const phase4 = coordinatorSkill.slice(
    coordinatorSkill.indexOf("### 4 — Fase de desenvolvimento"),
    coordinatorSkill.indexOf("### 5 — Monitoramento"),
  );

  assertStringIncludes(phase4, "ContextPacket");
  assertStringIncludes(phase4, "issue-coordinator-dispatch.md");
});
