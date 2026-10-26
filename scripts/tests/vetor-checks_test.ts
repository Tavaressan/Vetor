import { assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../vetor-checks.sh", import.meta.url));

// git sempre reporta paths com "/" (mesmo no Windows) em `git worktree list`. Os paths
// construídos aqui a partir de Deno.makeTempDir()/Deno.realPath() vêm no separador nativo
// (`\` no Windows) — normaliza antes de comparar com a saída de subprocessos git/bash.
function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * `vetor-checks.sh safe-remove-worktree` resolve paths via `cd "$path" && pwd -P` dentro do
 * bash — no Windows, o fstab do Git Bash pode mapear TEMP para um alias tipo `/tmp/...`,
 * diferente do path nativo devolvido por Deno.realPath. Resolve pela mesma via do script
 * para a comparação bater independente de como o Git Bash local está configurado.
 */
async function bashRealPath(path: string): Promise<string> {
  const out = await new Deno.Command("bash", {
    args: ["-c", 'cd "$1" && pwd -P', "bash", path],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return new TextDecoder().decode(out.stdout).trim();
}

async function runVetorChecks(
  cwd: string,
  ...args: string[]
): Promise<{ code: number; stderr: string }> {
  const cmd = new Deno.Command("bash", {
    args: [SCRIPT, ...args],
    cwd,
    stderr: "piped",
    stdout: "piped",
  });

  const { code: exitCode, success, stderr, stdout } = await cmd.output();
  const stderrText = new TextDecoder().decode(stderr);
  const stdoutText = new TextDecoder().decode(stdout);

  return {
    code: success ? 0 : args[0] === "carry-changes" ? exitCode : 1,
    stderr: `${stderrText}${stdoutText}`,
  };
}

async function git(args: string[], cwd: string): Promise<string> {
  const output = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(`git ${args.join(" ")} falhou: ${new TextDecoder().decode(output.stderr)}`);
  }
  return new TextDecoder().decode(output.stdout).trim();
}

async function makeRepo(): Promise<string> {
  const repo = await Deno.realPath(await Deno.makeTempDir());
  await git(["init", "-q", "-b", "main"], repo);
  await git(["config", "user.email", "test@example.com"], repo);
  await git(["config", "user.name", "Test"], repo);
  // Comparações de conteúdo não podem depender do core.autocrlf global da máquina.
  await git(["config", "core.autocrlf", "false"], repo);
  return repo;
}

async function exists(path: string): Promise<boolean> {
  return await Deno.stat(path).then(() => true, () => false);
}

Deno.test("carry-changes transporta modificações e novo staged com espaço e base divergente", async () => {
  const repo = await makeRepo();
  const worktree = `${repo}/worker`;
  try {
    // Mudanças em linhas afastadas: o merge de 3 vias trata linhas adjacentes como conflito.
    const base = "root line\nl2\nl3\nl4\nbase line\n";
    await Deno.writeTextFile(`${repo}/tracked.txt`, base);
    await Deno.writeTextFile(`${repo}/untouched.txt`, "safe\n");
    await git(["add", "."], repo);
    await git(["commit", "-q", "-m", "initial"], repo);
    await git(["worktree", "add", "-q", "-b", "feat/carry", worktree], repo);
    await Deno.writeTextFile(`${worktree}/tracked.txt`, "root line\nl2\nl3\nl4\nworktree line\n");
    await git(["add", "tracked.txt"], worktree);
    await git(["commit", "-q", "-m", "different base"], worktree);
    await Deno.writeTextFile(`${repo}/tracked.txt`, "changed root line\nl2\nl3\nl4\nbase line\n");
    await Deno.writeTextFile(`${repo}/new staged.txt`, "new file\n");
    await git(["add", "new staged.txt"], repo);
    const result = await runVetorChecks(repo, "carry-changes", worktree, "feat/carry");
    assertEquals(result.code, 0, result.stderr);
    assertEquals(await Deno.readTextFile(`${repo}/tracked.txt`), base);
    assertEquals(await Deno.readTextFile(`${repo}/untouched.txt`), "safe\n");
    assertEquals(
      await Deno.readTextFile(`${worktree}/tracked.txt`),
      "changed root line\nl2\nl3\nl4\nworktree line\n",
    );
    assertEquals(await Deno.readTextFile(`${worktree}/new staged.txt`), "new file\n");
    assertEquals(await exists(`${repo}/new staged.txt`), false);
    const diffIndex = await new Deno.Command("git", {
      args: ["diff-index", "--quiet", "HEAD", "--"],
      cwd: repo,
    }).output();
    assertEquals(diffIndex.code, 0);
    assertEquals(await exists(`${repo}/.claude/vetor/carry/feat-carry.patch`), true);
    // O diretório do backup se auto-ignora, mesmo sem entrada no .gitignore do projeto.
    assertEquals(await git(["status", "--porcelain", "--", ".claude"], repo), "");
  } finally {
    await Deno.remove(repo, { recursive: true }).catch(() => {});
  }
});

Deno.test("carry-changes informa conflito sem limpar root nem criar backup", async () => {
  const repo = await makeRepo();
  const worktree = `${repo}/worker`;
  try {
    await Deno.writeTextFile(`${repo}/conflict.txt`, "base\n");
    await git(["add", "."], repo);
    await git(["commit", "-q", "-m", "initial"], repo);
    await git(["worktree", "add", "-q", "-b", "feat/conflict", worktree], repo);
    await Deno.writeTextFile(`${worktree}/conflict.txt`, "worktree version\n");
    await git(["add", "conflict.txt"], worktree);
    await git(["commit", "-q", "-m", "worktree change"], worktree);
    await Deno.writeTextFile(`${repo}/conflict.txt`, "root version\n");
    const result = await runVetorChecks(repo, "carry-changes", worktree, "feat/conflict");
    assertEquals(result.code, 3);
    assertStringIncludes(result.stderr, "conflict.txt");
    assertEquals(await Deno.readTextFile(`${repo}/conflict.txt`), "root version\n");
    assertEquals(await exists(`${repo}/.claude/vetor/carry/feat-conflict.patch`), false);
    // A recuperação documentada no worktree-create precisa conseguir remover o worktree.
    const removal = await runVetorChecks(repo, "safe-remove-worktree", worktree);
    assertEquals(removal.code, 0, removal.stderr);
    assertEquals(await exists(worktree), false);
  } finally {
    await Deno.remove(repo, { recursive: true }).catch(() => {});
  }
});

Deno.test("carry-changes transporta rename e deixa o root limpo", async () => {
  const repo = await makeRepo();
  const worktree = `${repo}/worker`;
  try {
    await Deno.writeTextFile(`${repo}/a.txt`, "conteúdo\n");
    await git(["add", "."], repo);
    await git(["commit", "-q", "-m", "initial"], repo);
    await git(["worktree", "add", "-q", "-b", "feat/rename", worktree], repo);
    await git(["mv", "a.txt", "b.txt"], repo);
    const result = await runVetorChecks(repo, "carry-changes", worktree, "feat/rename");
    assertEquals(result.code, 0, result.stderr);
    const diffIndex = await new Deno.Command("git", {
      args: ["diff-index", "--quiet", "HEAD", "--"],
      cwd: repo,
    }).output();
    assertEquals(diffIndex.code, 0);
    assertEquals(await Deno.readTextFile(`${repo}/a.txt`), "conteúdo\n");
    assertEquals(await exists(`${repo}/b.txt`), false);
    assertEquals(await Deno.readTextFile(`${worktree}/b.txt`), "conteúdo\n");
    assertEquals(await exists(`${worktree}/a.txt`), false);
  } finally {
    await Deno.remove(repo, { recursive: true }).catch(() => {});
  }
});

Deno.test("safe-remove-worktree bloqueia remover pai que contém worktree filho", async () => {
  const repo = await makeRepo();
  const parent = `${repo}/parent`;
  const child = `${parent}/child`;

  try {
    await git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
    await git(["worktree", "add", "-q", "-b", "parent", parent], repo);
    await git(["worktree", "add", "-q", "-b", "child", child], repo);

    const result = await runVetorChecks(repo, "safe-remove-worktree", parent);

    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "cleanup bloqueado");
    assertStringIncludes(result.stderr, await bashRealPath(child));
    await Deno.stat(parent);
    await Deno.stat(child);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("safe-remove-worktree reporta diretório residual quando git worktree remove falha parcialmente", async () => {
  // Reproduz issue #157: git worktree remove DESREGISTRA o worktree e só então tenta apagar
  // o diretório. Se a exclusão falhar (no Windows, tipicamente por "Filename too long"; aqui
  // simulado com um subdiretório sem permissão de leitura/escrita), sobra um diretório órfão
  // que nenhuma outra checagem detecta. O comportamento esperado é sair não-zero citando o path.
  const repo = await makeRepo();
  const worktree = `${repo}/wt`;
  const lockedDir = `${worktree}/locked`;

  try {
    await git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
    await git(["worktree", "add", "-q", "-b", "wt", worktree], repo);
    await Deno.mkdir(`${lockedDir}/sub`, { recursive: true });
    await Deno.writeTextFile(`${lockedDir}/sub/file.txt`, "x");
    await Deno.chmod(lockedDir, 0o000);

    const result = await runVetorChecks(repo, "safe-remove-worktree", worktree);

    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, await bashRealPath(worktree));
    // O worktree já foi desregistrado do git, mas o diretório residual precisa ser sinalizado.
    await Deno.stat(worktree);
  } finally {
    await Deno.chmod(lockedDir, 0o755).catch(() => {});
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test({
  name:
    "safe-remove-worktree não alega uncommitted work quando o git desregistra mas falha ao apagar o diretório — issue #324",
  // No Windows o chmod 0o000 não impede a leitura: o git vê arquivos não rastreados e recusa a
  // remoção inteira, que é outro cenário (coberto pelo teste da PR #169 abaixo).
  ignore: Deno.build.os === "windows",
  fn: testResidualAfterUnregister,
});

async function testResidualAfterUnregister() {
  // O git sai != 0 depois de já ter desregistrado o worktree; a mensagem tem que ser a de
  // resíduo em disco, nunca a de "ainda registrado".
  const repo = await makeRepo();
  const worktree = `${repo}/wt-residual`;
  const lockedDir = `${worktree}/locked`;

  try {
    await git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
    await git(["worktree", "add", "-q", "-b", "wt-residual", worktree], repo);
    await Deno.mkdir(`${lockedDir}/sub`, { recursive: true });
    await Deno.writeTextFile(`${lockedDir}/sub/file.txt`, "x");
    await Deno.chmod(lockedDir, 0o000);

    const result = await runVetorChecks(repo, "safe-remove-worktree", worktree);

    assertEquals(result.code, 1);
    assertEquals(result.stderr.includes("ainda registrado"), false);
    assertStringIncludes(result.stderr, "desregistrou");
    const list = await git(["worktree", "list"], repo);
    assertEquals(list.includes("wt-residual"), false);
  } finally {
    await Deno.chmod(lockedDir, 0o755).catch(() => {});
    await Deno.remove(repo, { recursive: true });
  }
}

Deno.test("safe-remove-worktree diagnostica cwd dentro do path alvo quando a remoção residual falha — issue #411", async () => {
  const repo = await makeRepo();
  const worktree = `${repo}/wt-cwd`;
  const lockedDir = `${worktree}/locked`;

  try {
    await git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
    await git(["worktree", "add", "-q", "-b", "wt-cwd", worktree], repo);
    await Deno.mkdir(`${lockedDir}/sub`, { recursive: true });
    await Deno.writeTextFile(`${lockedDir}/sub/file.txt`, "x");
    await git(["add", "."], worktree);
    await git(["commit", "-q", "-m", "add tracked file"], worktree);
    await Deno.chmod(lockedDir, 0o000);

    const result = await runVetorChecks(worktree, "safe-remove-worktree", worktree);

    assertEquals(result.code, 1);
    assertEquals(result.stderr.includes("ainda registrado"), false);
    assertStringIncludes(result.stderr, "desregistrou");
    assertStringIncludes(result.stderr, "diretório de trabalho atual");
    assertStringIncludes(result.stderr, "está dentro dele");
    assertEquals(result.stderr.includes("Filename too long"), false);
  } finally {
    await Deno.chmod(lockedDir, 0o755).catch(() => {});
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("sync-root faz fast-forward quando o root já está na branch default e defasado — issue #322", async () => {
  const base = await Deno.realPath(await Deno.makeTempDir());
  const remote = `${base}/remote.git`;
  const other = `${base}/other`;
  const root = `${base}/root`;

  try {
    await git(["init", "-q", "--bare", "-b", "main", remote], base);
    await Deno.mkdir(other);
    await git(["init", "-q", "-b", "main"], other);
    await git(["config", "user.email", "test@example.com"], other);
    await git(["config", "user.name", "Test"], other);
    await git(["commit", "-q", "--allow-empty", "-m", "init"], other);
    await git(["remote", "add", "origin", remote], other);
    await git(["push", "-q", "-u", "origin", "main"], other);
    await git(["clone", "-q", remote, root], base);

    // origin/main avança a partir de outro clone; o root fica para trás na própria default.
    await git(["commit", "-q", "--allow-empty", "-m", "segundo"], other);
    await git(["push", "-q", "origin", "main"], other);
    const remoteHead = await git(["rev-parse", "HEAD"], other);

    const result = await runVetorChecks(root, "sync-root");

    assertEquals(result.code, 0);
    assertEquals(await git(["rev-parse", "HEAD"], root), remoteHead);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("safe-remove-worktree nunca força exclusão quando git worktree remove recusa (uncommitted work) — achado do code review da PR #169", async () => {
  // git worktree remove recusa remover um worktree com mudanças não commitadas (sem --force).
  // Nesse caso remove_status != 0 e o worktree segue REGISTRADO — o fallback de diretório
  // residual não pode rodar aqui, ou apagaria dados sem o git saber (achado real da PR #169).
  const repo = await makeRepo();
  const worktree = `${repo}/wt-dirty`;

  try {
    await git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
    await git(["worktree", "add", "-q", "-b", "wt-dirty", worktree], repo);
    await Deno.writeTextFile(`${worktree}/uncommitted.txt`, "trabalho em andamento");

    const result = await runVetorChecks(repo, "safe-remove-worktree", worktree);

    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, await bashRealPath(worktree));
    // Nunca deve alegar que desregistrou quando o git recusou a remoção inteira.
    assertEquals(result.stderr.includes("desregistrou"), false);
    // O diretório e o arquivo não commitado devem sobreviver intactos.
    await Deno.stat(worktree);
    await Deno.stat(`${worktree}/uncommitted.txt`);
    const list = await git(["worktree", "list"], repo);
    assertStringIncludes(list, "wt-dirty");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("validate-issue-ref rejeita valores não-numéricos", async () => {
  const result = await runVetorChecks(Deno.cwd(), "validate-issue-ref", "016-bdd");
  assertEquals(result.code, 1);
  assertEquals(result.stderr.includes("deve ser um inteiro positivo"), true);
  assertEquals(result.stderr.includes("016-bdd"), true);
});

Deno.test("validate-issue-ref aceita inteiros positivos", async () => {
  const result = await runVetorChecks(Deno.cwd(), "validate-issue-ref", "42");
  assertEquals(result.code, 0);
  assertEquals(result.stderr, "");
});

Deno.test("validate-issue-ref aceita inteiros grandes", async () => {
  const result = await runVetorChecks(Deno.cwd(), "validate-issue-ref", "999999");
  assertEquals(result.code, 0);
});

Deno.test("validate-issue-ref rejeita zero", async () => {
  const result = await runVetorChecks(Deno.cwd(), "validate-issue-ref", "0");
  assertEquals(result.code, 1);
});

Deno.test("validate-issue-ref rejeita inteiros negativos", async () => {
  const result = await runVetorChecks(Deno.cwd(), "validate-issue-ref", "-42");
  assertEquals(result.code, 1);
});

Deno.test("validate-issue-ref rejeita valores vazios", async () => {
  const cmd = new Deno.Command("bash", {
    args: [SCRIPT, "validate-issue-ref"],
    cwd: Deno.cwd(),
    stderr: "piped",
    stdout: "piped",
  });

  const { success, stderr } = await cmd.output();
  const stderrText = new TextDecoder().decode(stderr);

  assertEquals(success, false);
  assertEquals(stderrText.includes("uso:"), true);
});

Deno.test("debug-scan ignora padrão existente fora do diff — issue #93", async () => {
  const repo = await makeRepo();
  try {
    await Deno.writeTextFile(`${repo}/app.ts`, 'console.log("existing");\n');
    await git(["add", "app.ts"], repo);
    await git(["commit", "-q", "-m", "initial"], repo);
    await Deno.writeTextFile(
      `${repo}/app.ts`,
      'console.log("existing");\nexport const value = 1;\n',
    );

    const result = await runVetorChecks(repo, "debug-scan", "main");
    assertEquals(result.code, 0, result.stderr);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("debug-scan detecta padrão adicionado no diff — issue #93", async () => {
  const repo = await makeRepo();
  try {
    await Deno.writeTextFile(`${repo}/app.ts`, "export const value = 1;\n");
    await git(["add", "app.ts"], repo);
    await git(["commit", "-q", "-m", "initial"], repo);
    await Deno.writeTextFile(`${repo}/app.ts`, 'export const value = 1;\nconsole.log("debug");\n');

    const result = await runVetorChecks(repo, "debug-scan", "main");
    assertEquals(result.code, 1);
    assertEquals(result.stderr.includes('console.log("debug")'), true);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("debug-scan aceita console.log(JSON.stringify(...)) como saída de CLI — issue #245", async () => {
  const repo = await makeRepo();
  try {
    await Deno.writeTextFile(`${repo}/app.ts`, "export const value = 1;\n");
    await git(["add", "app.ts"], repo);
    await git(["commit", "-q", "-m", "initial"], repo);
    await Deno.writeTextFile(
      `${repo}/app.ts`,
      "export const value = 1;\nconsole.log(JSON.stringify(result, null, 2));\n",
    );

    const result = await runVetorChecks(repo, "debug-scan", "main");
    assertEquals(result.code, 0, result.stderr);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("debug-scan continua detectando console.log com string solta — issue #245", async () => {
  const repo = await makeRepo();
  try {
    await Deno.writeTextFile(`${repo}/app.ts`, "export const value = 1;\n");
    await git(["add", "app.ts"], repo);
    await git(["commit", "-q", "-m", "initial"], repo);
    await Deno.writeTextFile(`${repo}/app.ts`, 'export const value = 1;\nconsole.log("debug");\n');

    const result = await runVetorChecks(repo, "debug-scan", "main");
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, 'console.log("debug")');
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("debug-scan detecta it.only na mesma linha de console.log(JSON.stringify(...)) — issue #245", async () => {
  const repo = await makeRepo();
  try {
    await Deno.writeTextFile(`${repo}/app.ts`, "export const value = 1;\n");
    await git(["add", "app.ts"], repo);
    await git(["commit", "-q", "-m", "initial"], repo);
    await Deno.writeTextFile(
      `${repo}/app.ts`,
      'export const value = 1;\nconsole.log(JSON.stringify(x)); it.only("t", () => {});\n',
    );

    const result = await runVetorChecks(repo, "debug-scan", "main");
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "it.only");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("debug-scan usa origin quando a branch local está desatualizada — issue #70", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir());
  const source = `${root}/source`;
  const remote = `${root}/remote.git`;
  const worker = `${root}/worker`;
  try {
    await Deno.mkdir(source);
    await git(["init", "-q", "-b", "main"], source);
    await git(["config", "user.email", "test@example.com"], source);
    await git(["config", "user.name", "Test"], source);
    await Deno.writeTextFile(`${source}/app.ts`, "export const value = 1;\n");
    await git(["add", "app.ts"], source);
    await git(["commit", "-q", "-m", "initial"], source);
    await git(["init", "-q", "--bare", remote], source);
    await git(["remote", "add", "origin", remote], source);
    await git(["push", "-q", "-u", "origin", "main"], source);
    await git(["clone", "-q", remote, worker], root);
    await git(["config", "user.email", "test@example.com"], worker);
    await git(["config", "user.name", "Test"], worker);

    await Deno.writeTextFile(
      `${source}/app.ts`,
      'export const value = 1;\nconsole.log("shared");\n',
    );
    await git(["add", "app.ts"], source);
    await git(["commit", "-q", "-m", "remote debug line"], source);
    await git(["push", "-q"], source);
    await git(["fetch", "-q", "origin", "main"], worker);
    await Deno.writeTextFile(
      `${worker}/app.ts`,
      'export const value = 1;\nconsole.log("shared");\nexport const feature = true;\n',
    );

    // SKILL.md passes origin/$DEFAULT_BRANCH, so test must use origin/main
    const result = await runVetorChecks(worker, "debug-scan", "origin/main");
    assertEquals(result.code, 0, result.stderr);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("worktree-audit lista worktree linkado com uncommitted=yes e exclui o root", async () => {
  const repo = await Deno.makeTempDir();
  const linked = `${repo}/linked`;

  try {
    await git(["init", "-q", "-b", "main"], repo);
    await git(["config", "user.email", "test@example.com"], repo);
    await git(["config", "user.name", "Test"], repo);
    await git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
    await git(["worktree", "add", "-q", "-b", "feat/x", linked], repo);
    await Deno.writeTextFile(`${linked}/dirty.txt`, "conteúdo não commitado\n");

    const output = await new Deno.Command("bash", {
      args: [SCRIPT, "worktree-audit"],
      cwd: repo,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout);

    assertEquals(output.code, 0);
    assertStringIncludes(stdout, `${toPosix(linked)}|feat/x|`);
    assertStringIncludes(stdout, "|yes");
    // O root (repo) não deve aparecer na listagem.
    const rootLine = stdout.split("\n").find((l) => l.startsWith(`${toPosix(repo)}|`));
    assertEquals(rootLine, undefined);
  } finally {
    await git(["worktree", "remove", "-f", linked], repo);
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("find-orphan-status detecta status file sem worktree correspondente", async () => {
  const repo = await Deno.makeTempDir();
  const statusDir = `${repo}/.claude/vetor/status`;

  try {
    await git(["init", "-q", "-b", "main"], repo);
    await git(["config", "user.email", "test@example.com"], repo);
    await git(["config", "user.name", "Test"], repo);
    await git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
    await Deno.mkdir(statusDir, { recursive: true });
    const orphanPath = `${statusDir}/feat-orfao.md`;
    await Deno.writeTextFile(orphanPath, "# Agent Status\nStatus: GREEN\n");

    const output = await new Deno.Command("bash", {
      args: [SCRIPT, "find-orphan-status", statusDir],
      cwd: repo,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout);

    assertEquals(output.code, 0);
    assertStringIncludes(stdout, orphanPath);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("find-orphan-status não lista status file com worktree ativo", async () => {
  const repo = await Deno.makeTempDir();
  const linked = `${repo}/linked`;
  const statusDir = `${repo}/.claude/vetor/status`;

  try {
    await git(["init", "-q", "-b", "main"], repo);
    await git(["config", "user.email", "test@example.com"], repo);
    await git(["config", "user.name", "Test"], repo);
    await git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
    await git(["worktree", "add", "-q", "-b", "feat/ativa", linked], repo);
    await Deno.mkdir(statusDir, { recursive: true });
    await Deno.writeTextFile(`${statusDir}/feat-ativa.md`, "# Agent Status\nStatus: RUNNING\n");

    const output = await new Deno.Command("bash", {
      args: [SCRIPT, "find-orphan-status", statusDir],
      cwd: repo,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout);

    assertEquals(output.code, 0);
    assertEquals(stdout, "");
  } finally {
    await git(["worktree", "remove", "-f", linked], repo);
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("archive-orphan-status move o status file para o diretório archive/", async () => {
  const repo = await Deno.makeTempDir();
  const statusDir = `${repo}/.claude/vetor/status`;
  const target = `${statusDir}/feat-orfao.md`;

  try {
    await Deno.mkdir(statusDir, { recursive: true });
    await Deno.writeTextFile(target, "# Agent Status\nStatus: GREEN\n");

    const output = await new Deno.Command("bash", {
      args: [SCRIPT, "archive-orphan-status", target],
      cwd: repo,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout);

    assertEquals(output.code, 0);
    assertStringIncludes(stdout, "Arquivado");
    await Deno.stat(`${statusDir}/archive/feat-orfao.md`);
    let missing = false;
    try {
      await Deno.stat(target);
    } catch {
      missing = true;
    }
    assertEquals(missing, true);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("repo-root imprime o path do repositório principal quando executado de dentro de um worktree linkado — issue #160", async () => {
  const repo = await Deno.realPath(await Deno.makeTempDir());
  const linked = `${repo}/linked`;

  try {
    await git(["init", "-q", "-b", "main"], repo);
    await git(["config", "user.email", "test@example.com"], repo);
    await git(["config", "user.name", "Test"], repo);
    await git(["commit", "-q", "--allow-empty", "-m", "init"], repo);
    await git(["worktree", "add", "-q", "-b", "feat/x", linked], repo);

    const output = await new Deno.Command("bash", {
      args: [SCRIPT, "repo-root"],
      cwd: linked,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout).trim();

    assertEquals(output.code, 0);
    assertEquals(stdout, toPosix(repo));
  } finally {
    await git(["worktree", "remove", "-f", linked], repo);
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("repo-root imprime o próprio path quando executado do root do repositório — issue #160", async () => {
  const repo = await makeRepo();

  try {
    const output = await new Deno.Command("bash", {
      args: [SCRIPT, "repo-root"],
      cwd: repo,
      stdout: "piped",
      stderr: "piped",
    }).output();
    const stdout = new TextDecoder().decode(output.stdout).trim();

    assertEquals(output.code, 0);
    assertEquals(stdout, toPosix(repo));
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

// #428: o --carry-changes cria a branch a partir de origin/<default> enquanto a default local
// fica atrás (root sujo não recebe pull); a branch sem commits próprios deve ser removível.
async function makeRepoBehindOrigin(): Promise<{ repo: string; remote: string; other: string }> {
  const repo = await makeRepo();
  const remote = await Deno.realPath(await Deno.makeTempDir());
  const other = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(`${repo}/a.txt`, "v1\n");
  await git(["add", "."], repo);
  await git(["commit", "-q", "-m", "initial"], repo);
  await git(["init", "-q", "--bare", "-b", "main"], remote);
  await git(["remote", "add", "origin", remote], repo);
  await git(["push", "-q", "origin", "main"], repo);
  await git(["remote", "set-head", "origin", "main"], repo);
  await git(["clone", "-q", remote, other], other);
  await git(["config", "user.email", "test@example.com"], other);
  await git(["config", "user.name", "Test"], other);
  await Deno.writeTextFile(`${other}/a.txt`, "v2\n");
  await git(["commit", "-q", "-am", "advance origin"], other);
  await git(["push", "-q", "origin", "main"], other);
  await git(["fetch", "-q", "origin"], repo);
  return { repo, remote, other };
}

Deno.test("delete-merged-branch remove branch idêntica a origin/<default> com default local atrás", async () => {
  const { repo, remote, other } = await makeRepoBehindOrigin();
  try {
    await git(["branch", "feat/carry", "origin/main"], repo);
    const result = await runVetorChecks(repo, "delete-merged-branch", "feat/carry");
    assertEquals(result.code, 0, result.stderr);
    assertEquals(await git(["branch", "--list", "feat/carry"], repo), "");
  } finally {
    for (const dir of [repo, remote, other]) {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  }
});

Deno.test("delete-merged-branch preserva branch com commit próprio", async () => {
  const { repo, remote, other } = await makeRepoBehindOrigin();
  try {
    await git(["checkout", "-q", "-b", "feat/work", "origin/main"], repo);
    await Deno.writeTextFile(`${repo}/b.txt`, "trabalho\n");
    await git(["add", "b.txt"], repo);
    await git(["commit", "-q", "-m", "trabalho"], repo);
    await git(["checkout", "-q", "main"], repo);
    const result = await runVetorChecks(repo, "delete-merged-branch", "feat/work");
    assertEquals(result.code, 1);
    assertEquals(await git(["branch", "--list", "feat/work"], repo), "feat/work");
  } finally {
    for (const dir of [repo, remote, other]) {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  }
});

// #497: `migrations --against <ref>` soma à árvore atual as migrations da default — um PR preparado
// antes de outro ser mergeado não enxerga, na própria árvore, a migration que colidiria com a dele.
async function commitFile(repo: string, path: string, message: string) {
  await Deno.mkdir(`${repo}/${path.slice(0, path.lastIndexOf("/"))}`, { recursive: true });
  await Deno.writeTextFile(`${repo}/${path}`, "-- sql\n");
  await git(["add", path], repo);
  await git(["commit", "-q", "-m", message], repo);
}

Deno.test("migrations sem --against só olha a árvore atual (comportamento existente)", async () => {
  const repo = await makeRepo();
  try {
    await commitFile(repo, "svc/db/migration/V14__a.sql", "a na default");
    await git(["checkout", "-q", "-b", "feat/b", "HEAD~0"], repo);
    await git(["rm", "-q", "svc/db/migration/V14__a.sql"], repo);
    await commitFile(repo, "svc/db/migration/V14__b.sql", "b na feature");
    const result = await runVetorChecks(repo, "migrations");
    assertEquals(result.code, 0, result.stderr);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("migrations --against <ref> detecta versão duplicada entre a árvore atual e a default — issue #497", async () => {
  const repo = await makeRepo();
  try {
    await commitFile(repo, "svc/db/migration/V13__base.sql", "base");
    await git(["checkout", "-q", "-b", "feat/b"], repo);
    await commitFile(repo, "svc/db/migration/V14__b.sql", "b na feature");
    // a default avança com outra migration V14, depois do Pre-Ship da feature
    await git(["checkout", "-q", "main"], repo);
    await commitFile(repo, "svc/db/migration/V14__a.sql", "a na default");
    await git(["checkout", "-q", "feat/b"], repo);

    const alone = await runVetorChecks(repo, "migrations");
    assertEquals(alone.code, 0, "sozinha, a árvore da feature não enxerga a colisão");

    const against = await runVetorChecks(repo, "migrations", "--against", "main");
    assertEquals(against.code, 1);
    assertStringIncludes(against.stderr, "V14");
    assertStringIncludes(against.stderr, "V14__a.sql");
    assertStringIncludes(against.stderr, "V14__b.sql");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("migrations --against <ref> não acusa a mesma migration presente nos dois lados — issue #497", async () => {
  const repo = await makeRepo();
  try {
    await commitFile(repo, "svc/db/migration/V13__base.sql", "base");
    await git(["checkout", "-q", "-b", "feat/b"], repo);
    await commitFile(repo, "svc/db/migration/V14__b.sql", "b na feature");
    const result = await runVetorChecks(repo, "migrations", "--against", "main");
    assertEquals(result.code, 0, result.stderr);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("migrations --against com ref inexistente sai com erro de uso — issue #497", async () => {
  const repo = await makeRepo();
  try {
    await commitFile(repo, "svc/db/migration/V13__base.sql", "base");
    const result = await runVetorChecks(repo, "migrations", "--against", "origin/nao-existe");
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "ref inexistente");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("auto-ship-gates sem argumentos sai com erro de uso — issue #497", async () => {
  const repo = await makeRepo();
  try {
    const result = await runVetorChecks(repo, "auto-ship-gates", "42");
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "uso: vetor-checks.sh auto-ship-gates");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

// #495: check-disjoint resolve o repo-root e lê o cache de arquivos tocados de cada branch.
async function writeTouchedCache(repo: string, branch: string, modules: Record<string, string[]>) {
  const dir = `${repo}/.claude/vetor/status`;
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    `${dir}/${branch.replaceAll("/", "-")}-touched-files.json`,
    JSON.stringify({ branch, files: Object.values(modules).flat(), modules }),
  );
}

Deno.test("check-disjoint imprime DISJOINT (exit 0) para branches sem interseção — issue #495", async () => {
  const repo = await makeRepo();
  try {
    await writeTouchedCache(repo, "feat/a", { cli: ["cli/a.js"] });
    await writeTouchedCache(repo, "feat/b", { scripts: ["scripts/b.ts"] });
    const result = await runVetorChecks(repo, "check-disjoint", "feat/b", "feat/a");
    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stderr, "DISJOINT");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("check-disjoint imprime OVERLAP (exit 1) para branches que sobrepõem — issue #495", async () => {
  const repo = await makeRepo();
  try {
    await writeTouchedCache(repo, "feat/a", { scripts: ["scripts/common.ts"] });
    await writeTouchedCache(repo, "feat/b", { scripts: ["scripts/common.ts"] });
    const result = await runVetorChecks(repo, "check-disjoint", "feat/b", "feat/a");
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "OVERLAP: feat/a");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("check-disjoint sem argumentos suficientes sai com erro de uso — issue #495", async () => {
  const repo = await makeRepo();
  try {
    const result = await runVetorChecks(repo, "check-disjoint", "feat/b");
    assertEquals(result.code, 1);
    assertStringIncludes(result.stderr, "uso: vetor-checks.sh check-disjoint");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});
