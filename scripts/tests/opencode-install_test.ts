// Issue #477: `.opencode/scripts/` do projeto-alvo é gerado do canônico em `scripts/` pelo
// instalador (cli/lib/installer/writer.js), não versionado em `opencode/scripts/`. Estes testes
// instalam num diretório temporário e exercitam o layout instalado de verdade: os imports
// resolvem e o plugin `.opencode/plugin/vetor.ts` aciona o `safety-check.ts` canônico.

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { installFiles } = require("../../cli/lib/installer/writer.js") as {
  installFiles: (options: { projectRoot: string; engines: unknown[] }) => {
    copied: string[];
    skipped: unknown[];
  };
};

async function run(command: string, args: string[], cwd: string): Promise<string> {
  const output = await new Deno.Command(command, { args, cwd, stdout: "piped", stderr: "piped" })
    .output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  if (!output.success) throw new Error(`${command} ${args.join(" ")} falhou: ${stderr}${stdout}`);
  return stdout;
}

async function listFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) files.push(...await listFiles(path));
    else files.push(path);
  }
  return files;
}

interface InstalledProject {
  root: string;
  worktree: string;
}

// Repositório temporário com o OpenCode instalado e um worktree linkado, o cenário em que o guard
// de escrita do safety-check atua.
async function withInstalledProject(test: (project: InstalledProject) => Promise<void>) {
  const root = await Deno.realPath(await Deno.makeTempDir());
  try {
    await run("git", ["init", "-q", "-b", "main"], root);
    await run("git", ["config", "user.email", "test@example.com"], root);
    await run("git", ["config", "user.name", "Test"], root);
    await run("git", ["commit", "-q", "--allow-empty", "-m", "init"], root);

    const { skipped } = installFiles({
      projectRoot: root,
      engines: [{ id: "opencode", name: "OpenCode", detected: false }],
    });
    assertEquals(skipped, []);

    await run("git", ["worktree", "add", "-q", ".claude/worktrees/w1", "-b", "w1"], root);
    await test({ root, worktree: `${root}/.claude/worktrees/w1` });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

type BeforeHook = (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: Record<string, unknown> },
) => Promise<void>;

async function loadBeforeHook(project: InstalledProject): Promise<BeforeHook> {
  const module = await import(pathToFileURL(`${project.root}/.opencode/plugin/vetor.ts`).href);
  const plugin = await module.VetorPlugin({
    directory: project.worktree,
    worktree: project.worktree,
  });
  return plugin["tool.execute.before"] as BeforeHook;
}

Deno.test("OpenCode instalado: os scripts e o plugin passam no deno check no layout instalado", async () => {
  await withInstalledProject(async ({ root }) => {
    // Os `_test.ts` importam `@std/assert`, que o projeto-alvo não tem; o que importa é o código
    // que o plugin e o agent executam.
    const scripts = (await listFiles(`${root}/.opencode/scripts`)).filter((file) =>
      file.endsWith(".ts") && !file.endsWith("_test.ts")
    );
    const names = scripts.map((file) => file.slice(`${root}/.opencode/`.length));
    for (
      const expected of [
        "scripts/check-edit.ts",
        "scripts/safety-check.ts",
        "scripts/lib/safety-policy.ts",
        "scripts/lib/project.ts",
        "scripts/resolve-model.ts",
      ]
    ) {
      assert(names.includes(expected), `${expected} ausente do layout instalado`);
    }

    await run(Deno.execPath(), ["check", ...scripts, `${root}/.opencode/plugin/vetor.ts`], root);
  });
});

Deno.test("OpenCode instalado: o plugin aciona o safety-check canônico e a política de shell da #476", async () => {
  await withInstalledProject(async (project) => {
    const before = await loadBeforeHook(project);

    const error = await assertRejects(() =>
      before(
        { tool: "bash", sessionID: "s1", callID: "c1" },
        { args: { command: "git reset --hard" } },
      )
    );
    assertStringIncludes(String(error), "destrutivo");
  });
});

// O OpenCode `tool.execute.before` não traz o `agent` do worker (wiki/Hooks.md), então o guard de
// escrita precisa ser estrito por cwd: é o `--strict-worktree-writes` que o plugin passa ao
// canônico, o mesmo parâmetro do Codex e do Cursor (#384).
Deno.test("OpenCode instalado: o guard de escrita fica estrito por cwd sem agent_type", async () => {
  await withInstalledProject(async (project) => {
    const before = await loadBeforeHook(project);

    const error = await assertRejects(() =>
      before(
        { tool: "write", sessionID: "s2", callID: "c2" },
        { args: { filePath: `${project.root}/README.md` } },
      )
    );
    assertStringIncludes(String(error), "escrita fora do worktree");

    await before(
      { tool: "write", sessionID: "s2", callID: "c3" },
      { args: { filePath: `${project.worktree}/README.md` } },
    );
  });
});

// Issue #478: o agent carrega a skill `coordinator` pela ferramenta `skill`. O OpenCode a descobre
// em `.opencode/skills/<nome>/SKILL.md` e a skill resolve as referências por `../shared/references/`.
Deno.test("OpenCode instalado: a skill coordinator e as referências citadas resolvem pelo caminho relativo da skill", async () => {
  await withInstalledProject(async ({ root }) => {
    const skillDir = `${root}/.opencode/skills/coordinator`;
    const skill = await Deno.readTextFile(`${skillDir}/SKILL.md`);
    const cited = [...skill.matchAll(/\.\.\/shared\/references\/([A-Za-z0-9._-]+\.md)/g)].map((m) =>
      m[1]
    );
    assert(cited.length > 0, "a skill deveria citar referências");

    for (const name of cited) {
      await Deno.stat(`${skillDir}/../shared/references/${name}`);
    }

    // Só o coordinator: as demais skills do plugin não vão para o OpenCode.
    const installed: string[] = [];
    for await (const entry of Deno.readDir(`${root}/.opencode/skills`)) installed.push(entry.name);
    assertEquals(installed.sort(), ["coordinator", "shared"]);
  });
});

async function opencodeAvailable(): Promise<boolean> {
  try {
    const out = await new Deno.Command("opencode", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return out.success;
  } catch {
    return false;
  }
}

// Roda contra o binário `opencode` real quando disponível; do contrário, pula (dependência externa
// opcional, como em opencode/scripts/agent-registration_test.ts). Versão exercitada e versão mínima:
// wiki/Compatibilidade-OpenCode.md, seção "Deduplicação de scripts e do coordinator".
Deno.test({
  name:
    "OpenCode real: descobre a skill coordinator instalada e resolve a permissão skill do agent",
  ignore: !await opencodeAvailable(),
  fn: async () => {
    await withInstalledProject(async ({ root }) => {
      // `--pure` não carrega plugins externos: sem ele, o `opencode` instala as dependências do
      // plugin `vetor.ts` e leva minutos por chamada; skills e agents são lidos do mesmo jeito.
      const [skillsJson, agentJson] = await Promise.all([
        run("opencode", ["debug", "skill", "--pure"], root),
        run("opencode", ["debug", "agent", "issue-coordinator", "--pure"], root),
      ]);

      const skills = JSON.parse(skillsJson) as { name: string; location: string }[];
      const coordinator = skills.find((skill) => skill.name === "coordinator");
      assert(coordinator !== undefined, "o OpenCode não descobriu a skill coordinator");
      assert(
        coordinator.location.replaceAll("\\", "/").endsWith(
          ".opencode/skills/coordinator/SKILL.md",
        ),
        coordinator.location,
      );

      const agent = JSON.parse(agentJson) as {
        mode: string;
        permission: { permission: string; pattern: string; action: string }[];
      };
      assertEquals(agent.mode, "primary");
      // O OpenCode avalia com `findLast`: o `allow` do coordinator precisa vir depois do `deny` geral.
      const skillRules = agent.permission.filter((rule) => rule.permission === "skill");
      assertEquals(skillRules.map((rule) => `${rule.pattern}:${rule.action}`), [
        "*:deny",
        "coordinator:allow",
      ]);
    });
  },
});
