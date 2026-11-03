import { assert, assertEquals } from "@std/assert";
import { type CommandExecutor, isNewerVersion, probeNow, probeVersion } from "../now-probe.ts";

Deno.test("now probe tolera repo sem MCP e gh e é idempotente", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const init = new Deno.Command("git", { args: ["init", dir], stdout: "null", stderr: "null" });
    await init.output();
    const fail: CommandExecutor = () => Promise.reject(new Error("comando indisponível"));
    const snapshot = async () => {
      const entries = [];
      for await (const entry of Deno.readDir(dir)) entries.push(entry.name);
      return entries.sort();
    };
    const before = await snapshot();
    const first = await probeNow(dir, fail);
    const second = await probeNow(dir, fail);
    assertEquals(first, second);
    assertEquals(first.branch, null);
    assertEquals(first.clean, null);
    assertEquals(first.worktrees, []);
    assertEquals(first.initialized, false);
    assertEquals(first.defaultDispatchLabel, null);
    assertEquals(first.openIssuesTotal, null);
    assertEquals(first.dispatchableIssues, null);
    assertEquals("backlogIssues" in first, false);
    assertEquals(first.mcps, []);
    assertEquals(first.aiMemoryContainerState, null);
    // Sem sinal verificável fora do harness (env ALETHE*/ORCA* não observadas em 2026-10-23)
    assertEquals("orchestrators" in first, false);
    assertEquals(await snapshot(), before);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("now probe reports ai-memory container state", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const cases: Array<[string | Error, string | null]> = [
      ["running", "running"],
      ["exited", "exited"],
      ["created", "created"],
      ["paused", "paused"],
      ["restarting", "restarting"],
      ["dead", "dead"],
      ["", "absent"],
      [new Error("Docker indisponível"), null],
    ];
    for (const [result, expected] of cases) {
      const executor: CommandExecutor = (command, args) => {
        if (command === "docker") {
          assertEquals(args, [
            "ps",
            "-a",
            "--filter",
            "name=^ai-memory$",
            "--format",
            "{{.State}}",
          ]);
          return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
        }
        return Promise.reject(new Error("comando indisponível"));
      };
      assertEquals(
        (await probeNow(dir, executor)).aiMemoryContainerState,
        expected,
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("now probe detecta inicialização, defaultDispatchLabel e contagens de issues", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const init = new Deno.Command("git", { args: ["init", dir], stdout: "null", stderr: "null" });
    await init.output();

    await Deno.mkdir(`${dir}/.claude/vetor`, { recursive: true });
    await Deno.writeTextFile(
      `${dir}/.claude/vetor/config.json`,
      JSON.stringify({ defaultDispatchLabel: "feature" }),
    );

    const issues = (n: number) =>
      JSON.stringify(Array.from({ length: n }, (_, i) => ({ number: i })));
    const issueCalls: string[][] = [];
    const mockExecutor: CommandExecutor = (_command, args) => {
      if (!(args.includes("issue") && args.includes("list"))) {
        return Promise.reject(new Error("mock fallback"));
      }
      issueCalls.push(args);
      const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : null;
      if (label === "feature") return Promise.resolve(issues(3));
      // Acima do default de 30 do gh: só aparece inteiro se --limit for passado.
      return Promise.resolve(issues(45));
    };

    const probed = await probeNow(dir, mockExecutor);
    assertEquals(probed.initialized, true);
    assertEquals(probed.defaultDispatchLabel, "feature");
    assertEquals(probed.openIssuesTotal, 45);
    assertEquals(probed.dispatchableIssues, 3);
    assertEquals("backlogIssues" in probed, false);
    for (const args of issueCalls) {
      assert(args.includes("--limit"), `gh issue list sem --limit satura em 30: ${args.join(" ")}`);
      const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : null;
      assert(
        label !== "backlog",
        `nenhuma chamada a gh deve usar a label backlog: ${args.join(" ")}`,
      );
    }
    assertEquals(issueCalls.length, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("now probe sem defaultDispatchLabel conta todas as abertas como despacháveis — issue #412", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/.claude/vetor`, { recursive: true });
    await Deno.writeTextFile(`${dir}/.claude/vetor/config.json`, JSON.stringify({}));
    const issueCalls: string[][] = [];
    const mockExecutor: CommandExecutor = (_command, args) => {
      if (!(args.includes("issue") && args.includes("list"))) {
        return Promise.reject(new Error("mock fallback"));
      }
      issueCalls.push(args);
      const n = args.includes("--label") ? 0 : 20;
      return Promise.resolve(JSON.stringify(Array.from({ length: n }, (_, i) => ({ number: i }))));
    };
    const probed = await probeNow(dir, mockExecutor);
    assertEquals(probed.defaultDispatchLabel, null);
    assertEquals(probed.openIssuesTotal, 20);
    assertEquals(probed.dispatchableIssues, 20);
    assertEquals("backlogIssues" in probed, false);
    for (const args of issueCalls) {
      const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : null;
      assert(
        label !== "backlog",
        `nenhuma chamada a gh deve usar a label backlog: ${args.join(" ")}`,
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("now probe ignora variáveis de ambiente de orquestradores", async () => {
  const dir = await Deno.makeTempDir();
  try {
    Deno.env.set("ALETHE_ORCHESTRATOR", "1");
    Deno.env.set("ALETHE_SESSION_ID", "sessao-1");

    const fail: CommandExecutor = () => Promise.reject(new Error("comando indisponível"));
    const probed = await probeNow(dir, fail);

    assertEquals("orchestrators" in probed, false);
  } finally {
    Deno.env.delete("ALETHE_ORCHESTRATOR");
    Deno.env.delete("ALETHE_SESSION_ID");
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("isNewerVersion compara numericamente", () => {
  assertEquals(isNewerVersion("1.2.0", "v1.3.0"), true);
  assertEquals(isNewerVersion("1.3.0", "1.3.0"), false);
  assertEquals(isNewerVersion("1.10.0", "1.9.0"), false);
});

Deno.test("probeVersion avisa release mais nova e tolera falha do gh", async () => {
  const ok: CommandExecutor = () => Promise.resolve("v99.0.0");
  const fail: CommandExecutor = () => Promise.reject(new Error("sem rede"));
  const withGh = await probeVersion(ok, ".");
  assert(withGh.installed !== null);
  assertEquals(withGh.latest, "99.0.0");
  assertEquals(withGh.updateAvailable, true);
  const noGh = await probeVersion(fail, ".");
  assertEquals(noGh.latest, null);
  assertEquals(noGh.updateAvailable, null);
});

Deno.test("probeVersion devolve latest null quando o gh trava além do timeout", async () => {
  const hang: CommandExecutor = () => new Promise<string>(() => {});
  const started = Date.now();
  const result = await probeVersion(hang, ".", undefined, 20);
  assertEquals(result.latest, null);
  assertEquals(result.updateAvailable, null);
  assert(Date.now() - started < 2000);
});

Deno.test("os 4 plugin.json têm a mesma version", async () => {
  const paths = [
    "../../plugin.json",
    "../../.claude-plugin/plugin.json",
    "../../.codex-plugin/plugin.json",
    "../../.cursor-plugin/plugin.json",
  ];
  const versions = await Promise.all(paths.map(async (p) => {
    const manifest = JSON.parse(await Deno.readTextFile(new URL(p, import.meta.url)));
    return manifest.version;
  }));
  assert(typeof versions[0] === "string");
  assertEquals(new Set(versions).size, 1, `versions divergentes: ${versions.join(", ")}`);
});
