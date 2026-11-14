import { assert, assertEquals } from "@std/assert";

const cliPath = new URL("../execution-plan.ts", import.meta.url).pathname;

async function runCli(args: string[]) {
  return await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", cliPath, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
}

Deno.test("execution-plan CLI: --help descreve o dry-run sem requerer entradas", async () => {
  const result = await runCli(["--help"]);
  assertEquals(result.code, 0);
  const output = new TextDecoder().decode(result.stdout);
  assert(output.includes("não despacha tarefas"));
  assert(output.includes("--write-log"));
  assertEquals(new TextDecoder().decode(result.stderr), "");
});

Deno.test("execution-plan CLI: entradas fixas produzem plano JSON e só gravam com flag", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/.claude/vetor`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/.claude/vetor/config.json`,
      JSON.stringify({
        execution: {
          mode: "assisted",
          authorizedExecutors: ["claude-code"],
          dataSensitivityPolicy: {
            public: ["claude-code"],
            private: [],
            sensitive: [],
            unknown: ["claude-code"],
          },
        },
      }),
    );
    await Deno.writeTextFile(
      `${root}/.claude/vetor/module-test-map.md`,
      `| Módulo | Comando |
| --- | --- |
| scripts | deno task test |
| Prefixo | Módulo |
| --- | --- |
| scripts/ | scripts |
| ./ | scripts |`,
    );
    const issuePath = `${root}/issue.json`;
    await Deno.writeTextFile(
      issuePath,
      JSON.stringify({
        number: 657,
        title: "feat(execution): CLI de dry-run",
        body: "## Critério de aceite\n- [ ] imprime plano",
        labels: [{ name: "enhancement" }, { name: "scripts" }],
      }),
    );

    const args = ["--root", root, "--issue-json", issuePath];
    const result = await runCli(args);
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    const output = JSON.parse(new TextDecoder().decode(result.stdout));
    assertEquals(output.plan.taskId, "657");
    assertEquals(output.plan.policyMode, "assisted");
    assertEquals(output.plan.action, "delegate");
    assertEquals(output.plan.primary.executorId, "claude-code");
    assertEquals(output.decision.selected.executorId, "claude-code");
    assertEquals(output.decision.profile.operations, ["feat"]);
    assertEquals(output.decision.profile.dataSensitivity, "unknown");
    assertEquals(
      await Deno.stat(`${root}/.claude/vetor/status/routing-log.jsonl`).then(() => true).catch(() =>
        false
      ),
      false,
    );

    const logged = await runCli([...args, "--write-log"]);
    assertEquals(logged.code, 0, new TextDecoder().decode(logged.stderr));
    const log = await Deno.readTextFile(`${root}/.claude/vetor/status/routing-log.jsonl`);
    assertEquals(JSON.parse(log).decisionId, "657#0");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("execution-plan CLI: modo manual resulta em inline sem avaliar candidatos", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/.claude/vetor`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/.claude/vetor/config.json`,
      JSON.stringify({
        execution: {
          mode: "manual",
          authorizedExecutors: ["claude-code"],
          dataSensitivityPolicy: {
            public: ["claude-code"],
            private: [],
            sensitive: [],
            unknown: ["claude-code"],
          },
        },
      }),
    );
    await Deno.writeTextFile(
      `${root}/.claude/vetor/module-test-map.md`,
      `| Módulo | Comando |
| --- | --- |
| scripts | deno task test |`,
    );
    const issuePath = `${root}/issue.json`;
    await Deno.writeTextFile(
      issuePath,
      JSON.stringify({
        number: 100,
        title: "fix: corrigir bug",
        body: "descrição",
        labels: ["bug"],
      }),
    );

    const args = ["--root", root, "--issue-json", issuePath];
    const result = await runCli(args);
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    const output = JSON.parse(new TextDecoder().decode(result.stdout));
    assertEquals(output.plan.policyMode, "manual");
    assertEquals(output.plan.action, "inline");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("execution-plan CLI: erros de validação encerram com código diferente de zero", async () => {
  // Sem entradas
  const noArgs = await runCli([]);
  assertEquals(noArgs.code, 1);
  assert(new TextDecoder().decode(noArgs.stderr).includes("informe --issue <N> ou --issue-json"));

  // Duas entradas conflitantes
  const conflict = await runCli(["--issue", "123", "--issue-json", "/tmp/any.json"]);
  assertEquals(conflict.code, 1);
  assert(
    new TextDecoder().decode(conflict.stderr).includes(
      "use apenas uma entrada: --issue ou --issue-json",
    ),
  );
});
