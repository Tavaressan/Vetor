// Cobre o prompt de dispatch dos subagentes (issue #545). Os snapshots ficam em
// scripts/tests/fixtures/dispatch-prompt/; regenere com UPDATE_SNAPSHOTS=1.

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  buildContextPacket,
  renderContextPacketPrompt,
} from "../lib/orchestrator/context-packet.ts";
import {
  buildDispatchPrompt,
  type DispatchIssue,
  type DispatchPromptInput,
} from "../lib/orchestrator/dispatch-prompt.ts";

const FIXTURES = new URL("./fixtures/dispatch-prompt/", import.meta.url);
const STATUS = "/repo/.claude/vetor/status/feat-10-algo.md";
const MODULE_TEST_MAP = `# Module Test Map

## Comandos por módulo

| Módulo | Comando headless | Notas |
|--------|------------------|-------|
| \`root\` | \`deno task test\` | raiz |

## Detecção de módulo por arquivos alterados

| Prefixo do path | Módulo |
|-----------------|--------|
| \`./\` | \`root\` |
`;

const lead: DispatchIssue = {
  number: 10,
  title: "feat: algo",
  body: "Descrição.\n\n- [ ] critério um\n- [ ] critério dois\n\nMexe em `scripts/a.ts`.",
};
const sequential: DispatchIssue = { number: 11, title: "fix: depois", body: "Segue a #10." };
const spike: DispatchIssue = {
  number: 12,
  title: "spike: investigar",
  body: "Qual a melhor opção?",
  spike: true,
};

function packetFor(issue: DispatchIssue): string {
  return renderContextPacketPrompt(buildContextPacket({
    issue,
    slug: "algo",
    worktree: { branch: "feat/10-algo", baseBranch: "master" },
    moduleTestMap: MODULE_TEST_MAP,
  }));
}

async function snapshot(name: string, actual: string): Promise<void> {
  const url = new URL(`${name}.md`, FIXTURES);
  if (Deno.env.get("UPDATE_SNAPSHOTS")) {
    await Deno.mkdir(FIXTURES, { recursive: true });
    await Deno.writeTextFile(url, actual + "\n");
  }
  assertEquals(actual + "\n", await Deno.readTextFile(url), `snapshot ${name} divergiu`);
}

const base: Omit<DispatchPromptInput, "role"> = {
  issues: [lead],
  branch: "feat/10-algo",
  baseBranch: "master",
  statusFile: STATUS,
  knownEnvFailures: ["testes de CLI real (issue #544)"],
};

Deno.test("worker: grupo simples", async () => {
  await snapshot(
    "worker-simples",
    buildDispatchPrompt({ ...base, role: "worker", contextPacketPrompt: packetFor(lead) }),
  );
});

Deno.test("worker: grupo com issue sequencial em onda 2 e comandos pré-resolvidos", async () => {
  const prompt = buildDispatchPrompt({
    ...base,
    role: "worker",
    issues: [lead, sequential],
    wave: 2,
    testCommands: { root: "deno task test" },
    contextPacketPrompt: packetFor(lead),
  });
  assert(prompt.includes("Issue Sequencial: #11"));
  assert(prompt.includes("git fetch origin master"));
  await snapshot("worker-sequencial", prompt);
});

Deno.test("worker: spike dispensa TDD e exige relatório", async () => {
  const prompt = buildDispatchPrompt({
    ...base,
    role: "worker",
    issues: [spike],
    branch: "docs/12-investigar",
    contextPacketPrompt: packetFor(spike),
  });
  assert(prompt.includes("docs/investigations/<slug>.md"));
  assert(!prompt.includes("Siga TDD"));
  await snapshot("worker-spike", prompt);
});

Deno.test("ship: path, branch, issue, default e status file", async () => {
  const prompt = buildDispatchPrompt({ ...base, role: "ship", worktreePath: "/wt/algo" });
  assert(prompt.includes("Path do worktree: /wt/algo."));
  assert(prompt.includes(`Status file: ${STATUS}.`));
  await snapshot("ship", prompt);
});

Deno.test("review: PR, branch e base", async () => {
  await snapshot("review", buildDispatchPrompt({ ...base, role: "review", pr: 77 }));
});

Deno.test("fix: redispatch em worktree existente com motivo", async () => {
  await snapshot(
    "fix",
    buildDispatchPrompt({
      ...base,
      role: "fix",
      worktreePath: "/wt/algo",
      reason: "BLOCKED_WAITING resolvido: usar a opção A",
    }),
  );
});

Deno.test("campos obrigatórios por papel", () => {
  assertThrows(() => buildDispatchPrompt({ ...base, role: "ship" }), Error, "--worktree");
  assertThrows(() => buildDispatchPrompt({ ...base, role: "fix" }), Error, "--worktree");
  assertThrows(() => buildDispatchPrompt({ ...base, role: "review" }), Error, "--pr");
  assertThrows(() => buildDispatchPrompt({ ...base, role: "worker", issues: [] }), Error);
});

Deno.test("a skill do coordinator manda usar dispatch-prompt.ts", async () => {
  const skill = await Deno.readTextFile(
    new URL("../../skills/coordinator/SKILL.md", import.meta.url),
  );
  assert(skill.includes("scripts/dispatch-prompt.ts"));
  const ref = await Deno.readTextFile(
    new URL("../../skills/shared/references/issue-coordinator-dispatch.md", import.meta.url),
  );
  assert(ref.includes("Prompt gerado por `dispatch-prompt.ts`"));
});
