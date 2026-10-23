// Reprodução da issue #313: `issue-worker`/`code-review` rodam com `--dir <worktree>`, mas
// `config.json`/`module-test-map.md`/status file vivem em `<repo-root>/.claude/vetor/`, fora da
// árvore do worktree. O OpenCode trata esse acesso como `external_directory`, default `"*": "ask"`
// — em `opencode run` não-interativo (sem TTY) isso auto-rejeita em vez de bloquear esperando
// input. Este CLI garante, de forma idempotente, uma regra `permission.external_directory` em
// `<repo-root>/opencode.json` apontando para `<repo-root>/.claude/vetor/**`, para que o
// issue-coordinator a gere uma única vez (Fase 3) antes do primeiro `opencode run --dir` da sessão.

import { assertEquals } from "@std/assert";

const SCRIPT = new URL("./ensure-external-directory-permission.ts", import.meta.url).pathname;

async function git(args: string[], cwd: string): Promise<void> {
  await new Deno.Command("git", { args, cwd, stdout: "null", stderr: "null" }).output();
}

async function makeRepo(): Promise<string> {
  const dir = await Deno.makeTempDir();
  await git(["init", "-q", "-b", "main"], dir);
  await git(["config", "user.email", "test@example.com"], dir);
  await git(["config", "user.name", "Test"], dir);
  await git(["commit", "-q", "--allow-empty", "-m", "init"], dir);
  return dir;
}

async function runCli(
  input: unknown,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const command = new Deno.Command("deno", {
    args: ["run", "-A", SCRIPT],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(input)));
  await writer.close();
  const out = await child.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout).trim(),
    stderr: new TextDecoder().decode(out.stderr).trim(),
  };
}

async function readOpencodeJson(repo: string): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(`${repo}/opencode.json`));
}

/**
 * `Deno.makeTempDir()` devolve path nativo (com `\` no Windows), mas o script resolve o root via
 * `git rev-parse --path-format=absolute`, que normaliza para `/` — mesma convenção já usada por
 * `resolveWorktree()`/`resolve-model.ts`. Normaliza aqui só para montar a chave esperada no teste.
 */
function toForwardSlashes(path: string): string {
  return path.replaceAll("\\", "/");
}

Deno.test("cria opencode.json com a regra external_directory quando o arquivo não existe", async () => {
  const repo = await makeRepo();
  try {
    const result = await runCli({ cwd: repo });

    assertEquals(result.code, 0);
    const config = await readOpencodeJson(repo);
    const rule = (config.permission as { external_directory?: Record<string, string> })
      .external_directory;
    assertEquals(rule?.[`${toForwardSlashes(repo)}/.claude/vetor/**`], "allow");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("mescla a regra num opencode.json existente sem apagar outras chaves", async () => {
  const repo = await makeRepo();
  try {
    await Deno.writeTextFile(
      `${repo}/opencode.json`,
      JSON.stringify({
        "$schema": "https://opencode.ai/config.json",
        mcp: { docker: { type: "local", command: ["docker-mcp"] } },
        permission: { external_directory: { "/algum/outro/path/**": "ask" } },
      }),
    );

    const result = await runCli({ cwd: repo });

    assertEquals(result.code, 0);
    const config = await readOpencodeJson(repo);
    assertEquals((config.mcp as Record<string, unknown>).docker !== undefined, true);
    const rule = (config.permission as { external_directory?: Record<string, string> })
      .external_directory;
    assertEquals(rule?.[`${toForwardSlashes(repo)}/.claude/vetor/**`], "allow");
    assertEquals(rule?.["/algum/outro/path/**"], "ask");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("idempotente: segunda chamada não altera o conteúdo já correto", async () => {
  const repo = await makeRepo();
  try {
    const first = await runCli({ cwd: repo });
    assertEquals(first.code, 0);
    const afterFirst = await Deno.readTextFile(`${repo}/opencode.json`);

    const second = await runCli({ cwd: repo });
    assertEquals(second.code, 0);
    const afterSecond = await Deno.readTextFile(`${repo}/opencode.json`);

    assertEquals(afterSecond, afterFirst);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("não sobrescreve opencode.json existente e ilegível — falha com mensagem acionável", async () => {
  const repo = await makeRepo();
  try {
    await Deno.writeTextFile(`${repo}/opencode.json`, "{ isto não é json válido");

    const result = await runCli({ cwd: repo });

    assertEquals(result.code, 1);
    const raw = await Deno.readTextFile(`${repo}/opencode.json`);
    assertEquals(raw, "{ isto não é json válido");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

// Issue #307 (mesma classe já corrigida em resolve-model.ts): no Git Bash do Windows, `$(pwd)`
// produz um path POSIX-style (`/c/Users/...`), não nativo — precisa resolver o mesmo repo real.
function toPosixPath(nativePath: string): string {
  return nativePath.replace(/^([A-Za-z]):\\/, (_, d) => `/${d.toLowerCase()}/`).replaceAll(
    "\\",
    "/",
  );
}

Deno.test({
  name: "resolve o root real mesmo com cwd POSIX-style (Git Bash Windows)",
  ignore: Deno.build.os !== "windows",
  fn: async () => {
    const repo = await makeRepo();
    try {
      const result = await runCli({ cwd: toPosixPath(repo) });

      assertEquals(result.code, 0);
      const config = await readOpencodeJson(repo);
      const rule = (config.permission as { external_directory?: Record<string, string> })
        .external_directory;
      assertEquals(rule?.[`${toForwardSlashes(repo)}/.claude/vetor/**`], "allow");
    } finally {
      await Deno.remove(repo, { recursive: true });
    }
  },
});

// Issue #389: no opencode 1.19.0 o worker com `--dir <worktree>` não carrega o opencode.json da
// raiz — a regra precisa existir também em `<worktree>/opencode.json`, fora do controle de versão.
async function makeLinkedWorktree(repo: string): Promise<string> {
  await git(["worktree", "add", "-q", "-b", "wt", ".claude/worktrees/wt"], repo);
  return `${repo}/.claude/worktrees/wt`;
}

async function gitOutput(args: string[], cwd: string): Promise<string> {
  const out = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "null" })
    .output();
  return new TextDecoder().decode(out.stdout).trim();
}

function ruleOf(config: Record<string, unknown>): Record<string, string> | undefined {
  return (config.permission as { external_directory?: Record<string, string> })
    .external_directory;
}

Deno.test("com worktree, grava a regra também no opencode.json do worktree e o exclui do git — issue #389", async () => {
  const repo = await makeRepo();
  try {
    const worktree = await makeLinkedWorktree(repo);

    const result = await runCli({ cwd: repo, worktree: ".claude/worktrees/wt" });

    assertEquals(result.code, 0);
    const key = `${toForwardSlashes(repo)}/.claude/vetor/**`;
    assertEquals(ruleOf(await readOpencodeJson(repo))?.[key], "allow");
    assertEquals(ruleOf(await readOpencodeJson(worktree))?.[key], "allow");
    // O worker não pode enxergar o arquivo como mudança a commitar.
    assertEquals(await gitOutput(["status", "--porcelain"], worktree), "");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("com worktree, segunda chamada é idempotente (sem duplicar o exclude) — issue #389", async () => {
  const repo = await makeRepo();
  try {
    const worktree = await makeLinkedWorktree(repo);

    await runCli({ cwd: repo, worktree });
    const before = await Deno.readTextFile(`${worktree}/opencode.json`);
    const result = await runCli({ cwd: repo, worktree });

    assertEquals(result.code, 0);
    assertEquals(await Deno.readTextFile(`${worktree}/opencode.json`), before);
    const excludePath = await gitOutput(
      ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"],
      worktree,
    );
    const lines = (await Deno.readTextFile(excludePath)).split(/\r?\n/);
    assertEquals(lines.filter((line) => line === "/opencode.json").length, 1);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("recusa alterar opencode.json versionado no worktree — issue #389", async () => {
  const repo = await makeRepo();
  try {
    await Deno.writeTextFile(`${repo}/opencode.json`, '{ "mcp": {} }\n');
    await git(["add", "opencode.json"], repo);
    await git(["commit", "-q", "-m", "config versionada"], repo);
    const worktree = await makeLinkedWorktree(repo);
    const original = await Deno.readTextFile(`${worktree}/opencode.json`);

    const result = await runCli({ cwd: repo, worktree });

    assertEquals(result.code, 1);
    assertEquals(await Deno.readTextFile(`${worktree}/opencode.json`), original);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});
