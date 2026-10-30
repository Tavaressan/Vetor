import { assertMatch, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

const coordinator = await read("skills/coordinator/SKILL.md");
const ship = await read("skills/ship/SKILL.md");
const worktreeCreate = await read("skills/worktree-create/SKILL.md");
const gate = await read("skills/shared/references/fast-merge-gate.md");

Deno.test("issue #527: coordinator lista PRs abertos sem worktree local com CI, mergeable e draft", () => {
  assertMatch(coordinator, /### Entrega de PRs sem worktree local/);
  assertStringIncludes(coordinator, "statusCheckRollup");
  assertStringIncludes(coordinator, "isDraft");
  assertStringIncludes(coordinator, "mergeable");
});

Deno.test("issue #527: em --headless a entrega de PR órfão exige auto-ship e os gates da 6.d", () => {
  assertMatch(
    coordinator,
    /### Entrega de PRs sem worktree local[\s\S]{0,2500}(--auto-ship|autoShipHeadless)[\s\S]{0,800}6\.d/,
  );
});

Deno.test("issue #527: --finalize recria o worktree a partir da branch remota em vez de abortar", () => {
  assertMatch(ship, /### 1 — Guarda de contexto[\s\S]*--from-branch[\s\S]*### 2 —/);
  assertStringIncludes(worktreeCreate, "--from-branch");
  assertStringIncludes(worktreeCreate, "origin/<branch>");
  assertStringIncludes(coordinator, "--from-branch");
});

Deno.test("issue #527: Fast Merge Gate inclui PRs órfãos no mapa e re-sincroniza o segundo sobreposto", () => {
  assertMatch(gate, /sem worktree local/);
  assertMatch(gate, /PRs órfãos/);
  assertMatch(gate, /re-sincroniz\w+ e re-test\w+/);
});
