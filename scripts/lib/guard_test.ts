import { assertEquals } from "@std/assert";
import { isWithin, isWriteAllowed, normalizePath } from "./guard.ts";

const WORKTREE = "/repo/.claude/worktrees/issue-42";
const ROOT = "/repo";

Deno.test("normalizePath resolve .. e uniformiza separadores", () => {
  assertEquals(normalizePath("/repo/src/../lib"), normalizePath("/repo/lib"));
  assertEquals(normalizePath("C:\\repo\\src"), normalizePath("C:/repo/src"));
});

Deno.test("isWithin não casa prefixo parcial de diretório", () => {
  assertEquals(isWithin("/repo/src-old/a.ts", "/repo/src"), false);
  assertEquals(isWithin("/repo/src/a.ts", "/repo/src"), true);
});

Deno.test("escrita dentro do worktree é permitida", () => {
  assertEquals(isWriteAllowed(`${WORKTREE}/src/a.ts`, WORKTREE, ROOT), true);
});

Deno.test("escrita na raiz do repositório é bloqueada", () => {
  assertEquals(isWriteAllowed(`${ROOT}/src/a.ts`, WORKTREE, ROOT), false);
});

Deno.test("status file na raiz é a exceção permitida", () => {
  assertEquals(
    isWriteAllowed(`${ROOT}/.claude/vetor/status/issue-42.md`, WORKTREE, ROOT),
    true,
  );
});

Deno.test("escape por .. é bloqueado", () => {
  assertEquals(isWriteAllowed(`${WORKTREE}/../../../src/a.ts`, WORKTREE, ROOT), false);
});
