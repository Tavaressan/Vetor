// Teste de integração do hook safety-check.ts: sobe repositórios git reais em diretórios
// temporários e invoca o script como subprocesso (mesma via do PreToolUse real), verificando
// o exit code — 0 libera, 2 bloqueia (contrato descrito no topo de safety-check.ts).

import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";

const SCRIPT = new URL("../safety-check.ts", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

async function git(args: string[], cwd: string): Promise<string> {
  const out = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" })
    .output();
  if (!out.success) {
    throw new Error(`git ${args.join(" ")} falhou: ${new TextDecoder().decode(out.stderr)}`);
  }
  return new TextDecoder().decode(out.stdout).trim();
}

async function makeRepo(branch: string): Promise<string> {
  // realPath: no macOS, Deno.makeTempDir() devolve um path sob /var, que é symlink para
  // /private/var — `git rev-parse --show-toplevel` resolve para o path real, então sem isso
  // a comparação de path do guard não bateria.
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await git(["init", "-q", "-b", branch], dir);
  await git(["config", "user.email", "test@example.com"], dir);
  await git(["config", "user.name", "Test"], dir);
  await git(["commit", "-q", "--allow-empty", "-m", "init"], dir);
  return dir;
}

async function makeLinkedWorktree(
  branch: string,
): Promise<{ root: string; worktreePath: string }> {
  const root = await makeRepo("main");
  const worktreePath = `${root}/.claude/worktrees/${branch.replaceAll("/", "-")}`;
  await git(["worktree", "add", "-b", branch, worktreePath], root);
  return { root, worktreePath };
}

async function runHook(
  input: Record<string, unknown>,
  env?: Record<string, string>,
): Promise<{ code: number; stderr: string }> {
  const command = new Deno.Command("deno", {
    args: ["run", "-A", SCRIPT],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    env,
  });
  const child = command.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(input)));
  await writer.close();
  const out = await child.output();
  return { code: out.code, stderr: new TextDecoder().decode(out.stderr) };
}

Deno.test("issue-worker escrevendo fora de um worktree linkado (cwd = raiz) é bloqueado — issue #57", async () => {
  const root = await makeRepo("main");
  try {
    const { code, stderr } = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${root}/README.md` },
      cwd: root,
      agent_type: "vetor:issue-worker",
    });

    assertEquals(code, 2);
    assertStringIncludes(stderr, "fora de um worktree linkado");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("sessão normal (sem agent_type) escrevendo na raiz não é afetada", async () => {
  const root = await makeRepo("main");
  try {
    const { code } = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${root}/README.md` },
      cwd: root,
    });

    assertEquals(code, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("issue-worker escrevendo dentro do seu próprio worktree continua permitido", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("feat-x");
  try {
    const { code } = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${worktreePath}/README.md` },
      cwd: worktreePath,
      agent_type: "vetor:issue-worker",
    });

    assertEquals(code, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("issue-worker só pode escrever seu status Markdown na raiz — issue #71", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("feat-x");
  try {
    const status = await runHook({
      tool_name: "Write",
      tool_input: { file_path: `${root}/.claude/vetor/status/feat-x.md` },
      cwd: worktreePath,
      agent_type: "vetor:issue-worker",
    });
    assertEquals(status.code, 0, status.stderr);

    const nonMarkdown = await runHook({
      tool_name: "Write",
      tool_input: { file_path: `${root}/.claude/vetor/status/feat-x.json` },
      cwd: worktreePath,
      agent_type: "vetor:issue-worker",
    });
    assertEquals(nonMarkdown.code, 2);
    assertStringIncludes(nonMarkdown.stderr, "escrita fora do worktree bloqueada");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("issue-worker escrevendo fora do próprio worktree (outro diretório) continua bloqueado", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("feat-x");
  try {
    const { code, stderr } = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${root}/README.md` },
      cwd: worktreePath,
      agent_type: "vetor:issue-worker",
    });

    assertEquals(code, 2);
    assertStringIncludes(stderr, "escrita fora do worktree bloqueada");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("escrevendo em ~/.claude/projects/ (memória do Claude Code) com cwd num worktree não é bloqueado — issue #155", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("feat-x");
  const fakeHome = await Deno.realPath(await Deno.makeTempDir());
  try {
    const { code, stderr } = await runHook(
      {
        tool_name: "Edit",
        tool_input: { file_path: `${fakeHome}/.claude/projects/-repo-slug/memory/MEMORY.md` },
        cwd: worktreePath,
        agent_type: "vetor:issue-worker",
      },
      { HOME: fakeHome, USERPROFILE: fakeHome },
    );

    assertEquals(code, 0, stderr);
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(fakeHome, { recursive: true });
  }
});

function applyPatchCommand(...ops: string[]): string[] {
  return ["apply_patch", `*** Begin Patch\n${ops.join("\n")}\n*** End Patch\n`];
}

Deno.test("apply_patch (Codex) fora de um worktree linkado (cwd = raiz) é bloqueado — issue #76", async () => {
  const root = await makeRepo("main");
  try {
    const { code, stderr } = await runHook({
      tool_name: "apply_patch",
      tool_input: { command: applyPatchCommand("*** Update File: README.md\n@@\n-a\n+b") },
      cwd: root,
      agent_type: "vetor:issue-worker",
    });

    assertEquals(code, 2);
    assertStringIncludes(stderr, "fora de um worktree linkado");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("apply_patch (Codex) escrevendo dentro do próprio worktree continua permitido — issue #76", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("feat-x");
  try {
    const { code } = await runHook({
      tool_name: "apply_patch",
      tool_input: { command: applyPatchCommand("*** Update File: README.md\n@@\n-a\n+b") },
      cwd: worktreePath,
      agent_type: "vetor:issue-worker",
    });

    assertEquals(code, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("apply_patch (Codex) escrevendo fora do próprio worktree (path absoluto de outro dir) é bloqueado — issue #76", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("feat-x");
  try {
    const { code, stderr } = await runHook({
      tool_name: "apply_patch",
      tool_input: {
        command: applyPatchCommand(`*** Update File: ${root}/README.md\n@@\n-a\n+b`),
      },
      cwd: worktreePath,
      agent_type: "vetor:issue-worker",
    });

    assertEquals(code, 2);
    assertStringIncludes(stderr, "escrita fora do worktree bloqueada");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("apply_patch (Codex) multi-arquivo: um Add File fora do worktree é suficiente para bloquear — issue #76", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("feat-x");
  try {
    const { code, stderr } = await runHook({
      tool_name: "apply_patch",
      tool_input: {
        command: applyPatchCommand(
          "*** Update File: README.md\n@@\n-a\n+b",
          `*** Add File: ${root}/outside.txt\n+conteudo`,
        ),
      },
      cwd: worktreePath,
      agent_type: "vetor:issue-worker",
    });

    assertEquals(code, 2);
    assertStringIncludes(stderr, "escrita fora do worktree bloqueada");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("apply_patch (Codex) sem agent_type (sessão normal) na raiz não é afetado — issue #76", async () => {
  const root = await makeRepo("main");
  try {
    const { code } = await runHook({
      tool_name: "apply_patch",
      tool_input: { command: applyPatchCommand("*** Update File: README.md\n@@\n-a\n+b") },
      cwd: root,
    });

    assertEquals(code, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("safety-check.ts (integração): worktree válido dentro de .claude/worktrees passa", async () => {
  const repo = await makeRepo("main");
  const wt = `${repo}/.claude/worktrees/valid-wt`;
  await git(["worktree", "add", "-q", "-b", "valid-branch", wt], repo);

  const result = await runHook({
    tool_name: "Bash",
    tool_input: { command: "echo hi" },
    cwd: wt,
  });

  assertEquals(result.code, 0, result.stderr);
  await Deno.remove(repo, { recursive: true });
});

Deno.test("safety-check.ts (integração): worktree fora de .claude/worktrees é bloqueado (com agent_type)", async () => {
  const repo = await makeRepo("main");
  const outside = `${repo}-outside-wt`;
  await git(["worktree", "add", "-q", "-b", "outside-branch", outside], repo);

  const result = await runHook({
    tool_name: "Bash",
    tool_input: { command: "echo hi" },
    cwd: outside,
    agent_type: "vetor:issue-worker",
  });

  assertEquals(result.code, 2);
  assertMatch(result.stderr, /worktree fora de/i);

  await Deno.remove(repo, { recursive: true });
  await Deno.remove(outside, { recursive: true });
});

Deno.test("safety-check.ts (integração): worktree movido no disco sem atualizar o registro (stale) é bloqueado (com agent_type)", async () => {
  const repo = await makeRepo("main");
  const original = `${repo}/.claude/worktrees/stale-wt`;
  const moved = `${repo}/.claude/worktrees/stale-wt-moved`;
  await git(["worktree", "add", "-q", "-b", "stale-branch", original], repo);

  // Move só no filesystem — git worktree list continua apontando para o path antigo.
  await Deno.rename(original, moved);

  const result = await runHook({
    tool_name: "Bash",
    tool_input: { command: "echo hi" },
    cwd: moved,
    agent_type: "vetor:issue-worker",
  });

  assertEquals(result.code, 2);
  assertMatch(result.stderr, /stale/i);

  await Deno.remove(repo, { recursive: true });
});

Deno.test("issue #114: sessão sem agent_type com cwd num worktree stale NÃO é mais bloqueada por frescor", async () => {
  const repo = await makeRepo("main");
  const original = `${repo}/.claude/worktrees/stale-no-agent`;
  const moved = `${repo}/.claude/worktrees/stale-no-agent-moved`;
  await git(["worktree", "add", "-q", "-b", "stale-no-agent-branch", original], repo);

  // Move só no filesystem — git worktree list continua apontando para o path antigo.
  await Deno.rename(original, moved);

  const result = await runHook({
    tool_name: "Bash",
    tool_input: { command: "echo hi" },
    cwd: moved,
  });

  assertEquals(result.code, 0, result.stderr);

  await Deno.remove(repo, { recursive: true });
});

Deno.test("issue #114: sessão sem agent_type com cwd fora de .claude/worktrees NÃO é mais bloqueada por frescor", async () => {
  const repo = await makeRepo("main");
  const outside = `${repo}-outside-wt-no-agent`;
  await git(["worktree", "add", "-q", "-b", "outside-no-agent-branch", outside], repo);

  const result = await runHook({
    tool_name: "Bash",
    tool_input: { command: "echo hi" },
    cwd: outside,
  });

  assertEquals(result.code, 0, result.stderr);

  await Deno.remove(repo, { recursive: true });
  await Deno.remove(outside, { recursive: true });
});

Deno.test("cwd contaminado: mesmo agent_id, worktree diferente na segunda chamada é bloqueado — issue #63", async () => {
  const { root, worktreePath: worktreeA } = await makeLinkedWorktree("worker-a");
  const worktreeB = `${root}/.claude/worktrees/worker-b`;
  await git(["worktree", "add", "-q", "-b", "worker-b", worktreeB], root);
  try {
    const first = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${worktreeA}/README.md` },
      cwd: worktreeA,
      agent_type: "vetor:issue-worker",
      agent_id: "agent-123",
    });
    assertEquals(first.code, 0, first.stderr);

    // Mesmo agent_id da primeira chamada, mas agora o cwd resolve para o worktree de
    // OUTRO worker — reprodução do cenário real relatado na issue #63.
    const second = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${worktreeB}/README.md` },
      cwd: worktreeB,
      agent_type: "vetor:issue-worker",
      agent_id: "agent-123",
    });

    assertEquals(second.code, 2);
    assertStringIncludes(second.stderr, "cwd contaminado");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cwd contaminado: mesmo agent_id e mesmo worktree em chamadas repetidas continua liberado", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("worker-a");
  try {
    for (let i = 0; i < 3; i++) {
      const { code, stderr } = await runHook({
        tool_name: "Edit",
        tool_input: { file_path: `${worktreePath}/README.md` },
        cwd: worktreePath,
        agent_type: "vetor:issue-worker",
        agent_id: "agent-stable",
      });
      assertEquals(code, 0, stderr);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cwd contaminado: redispatch via cd explícito (sem subagent_type/agent_type) não é bloqueado por agent_id reciclado — issue #151", async () => {
  // Reprodução do padrão descrito na issue #151: o issue-coordinator redespacha um worker cujo
  // worktree já existe usando um Agent() genérico, sem `subagent_type` (logo sem `agent_type` no
  // payload do hook) e com um `cd` explícito para o worktree — ver issue-coordinator/SKILL.md
  // Fase 4. Nesse modo, o harness não garante `agent_id` único por worktree/instância (ao
  // contrário do dispatch nativo com `isolation: "worktree"`), então o mesmo `agent_id` pode
  // legitimamente aparecer associado a worktrees diferentes ao longo da sessão — não deve ser
  // tratado como contaminação.
  const { root, worktreePath: worktreeA } = await makeLinkedWorktree("worker-a");
  const worktreeB = `${root}/.claude/worktrees/worker-b`;
  await git(["worktree", "add", "-q", "-b", "worker-b", worktreeB], root);
  try {
    const first = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${worktreeA}/README.md` },
      cwd: worktreeA,
      agent_id: "agent-recycled",
    });
    assertEquals(first.code, 0, first.stderr);

    const second = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${worktreeB}/README.md` },
      cwd: worktreeB,
      agent_id: "agent-recycled",
    });

    assertEquals(second.code, 0, second.stderr);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("cwd contaminado: sem agent_id no payload, a checagem de binding não se aplica (sem regressão)", async () => {
  const { root, worktreePath: worktreeA } = await makeLinkedWorktree("worker-a");
  const worktreeB = `${root}/.claude/worktrees/worker-b`;
  await git(["worktree", "add", "-q", "-b", "worker-b", worktreeB], root);
  try {
    await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${worktreeA}/README.md` },
      cwd: worktreeA,
      agent_type: "vetor:issue-worker",
    });

    const { code } = await runHook({
      tool_name: "Edit",
      tool_input: { file_path: `${worktreeB}/README.md` },
      cwd: worktreeB,
      agent_type: "vetor:issue-worker",
    });

    assertEquals(code, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("issue #123: git push multi-linha para branch não-protegida não é bloqueado por menção a branch protegida em outra linha", async () => {
  const repo = await makeRepo("main");
  try {
    const result = await runHook({
      tool_name: "Bash",
      tool_input: {
        command:
          "git push -u origin bug/123-push-destination-regex\ngh pr create --title x --base master",
      },
      cwd: repo,
    });

    assertEquals(result.code, 0, result.stderr);
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("issue #123: git push direto para master continua bloqueado (sem regressão)", async () => {
  const repo = await makeRepo("main");
  try {
    const result = await runHook({
      tool_name: "Bash",
      tool_input: { command: "git push origin master" },
      cwd: repo,
    });

    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "protected branches");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("issue #123: git push para master combinado com && continua bloqueado (sem regressão)", async () => {
  const repo = await makeRepo("main");
  try {
    const result = await runHook({
      tool_name: "Bash",
      tool_input: { command: "echo hi && git push origin master" },
      cwd: repo,
    });

    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "protected branches");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("issue #123 (review): git push com continuação de linha (\\) para master continua bloqueado", async () => {
  const repo = await makeRepo("main");
  try {
    const result = await runHook({
      tool_name: "Bash",
      tool_input: { command: "git push \\\norigin master" },
      cwd: repo,
    });

    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "protected branches");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("issue #161: heredoc contendo o texto 'git push'/'gh pr create' como conteúdo não dispara o gate de worker não-GREEN", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("worker-a");
  await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
  await Deno.writeTextFile(
    `${root}/.claude/vetor/status/worker-a.md`,
    "Status: RUNNING\nIteration: 1/5 (Issue #1)\n",
  );
  try {
    // O comando real é só um `python3 <<EOF ... EOF` escrevendo um arquivo — "git push"/"gh pr
    // create" aparecem apenas como conteúdo textual dentro do heredoc, não como comando.
    const command = [
      "python3 <<'EOF'",
      "with open('notes.txt', 'w') as f:",
      "    f.write('lembrete: nunca faça git push ou gh pr create manualmente')",
      "EOF",
    ].join("\n");

    const result = await runHook({
      tool_name: "Bash",
      tool_input: { command },
      cwd: worktreePath,
    });

    assertEquals(result.code, 0, result.stderr);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("issue #161: git push real após && continua bloqueado por worker não-GREEN (sem regressão)", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("worker-a");
  await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
  await Deno.writeTextFile(
    `${root}/.claude/vetor/status/worker-a.md`,
    "Status: RUNNING\nIteration: 1/5 (Issue #1)\n",
  );
  try {
    const result = await runHook({
      tool_name: "Bash",
      tool_input: { command: "echo done && git push -u origin worker-a" },
      cwd: worktreePath,
    });

    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "worker não-GREEN");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("issue #161: gh pr create no início do comando continua bloqueado por worker não-GREEN (sem regressão)", async () => {
  const { root, worktreePath } = await makeLinkedWorktree("worker-a");
  await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
  await Deno.writeTextFile(
    `${root}/.claude/vetor/status/worker-a.md`,
    "Status: RUNNING\nIteration: 1/5 (Issue #1)\n",
  );
  try {
    const result = await runHook({
      tool_name: "Bash",
      tool_input: { command: "gh pr create --title x --base main" },
      cwd: worktreePath,
    });

    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "worker não-GREEN");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("safety-check.ts (integração): sem regressão — raiz do repositório principal continua liberada", async () => {
  const repo = await makeRepo("main");

  const result = await runHook({
    tool_name: "Bash",
    tool_input: { command: "echo hi" },
    cwd: repo,
  });

  assertEquals(result.code, 0, result.stderr);
  await Deno.remove(repo, { recursive: true });
});
