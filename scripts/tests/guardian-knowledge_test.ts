import { assertEquals, assertStringIncludes } from "@std/assert";
import { auditAiMemory, auditGraphFreshness } from "../guardian-knowledge.ts";

async function git(args: string[], cwd: string): Promise<void> {
  const result = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
}

async function graphRepo(): Promise<string> {
  const repo = await Deno.realPath(await Deno.makeTempDir());
  await git(["init", "-q", "-b", "main"], repo);
  await git(["config", "user.email", "test@example.com"], repo);
  await git(["config", "user.name", "Test"], repo);
  await Deno.mkdir(`${repo}/graphify-out`, { recursive: true });
  await Deno.writeTextFile(`${repo}/graphify-out/graph.json`, "{}\n");
  await Deno.writeTextFile(`${repo}/graphify-out/GRAPH_REPORT.md`, "# Graph\n");
  await git(["add", "."], repo);
  await git(["commit", "-q", "-m", "init"], repo);
  return repo;
}

Deno.test("guardian graph audit reports recent graph artifacts as fresh", async () => {
  const repo = await graphRepo();
  try {
    // O mtime no futuro deixa o teste independente do relógio e dos segundos do git.
    const future = new Date(Date.now() + 60_000);
    await Deno.utime(`${repo}/graphify-out/graph.json`, future, future);
    await Deno.utime(`${repo}/graphify-out/GRAPH_REPORT.md`, future, future);
    assertStringIncludes(await auditGraphFreshness(repo), "Graphify atualizado");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("guardian graph audit alerts after more than five commits", async () => {
  const repo = await graphRepo();
  try {
    const past = new Date(Date.now() - 60_000);
    await Deno.utime(`${repo}/graphify-out/graph.json`, past, past);
    await Deno.utime(`${repo}/graphify-out/GRAPH_REPORT.md`, past, past);
    for (let i = 0; i < 6; i++) {
      await Deno.writeTextFile(`${repo}/change-${i}.ts`, `export const n = ${i};\n`);
      await git(["add", "."], repo);
      await git(["commit", "-q", "-m", `change ${i}`], repo);
    }
    assertStringIncludes(await auditGraphFreshness(repo), "Aviso: Graphify desatualizado");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("guardian graph audit treats missing artifacts as informational", async () => {
  const repo = await graphRepo();
  try {
    await Deno.remove(`${repo}/graphify-out/graph.json`);
    assertStringIncludes(await auditGraphFreshness(repo), "Informativo");
  } finally {
    await Deno.remove(repo, { recursive: true });
  }
});

Deno.test("guardian memory audit checks declared HTTP server and reports failures", async () => {
  const config = `${await Deno.makeTempDir()}/.mcp.json`;
  try {
    await Deno.writeTextFile(
      config,
      JSON.stringify({
        mcpServers: { "ai-memory": { type: "http", url: "http://memory.test/mcp" } },
      }),
    );
    const available = await auditAiMemory(
      config,
      () => Promise.resolve({ tools: [], memory_status: {} }),
    );
    assertStringIncludes(available, "ai-memory respondeu");
    const unavailable = await auditAiMemory(
      config,
      () => Promise.reject(new Error("connection refused")),
    );
    assertStringIncludes(unavailable, "Aviso: servidor ai-memory indisponível");
    assertStringIncludes(unavailable, "connection refused");
  } finally {
    await Deno.remove(config.substring(0, config.lastIndexOf("/")), { recursive: true });
  }
});

Deno.test("guardian memory audit reports undeclared server as informational", async () => {
  const config = `${await Deno.makeTempDir()}/.mcp.json`;
  try {
    await Deno.writeTextFile(config, JSON.stringify({ mcpServers: {} }));
    assertEquals(
      await auditAiMemory(config),
      "Informativo: ai-memory não declarado como servidor HTTP.",
    );
  } finally {
    await Deno.remove(config.substring(0, config.lastIndexOf("/")), { recursive: true });
  }
});
