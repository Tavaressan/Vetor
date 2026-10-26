import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "node:path";
import {
  computeTouchedFiles,
  evaluateAgainstOthers,
  evaluateDisjoint,
  extractModules,
  loadTouchedFiles,
  mapFilesToModules,
  parseModulePrefixes,
  sanitizeBranchName,
  type TouchedFilesCache,
} from "../lib/disjoint-merge.ts";

Deno.test("sanitizeBranchName substitui barras por traços", () => {
  assertEquals(sanitizeBranchName("feat/495-fast-merge"), "feat-495-fast-merge");
  assertEquals(sanitizeBranchName("fix/nested/branch/name"), "fix-nested-branch-name");
  assertEquals(sanitizeBranchName("master"), "master");
});

Deno.test("loadTouchedFiles lê e parseia cache existente com sucesso", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "vetor-disjoint-test-" });
  try {
    const statusDir = join(tempDir, ".claude", "vetor", "status");
    await Deno.mkdir(statusDir, { recursive: true });

    const cacheData: TouchedFilesCache = {
      branch: "feat/cli-opt",
      files: ["cli/index.js", "cli/writer.js"],
      modules: {
        cli: ["cli/index.js", "cli/writer.js"],
      },
    };

    await Deno.writeTextFile(
      join(statusDir, "feat-cli-opt-touched-files.json"),
      JSON.stringify(cacheData),
    );

    const loaded = loadTouchedFiles(tempDir, "feat/cli-opt");
    assertEquals(loaded?.branch, "feat/cli-opt");
    assertEquals(loaded?.files, ["cli/index.js", "cli/writer.js"]);
    assertEquals(extractModules(loaded!), ["cli"]);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("loadTouchedFiles retorna null quando o arquivo não existe ou é inválido", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "vetor-disjoint-test-" });
  try {
    assertEquals(loadTouchedFiles(tempDir, "inexistente"), null);

    const statusDir = join(tempDir, ".claude", "vetor", "status");
    await Deno.mkdir(statusDir, { recursive: true });
    await Deno.writeTextFile(
      join(statusDir, "broken-branch-touched-files.json"),
      "{ invalid json }",
    );
    assertEquals(loadTouchedFiles(tempDir, "broken-branch"), null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("evaluateDisjoint identifica conjuntos completamente disjuntos", () => {
  const cacheA: TouchedFilesCache = {
    branch: "feat/cli-opt",
    files: ["cli/lib/writer.js"],
    modules: { cli: ["cli/lib/writer.js"] },
  };

  const cacheB: TouchedFilesCache = {
    branch: "feat/scripts-opt",
    files: ["scripts/lib/status.ts"],
    modules: { scripts: ["scripts/lib/status.ts"] },
  };

  const result = evaluateDisjoint(cacheA, cacheB);
  assertEquals(result.disjoint, true);
  assertEquals(result.overlappingFiles, []);
  assertEquals(result.overlappingModules, []);
});

Deno.test("evaluateDisjoint detecta sobreposição direta de arquivos", () => {
  const cacheA: TouchedFilesCache = {
    branch: "feat/a",
    files: ["scripts/lib/status.ts", "README.md"],
    modules: { scripts: ["scripts/lib/status.ts"] },
  };

  const cacheB: TouchedFilesCache = {
    branch: "feat/b",
    files: ["README.md", "docs/index.md"],
    modules: { docs: ["docs/index.md"] },
  };

  const result = evaluateDisjoint(cacheA, cacheB);
  assertEquals(result.disjoint, false);
  assertEquals(result.overlappingFiles, ["README.md"]);
});

Deno.test("evaluateDisjoint detecta sobreposição de módulos mesmo sem arquivos em comum", () => {
  const cacheA: TouchedFilesCache = {
    branch: "feat/cli-1",
    files: ["cli/commands/install.js"],
    modules: { cli: ["cli/commands/install.js"] },
  };

  const cacheB: TouchedFilesCache = {
    branch: "feat/cli-2",
    files: ["cli/commands/update.js"],
    modules: { cli: ["cli/commands/update.js"] },
  };

  const result = evaluateDisjoint(cacheA, cacheB);
  assertEquals(result.disjoint, false);
  assertEquals(result.overlappingModules, ["cli"]);
  assertEquals(result.overlappingFiles, []);
});

Deno.test("evaluateAgainstOthers lista cada branch que sobrepõe, não só a última comparada", () => {
  const candidate: TouchedFilesCache = {
    branch: "feat/c",
    files: ["docs/c.md", "shared/util.ts"],
    modules: { docs: ["docs/c.md"], shared: ["shared/util.ts"] },
  };
  const a: TouchedFilesCache = {
    branch: "feat/a",
    files: ["shared/util.ts"],
    modules: { shared: ["shared/util.ts"] },
  };
  const b: TouchedFilesCache = {
    branch: "feat/b",
    files: ["cli/b.js"],
    modules: { cli: ["cli/b.js"] },
  };

  // C é disjunto de B (a última da lista), mas sobrepõe A (antes na lista)
  const result = evaluateAgainstOthers(candidate, [a, b]);
  assertEquals(result.disjoint, false);
  assertEquals(result.overlaps.length, 1);
  assertEquals(result.overlaps[0].branch, "feat/a");
  assertEquals(result.overlaps[0].overlappingFiles, ["shared/util.ts"]);
  assertEquals(result.overlaps[0].overlappingModules, ["shared"]);

  assertEquals(evaluateAgainstOthers(candidate, [b]).disjoint, true);
  assertEquals(evaluateAgainstOthers(candidate, []).disjoint, true);
});

const MODULE_MAP = `# Module Test Map

## Detecção de módulo por arquivos alterados

| Prefixo do path | Módulo |
|-----------------|--------|
| \`cli/\` | \`cli\` |
| \`./\` | \`root\` |

## Regras de execução
`;

Deno.test("parseModulePrefixes lê a tabela de prefixos do module-test-map e para na linha em branco", () => {
  assertEquals(parseModulePrefixes(MODULE_MAP), [
    { prefix: "cli/", module: "cli" },
    { prefix: "./", module: "root" },
  ]);
  assertEquals(parseModulePrefixes("# sem tabela"), []);
});

Deno.test("mapFilesToModules aplica o primeiro prefixo que casa e './' como catch-all", () => {
  const prefixes = parseModulePrefixes(MODULE_MAP);
  assertEquals(
    mapFilesToModules(["cli/a.js", "scripts/b.ts", "README.md"], prefixes),
    { cli: ["cli/a.js"], root: ["scripts/b.ts", "README.md"] },
  );
  assertEquals(mapFilesToModules(["x.ts"], []), {});
});

Deno.test("computeTouchedFiles recalcula via git diff three-dot e mapeia módulos", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "vetor-disjoint-compute-" });
  try {
    await Deno.mkdir(join(tempDir, ".claude", "vetor"), { recursive: true });
    await Deno.writeTextFile(join(tempDir, ".claude", "vetor", "module-test-map.md"), MODULE_MAP);

    const calls: string[][] = [];
    const runGit = (args: string[]) => {
      calls.push(args);
      return "cli/a.js\nscripts/b.ts\n";
    };
    const cache = computeTouchedFiles(tempDir, "feat/x", "master", runGit);
    assertEquals(calls[0], ["diff", "--name-only", "origin/master...feat/x"]);
    assertEquals(cache?.files, ["cli/a.js", "scripts/b.ts"]);
    assertEquals(cache?.modules, { cli: ["cli/a.js"], root: ["scripts/b.ts"] });

    // branch local inexistente: cai para origin/<branch>
    const fallbackCalls: string[][] = [];
    const viaOrigin = computeTouchedFiles(tempDir, "feat/x", "master", (args) => {
      fallbackCalls.push(args);
      return args[2].endsWith("...feat/x") ? null : "cli/z.js\n";
    });
    assertEquals(fallbackCalls.length, 2);
    assertEquals(fallbackCalls[1], ["diff", "--name-only", "origin/master...origin/feat/x"]);
    assertEquals(viaOrigin?.files, ["cli/z.js"]);

    // nem local nem remota: indisponível
    assertEquals(computeTouchedFiles(tempDir, "feat/x", "master", () => null), null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const scriptPath = join(Deno.cwd(), "scripts", "disjoint-check.ts");
  const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", scriptPath, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function writeCache(root: string, branch: string, files: Record<string, string[]>) {
  const statusDir = join(root, ".claude", "vetor", "status");
  await Deno.mkdir(statusDir, { recursive: true });
  await Deno.writeTextFile(
    join(statusDir, `${sanitizeBranchName(branch)}-touched-files.json`),
    JSON.stringify({ branch, files: Object.values(files).flat(), modules: files }),
  );
}

Deno.test("disjoint-check CLI compara o candidato com várias branches integradas e lista cada sobreposição", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "vetor-disjoint-cli-" });
  try {
    await writeCache(tempDir, "feat/c", { docs: ["docs/c.md"], shared: ["shared/u.ts"] });
    await writeCache(tempDir, "feat/a", { shared: ["shared/u.ts"] });
    await writeCache(tempDir, "feat/b", { cli: ["cli/b.js"] });

    const res = await runCli([tempDir, "feat/c", "feat/a", "feat/b"]);
    assertEquals(res.code, 1);
    assertStringIncludes(res.stdout, "OVERLAP: feat/a modules=[shared] files=[shared/u.ts]");
    assert(!res.stdout.includes("OVERLAP: feat/b"));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("disjoint-check CLI sai com 2 quando faltam arquivos tocados (sem cache nem git)", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "vetor-disjoint-cli-" });
  try {
    await writeCache(tempDir, "feat/a", { cli: ["cli/a.js"] });

    // sem cache de feat/b e sem repositório git em tempDir: não há como recalcular
    const res = await runCli([tempDir, "--default-branch=master", "feat/b", "feat/a"]);
    assertEquals(res.code, 2);
    assertStringIncludes(res.stderr, "feat-b");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("disjoint-check CLI sem cache recalcula via git diff contra origin/<default>", async () => {
  const base = await Deno.makeTempDir({ prefix: "vetor-disjoint-git-" });
  const git = async (cwd: string, ...args: string[]) => {
    const out = await new Deno.Command("git", {
      args: ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
      cwd,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  };
  try {
    const origin = join(base, "origin.git");
    const clone = join(base, "clone");
    await git(base, "init", "--bare", "-b", "master", origin);
    await git(base, "clone", origin, clone);
    await Deno.writeTextFile(join(clone, "base.txt"), "base");
    await git(clone, "add", ".");
    await git(clone, "commit", "-m", "base");
    await git(clone, "push", "origin", "HEAD:master");
    for (const [branch, file] of [["feat/a", "a.txt"], ["feat/b", "b.txt"]]) {
      await git(clone, "checkout", "-b", branch, "master");
      await Deno.writeTextFile(join(clone, file), file);
      await git(clone, "add", ".");
      await git(clone, "commit", "-m", file);
    }
    await git(clone, "fetch", "origin");

    // feat/a e feat/b não têm cache: a CLI recalcula via git e as vê disjuntas por arquivo
    const disjoint = await runCli([clone, "--default-branch=master", "feat/b", "feat/a"]);
    assertEquals(disjoint.code, 0, disjoint.stderr);
    assertStringIncludes(disjoint.stdout, "DISJOINT");

    // com a mesma branch nos dois lados, a sobreposição de arquivo é detectada
    const overlap = await runCli([clone, "--default-branch=master", "feat/b", "feat/b"]);
    assertEquals(overlap.code, 1);
    assertStringIncludes(overlap.stdout, "OVERLAP: feat/b files=[b.txt]");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("disjoint-check CLI emite DISJOINT e código 0 quando disjuntos", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "vetor-disjoint-cli-" });
  try {
    const statusDir = join(tempDir, ".claude", "vetor", "status");
    await Deno.mkdir(statusDir, { recursive: true });

    await Deno.writeTextFile(
      join(statusDir, "feat-a-touched-files.json"),
      JSON.stringify({
        branch: "feat/a",
        files: ["cli/a.js"],
        modules: { cli: ["cli/a.js"] },
      }),
    );

    await Deno.writeTextFile(
      join(statusDir, "feat-b-touched-files.json"),
      JSON.stringify({
        branch: "feat/b",
        files: ["scripts/b.ts"],
        modules: { scripts: ["scripts/b.ts"] },
      }),
    );

    const scriptPath = join(Deno.cwd(), "scripts", "disjoint-check.ts");
    const cmd = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", scriptPath, tempDir, "feat/a", "feat/b"],
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout } = await cmd.output();
    assertEquals(code, 0);
    assertStringIncludes(new TextDecoder().decode(stdout), "DISJOINT");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("disjoint-check CLI emite OVERLAP e código 1 quando sobrepostos", async () => {
  const tempDir = await Deno.makeTempDir({ prefix: "vetor-disjoint-cli-" });
  try {
    const statusDir = join(tempDir, ".claude", "vetor", "status");
    await Deno.mkdir(statusDir, { recursive: true });

    await Deno.writeTextFile(
      join(statusDir, "feat-a-touched-files.json"),
      JSON.stringify({
        branch: "feat/a",
        files: ["cli/common.js"],
        modules: { cli: ["cli/common.js"] },
      }),
    );

    await Deno.writeTextFile(
      join(statusDir, "feat-b-touched-files.json"),
      JSON.stringify({
        branch: "feat/b",
        files: ["cli/common.js"],
        modules: { cli: ["cli/common.js"] },
      }),
    );

    const scriptPath = join(Deno.cwd(), "scripts", "disjoint-check.ts");
    const cmd = new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", scriptPath, tempDir, "feat/a", "feat/b"],
      stdout: "piped",
      stderr: "piped",
    });

    const { code, stdout } = await cmd.output();
    assertEquals(code, 1);
    assertStringIncludes(new TextDecoder().decode(stdout), "OVERLAP");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
