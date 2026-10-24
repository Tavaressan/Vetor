// Teste do hook PreToolUse do Antigravity (scripts/safety-check-antigravity.ts): invoca o script
// como subprocesso (mesma via do hooks.json real), com o evento em JSON no stdin, e confere a
// decisão em JSON no stdout. Porta, em Deno, a suíte do antigo runner Node (issue #476).
//
// Todo subprocesso roda com um diretório de processo próprio, fora do repositório, para que o
// resultado nunca dependa do status file do worktree que executa os testes (nem do cwd herdado).

import { assertEquals, assertFalse, assertMatch, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";
import { handleEvent } from "../safety-check-antigravity.ts";
import type { SafetyDecision } from "../lib/safety-policy.ts";

const ANTIGRAVITY_SCRIPT = fileURLToPath(
  new URL("../safety-check-antigravity.ts", import.meta.url),
);
const CLAUDE_SCRIPT = fileURLToPath(new URL("../safety-check.ts", import.meta.url));

async function git(args: string[], cwd: string): Promise<void> {
  const out = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" })
    .output();
  if (!out.success) {
    throw new Error(`git ${args.join(" ")} falhou: ${new TextDecoder().decode(out.stderr)}`);
  }
}

/** realPath: no macOS o temp dir fica sob um symlink, e o git resolve o path real. */
async function makeTempDir(): Promise<string> {
  return await Deno.realPath(await Deno.makeTempDir());
}

async function makeRepo(branch: string): Promise<string> {
  const dir = await makeTempDir();
  await git(["init", "-q", "-b", branch], dir);
  await git(["config", "user.email", "test@example.com"], dir);
  await git(["config", "user.name", "Test"], dir);
  await git(["commit", "-q", "--allow-empty", "-m", "init"], dir);
  return dir;
}

/** Repositório com um worktree linkado na branch feat/minha-feature e o status do worker no root. */
async function makeWorkerWorktree(
  status: string,
): Promise<{ root: string; worktreePath: string; statusFile: string }> {
  const root = await makeRepo("master");
  const worktreePath = `${root}/wt-feat`;
  await git(["worktree", "add", "-q", "-b", "feat/minha-feature", worktreePath], root);

  const statusDir = `${root}/.claude/vetor/status`;
  await Deno.mkdir(statusDir, { recursive: true });
  const statusFile = `${statusDir}/feat-minha-feature.md`;
  await Deno.writeTextFile(statusFile, `Status: ${status}\n`);
  return { root, worktreePath, statusFile };
}

interface HookResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function spawnHook(script: string, raw: string, cwd: string): Promise<HookResult> {
  const child = new Deno.Command("deno", {
    args: ["run", "-A", script],
    cwd,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(raw));
  await writer.close();
  const out = await child.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

/** Sem `processCwd`, o processo roda num diretório temporário vazio (fora de qualquer repo). */
async function runRaw(
  script: string,
  raw: string,
  processCwd?: string,
): Promise<HookResult> {
  const ownDir = processCwd === undefined ? await makeTempDir() : undefined;
  try {
    return await spawnHook(script, raw, processCwd ?? ownDir!);
  } finally {
    if (ownDir) await Deno.remove(ownDir, { recursive: true });
  }
}

/** Roda o hook do Antigravity e valida que o stdout é só o JSON de decisão (exit 0). */
async function runAntigravity(
  payload: unknown,
  processCwd?: string,
): Promise<{ result: HookResult; decision: SafetyDecision }> {
  const result = await runRaw(ANTIGRAVITY_SCRIPT, JSON.stringify(payload), processCwd);
  assertEquals(result.code, 0, result.stderr);
  return { result, decision: JSON.parse(result.stdout) as SafetyDecision };
}

function runCommandPayload(commandLine: string, cwd?: string): unknown {
  return { toolCall: { name: "run_command", args: { CommandLine: commandLine, Cwd: cwd } } };
}

function assertDeny(decision: SafetyDecision, reason: RegExp): void {
  assertEquals(decision.decision, "deny");
  assertMatch((decision as { reason: string }).reason, reason);
}

Deno.test("permite comandos comuns e inócuos", async () => {
  const { result, decision } = await runAntigravity(runCommandPayload("npm test"));

  assertEquals(decision, { decision: "allow" });
  assertEquals(result.stdout.trim(), '{"decision":"allow"}');
});

Deno.test("bloqueia push para branches protegidas (main, master, production)", async () => {
  for (const branch of ["main", "master", "production"]) {
    const { decision } = await runAntigravity(runCommandPayload(`git push origin ${branch}`));
    assertDeny(decision, /Push to protected branches/);
  }
});

Deno.test("bloqueia push para branch protegida com flags (--force, -u)", async () => {
  const { decision } = await runAntigravity(runCommandPayload("git push --force origin main"));
  assertDeny(decision, /Push to protected branches/);
});

Deno.test("bloqueia push para branch protegida com flag depois do destino (issue #488)", async () => {
  for (
    const command of [
      "git push origin main --force",
      "git push origin master -u",
      "git push origin HEAD:main --force",
    ]
  ) {
    const { decision } = await runAntigravity(runCommandPayload(command));
    assertDeny(decision, /Push to protected branches/);
  }
});

Deno.test("permite push para branch não protegida com flag depois do destino (issue #488)", async () => {
  const { decision } = await runAntigravity(runCommandPayload("git push origin feature --force"));
  assertEquals(decision, { decision: "allow" });
});

Deno.test("permite push para branch de feature não protegida fora de worktree linkado", async () => {
  const repo = await makeRepo("feat/test");
  try {
    const { decision } = await runAntigravity(
      runCommandPayload("git push origin feat/test", repo),
      repo,
    );
    assertEquals(decision, { decision: "allow" });
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("bloqueia comandos git destrutivos (reset --hard, clean -f, branch -D, checkout .)", async () => {
  const destructiveCommands = [
    "git reset --hard HEAD~1",
    "git clean -fd",
    "git clean -xdf",
    "git branch -D feat/branch",
    "git checkout .",
    "git checkout . ",
  ];

  for (const command of destructiveCommands) {
    const { decision } = await runAntigravity(runCommandPayload(command));
    assertDeny(decision, /comando git destrutivo bloqueado incondicionalmente/);
  }
});

Deno.test("permite git checkout em arquivos específicos sem colidir com checkout .", async () => {
  const { decision } = await runAntigravity(
    runCommandPayload("git checkout .github/workflows/ci.yml"),
  );
  assertEquals(decision, { decision: "allow" });
});

Deno.test("JSON inválido no stdin libera o comando, loga em stderr e não vaza o payload", async () => {
  // O JSON truncado carrega um marcador: a mensagem do JSON.parse do V8 repete trechos da entrada.
  const raw = '{"toolCall":{"args":{"CommandLine":"echo SEGREDO-NO-PAYLOAD"';
  const result = await runRaw(ANTIGRAVITY_SCRIPT, raw);

  assertEquals(result.code, 0);
  assertEquals(JSON.parse(result.stdout), { decision: "allow" });
  assertStringIncludes(result.stderr, "JSON inválido");
  assertStringIncludes(result.stderr, "SyntaxError");
  assertFalse(result.stderr.includes("SEGREDO-NO-PAYLOAD"));
});

Deno.test("stdin vazio libera o comando e loga em stderr", async () => {
  const result = await runRaw(ANTIGRAVITY_SCRIPT, "");

  assertEquals(result.code, 0);
  assertEquals(JSON.parse(result.stdout), { decision: "allow" });
  assertStringIncludes(result.stderr, "JSON inválido");
});

Deno.test("payload JSON válido sem CommandLine string libera o comando", async () => {
  const payloads: unknown[] = [
    {},
    null,
    [],
    "git push origin main",
    { toolCall: { name: "run_command" } },
    { toolCall: { name: "run_command", args: {} } },
    { toolCall: { name: "run_command", args: { CommandLine: 42 } } },
    { toolCall: { name: "run_command", args: { CommandLine: ["git", "push", "origin", "main"] } } },
  ];

  for (const payload of payloads) {
    const { decision } = await runAntigravity(payload);
    assertEquals(decision, { decision: "allow" }, JSON.stringify(payload));
  }
});

Deno.test("bloqueia push de worker não-GREEN via toolCall.args.Cwd, com o processo fora do repo, e libera quando GREEN", async () => {
  const { root, worktreePath, statusFile } = await makeWorkerWorktree("RUNNING");
  try {
    const command = runCommandPayload("git push origin feat/minha-feature", worktreePath);

    const blocked = await runAntigravity(command);
    assertDeny(blocked.decision, /worker não-GREEN/);

    await Deno.writeTextFile(statusFile, "Status: GREEN\n");
    const allowed = await runAntigravity(command);
    assertEquals(allowed.decision, { decision: "allow" });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("sem Cwd no payload, usa o diretório do processo do hook", async () => {
  const { root, worktreePath } = await makeWorkerWorktree("RUNNING");
  try {
    const { decision } = await runAntigravity(
      runCommandPayload("git push origin feat/minha-feature"),
      worktreePath,
    );
    assertDeny(decision, /worker não-GREEN/);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("Cwd inexistente libera o comando (sem worktree para consultar)", async () => {
  const { decision } = await runAntigravity(
    runCommandPayload("git push origin feat/minha-feature", "/caminho/que/nao/existe"),
  );
  assertEquals(decision, { decision: "allow" });
});

Deno.test("a política é única: Claude Code bloqueia com exit 2 e o mesmo motivo que o Antigravity devolve", async () => {
  const { root, worktreePath } = await makeWorkerWorktree("RUNNING");
  try {
    const commands = [
      "git push origin master",
      "git reset --hard HEAD~1",
      "git push origin feat/minha-feature",
    ];

    for (const command of commands) {
      const antigravity = await runAntigravity(runCommandPayload(command, worktreePath));
      assertEquals(antigravity.decision.decision, "deny", command);

      const claude = await runRaw(
        CLAUDE_SCRIPT,
        JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: worktreePath }),
      );
      assertEquals(claude.code, 2, command);
      assertEquals(
        claude.stderr.trim(),
        (antigravity.decision as { reason: string }).reason.trim(),
        command,
      );
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

/** Captura o que o hook escreve em console.error durante `fn`. */
async function captureStderr<T>(fn: () => Promise<T>): Promise<{ value: T; log: string }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    return { value: await fn(), log: lines.join("\n") };
  } finally {
    console.error = original;
  }
}

Deno.test("falha interna na avaliação libera o comando e loga classe e mensagem, sem o comando", async () => {
  const payload = JSON.stringify(runCommandPayload("echo SEGREDO-NO-COMANDO", "/qualquer"));

  const { value, log } = await captureStderr(() =>
    handleEvent(
      () => Promise.resolve(payload),
      () => Promise.reject(new TypeError("falha simulada na política")),
    )
  );

  assertEquals(value, { decision: "allow" });
  assertStringIncludes(log, "TypeError");
  assertStringIncludes(log, "falha simulada na política");
  assertFalse(log.includes("SEGREDO-NO-COMANDO"));
});

Deno.test("falha ao ler o stdin libera o comando e loga a causa", async () => {
  const { value, log } = await captureStderr(() =>
    handleEvent(() => Promise.reject(new Error("stdin indisponível")))
  );

  assertEquals(value, { decision: "allow" });
  assertStringIncludes(log, "stdin indisponível");
});
