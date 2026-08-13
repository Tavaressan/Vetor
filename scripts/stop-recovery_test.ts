import { assertEquals, assertStringIncludes } from "@std/assert";

const SCRIPT = new URL("./stop-recovery.ts", import.meta.url).pathname;

/**
 * Roda o script como subprocesso Deno e envia `input` via stdin, simulando o
 * payload real que o Claude Code passa ao hook Stop.
 */
async function runHook(
  input: Record<string, unknown>,
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const command = new Deno.Command("deno", {
    args: ["run", "-A", SCRIPT],
    cwd: opts.cwd,
    env: opts.env,
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
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

Deno.test("stop-recovery não falha com erro de sintaxe/compilação ao rodar", async () => {
  const { code, stderr } = await runHook({});
  assertEquals(code, 0, `stderr inesperado: ${stderr}`);
  assertEquals(
    stderr.includes("error: Uncaught SyntaxError") || stderr.includes("error: The parser expected"),
    false,
    `script falhou por erro de sintaxe/compilação:\n${stderr}`,
  );
});

async function run(cmd: string, args: string[], cwd: string): Promise<void> {
  const { code, stderr } = await new Deno.Command(cmd, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (code !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} falhou: ${new TextDecoder().decode(stderr)}`);
  }
}

/** Repo git real com um arquivo `a.ts` já commitado, para testar o escape de isGitClean. */
async function makeRepoWithFile(): Promise<{ root: string; filePath: string }> {
  const root = (await Deno.makeTempDir()).replaceAll("\\", "/");
  await run("git", ["init", "-q"], root);
  await run("git", ["config", "user.email", "test@example.com"], root);
  await run("git", ["config", "user.name", "Test"], root);
  const filePath = `${root}/a.ts`;
  await Deno.writeTextFile(filePath, "conteudo original\n");
  await run("git", ["add", "a.ts"], root);
  await run("git", ["commit", "-q", "-m", "init"], root);
  return { root, filePath };
}

/** Transcript .jsonl com um Edit aplicado (tool_result sem erro) cujo `new_string` não bate
 * com o disco — divergência do tipo "conteúdo não reflete a edição registrada". */
function editTranscript(filePath: string, newString: string): string {
  const toolUse = {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "Edit",
          input: { file_path: filePath, old_string: "a", new_string: newString },
        },
      ],
    },
  };
  const toolResult = {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", is_error: false }],
    },
  };
  return [toolUse, toolResult].map((l) => JSON.stringify(l)).join("\n");
}

async function writeTranscript(dir: string, raw: string): Promise<string> {
  const path = `${dir}/transcript.jsonl`;
  await Deno.writeTextFile(path, raw);
  return path;
}

Deno.test("stop-recovery issue #137: divergência já reportada não re-bloqueia a mesma sessão", async () => {
  const { root, filePath } = await makeRepoWithFile();
  const home = await Deno.makeTempDir();
  try {
    // Disco fica "sujo" com um conteúdo que não bate nem com o commitado nem com o `new_string`
    // esperado — isGitClean() dá false, então a divergência não é resolvida via git (issue #105).
    await Deno.writeTextFile(filePath, "conteudo modificado manualmente\n");
    const transcriptPath = await writeTranscript(
      root,
      editTranscript(filePath, "conteudo esperado pela edicao"),
    );
    const input = { transcript_path: transcriptPath, session_id: "session-a" };
    const env = { HOME: home, USERPROFILE: home };

    const first = await runHook(input, { cwd: root, env });
    assertStringIncludes(first.stdout, "decision");
    assertStringIncludes(first.stdout, "possível trabalho perdido");

    const second = await runHook(input, { cwd: root, env });
    assertEquals(
      second.stdout.trim(),
      "",
      `esperava silêncio na 2ª chamada, veio: ${second.stdout}`,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("stop-recovery issue #137: nova divergência no mesmo arquivo volta a alertar", async () => {
  const { root, filePath } = await makeRepoWithFile();
  const home = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(filePath, "conteudo modificado manualmente\n");
    const env = { HOME: home, USERPROFILE: home };

    const firstTranscript = await writeTranscript(
      root,
      editTranscript(filePath, "primeira edicao esperada"),
    );
    const first = await runHook(
      { transcript_path: firstTranscript, session_id: "session-b" },
      { cwd: root, env },
    );
    assertStringIncludes(first.stdout, "decision");

    // Mesma sessão, mas uma edição NOVA (expected diferente) no mesmo arquivo: deve alertar de novo.
    const secondTranscript = await writeTranscript(
      root,
      editTranscript(filePath, "segunda edicao, diferente da primeira"),
    );
    const second = await runHook(
      { transcript_path: secondTranscript, session_id: "session-b" },
      { cwd: root, env },
    );
    assertStringIncludes(second.stdout, "decision");
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
});
