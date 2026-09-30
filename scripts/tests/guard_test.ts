import { assertEquals } from "@std/assert";
import { isWithin, isWriteAllowed, normalizePath } from "../lib/guard.ts";

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

Deno.test("exceção de status não permite outros arquivos ou subdiretórios", () => {
  assertEquals(
    isWriteAllowed(`${ROOT}/.claude/vetor/status/issue-42.json`, WORKTREE, ROOT),
    false,
  );
  assertEquals(
    isWriteAllowed(`${ROOT}/.claude/vetor/status/.agent-cwd/agent-42`, WORKTREE, ROOT),
    false,
  );
});

Deno.test("escape por .. é bloqueado", () => {
  assertEquals(isWriteAllowed(`${WORKTREE}/../../../src/a.ts`, WORKTREE, ROOT), false);
});

// Issue #155: ~/.claude/projects/<slug>/memory/ é o diretório de memória do Claude Code — fica
// fora de qualquer worktree por construção (não é o repositório), então não tem como contaminar
// workers paralelos, a própria justificativa do guard (ver topo do arquivo).
const HOME = "/Users/dev";

Deno.test("escrita em ~/.claude/projects/ é permitida (memória do Claude Code)", () => {
  assertEquals(
    isWriteAllowed(
      `${HOME}/.claude/projects/-repo-slug/memory/MEMORY.md`,
      WORKTREE,
      ROOT,
      HOME,
    ),
    true,
  );
});

Deno.test("escrita fora de ~/.claude/projects/ continua bloqueada mesmo com HOME informado", () => {
  assertEquals(isWriteAllowed(`${HOME}/other/file.md`, WORKTREE, ROOT, HOME), false);
});

Deno.test("sem HOME resolvido, a exceção de ~/.claude/projects/ não se aplica", () => {
  assertEquals(
    isWriteAllowed(`${HOME}/.claude/projects/-repo-slug/memory/MEMORY.md`, WORKTREE, ROOT, ""),
    false,
  );
});

Deno.test("escrita no scratchpad dentro do repo/home ou temp é permitida — issue #342", () => {
  // scratch dentro da raiz do repo — permitido
  assertEquals(
    isWriteAllowed("/repo/scratch/pr-portfolio.md", WORKTREE, ROOT),
    true,
  );
  // scratchpad dentro da home — permitido
  assertEquals(
    isWriteAllowed("/home/user/scratchpad/draft.md", WORKTREE, ROOT, "/home/user"),
    true,
  );
  // /tmp — permitido via check explícito
  assertEquals(
    isWriteAllowed("/tmp/body.md", WORKTREE, ROOT),
    true,
  );
});

Deno.test("escrita em scratch fora do repo/home/temp é bloqueada", () => {
  // scratch em caminho arbitrário global — bloqueado
  assertEquals(
    isWriteAllowed("/other-project/scratch/index.ts", WORKTREE, ROOT, ""),
    false,
  );
});
