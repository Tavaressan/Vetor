import { assert, assertMatch, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

const coordinator = await read("skills/coordinator/SKILL.md");
const ship = await read("skills/ship/SKILL.md");
const worktreeCreate = await read("skills/worktree-create/SKILL.md");

/** Recorta do cabeçalho `start` até o próximo cabeçalho de mesmo nível ou superior. */
function section(doc: string, start: string): string {
  const i = doc.indexOf(start);
  assert(i >= 0, `seção ausente: ${start}`);
  const level = start.match(/^#+/)![0].length;
  const rest = doc.slice(i + start.length);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next < 0 ? rest : rest.slice(0, next);
}
const orphan = section(coordinator, "### Entrega de PRs sem worktree local");
const shipGuard = section(ship, "### 1 — Guarda de contexto");
const fromBranch = section(worktreeCreate, "### 4.a — Modo `--from-branch`");
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

Deno.test("issue #527: sem opt-in o headless apenas lista os PRs órfãos", () => {
  assertMatch(orphan, /--auto-ship[\s\S]{0,300}6\.d[\s\S]{0,200}sem o opt-in, apenas liste/);
});

Deno.test("issue #527: validação de headRefName e recusa de fork ficam em worktree-create 4.a", () => {
  assertStringIncludes(fromBranch, "git check-ref-format --branch");
  assertStringIncludes(fromBranch, "isCrossRepository");
  assertMatch(fromBranch, /\^\[A-Za-z0-9\]\[A-Za-z0-9\._\/-\]\*\$/);
  assertMatch(fromBranch, /fork/i);
  assertMatch(fromBranch, /git fetch[^\n]*falh/i);
  assertMatch(shipGuard, /valida[çc][ãa]o[\s\S]{0,200}worktree-create/i);
  assertMatch(orphan, /valida[çc][ãa]o[\s\S]{0,200}worktree-create/i);
});

Deno.test("issue #527: ship resolve o cd do worktree recriado e delega os gates da 6.d ao chamador", () => {
  assertMatch(shipGuard, /passo 7 (a partir|com) d[oe]/i);
  assertMatch(shipGuard, /gates da 6\.d[\s\S]{0,200}chamador/i);
});

Deno.test("issue #527: coordinator dá o comando concreto de detecção de PR órfão", () => {
  assertStringIncludes(orphan, "gh pr list --state open");
  assertStringIncludes(orphan, "git worktree list --porcelain");
});

Deno.test("issue #527: trechos novos não usam comandos destrutivos", () => {
  for (
    const [nome, texto] of [["coordinator", orphan], ["ship", shipGuard], [
      "worktree-create 4.a",
      fromBranch,
    ]]
  ) {
    const semNegacao = texto.split("\n").filter((l) => !/nunca|n[ãa]o/i.test(l)).join("\n");
    for (const proibido of ["branch -D", "reset --hard", "push --force", "push -f"]) {
      assert(!semNegacao.includes(proibido), `${nome} contém ${proibido}`);
    }
  }
});
