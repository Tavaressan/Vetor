import { assertEquals, assertMatch } from "@std/assert";
import { evaluateFreshness, parseWorktreePaths } from "./worktree.ts";

const ROOT = "/repo";
const FRESH = `${ROOT}/.claude/worktrees/issue-42`;

const PORCELAIN = `worktree ${ROOT}
HEAD abcdef0123456789abcdef0123456789abcdef01
branch refs/heads/master

worktree ${FRESH}
HEAD 0123456789abcdef0123456789abcdef01234567
branch refs/heads/feat/issue-42
`;

Deno.test("parseWorktreePaths extrai os paths de `worktree <path>`", () => {
  assertEquals(parseWorktreePaths(PORCELAIN), [ROOT, FRESH]);
});

Deno.test("evaluateFreshness: worktree dentro da raiz e listado passa (null)", () => {
  assertEquals(evaluateFreshness(FRESH, ROOT, PORCELAIN), null);
});

Deno.test("evaluateFreshness: worktree fora de .claude/worktrees da raiz é bloqueado", () => {
  const outside = "/repo/../other-place/wt";
  const message = evaluateFreshness(outside, ROOT, PORCELAIN);
  assertMatch(message ?? "", /worktree fora de/i);
});

Deno.test("evaluateFreshness: worktree stale (ausente de `git worktree list`) é bloqueado", () => {
  const porcelainSemFresh = `worktree ${ROOT}\nHEAD abc\nbranch refs/heads/master\n`;
  const message = evaluateFreshness(FRESH, ROOT, porcelainSemFresh);
  assertMatch(message ?? "", /stale/i);
});
