import { assertEquals, assertRejects } from "@std/assert";
import {
  AiMemoryKnowledgeProvider,
  type AiMemoryMcpClient,
  AiMemoryUnavailableError,
  detectKnowledgeState,
  FilesystemKnowledgeProvider,
} from "../lib/knowledge.ts";

class MemoryMock implements AiMemoryMcpClient {
  pages = new Map<string, string>();
  calls: string[] = [];
  unavailable = false;

  // deno-lint-ignore require-await
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.calls.push(name);
    if (this.unavailable) throw new AiMemoryUnavailableError();
    const path = args.path as string;
    if (name === "memory_read_page") {
      if (!this.pages.has(path)) throw new Error("page not found");
      return { path, body: this.pages.get(path)!, title: path, frontmatter: {} };
    }
    if (name === "memory_write_page") {
      this.pages.set(path, args.body as string);
      return {};
    }
    if (name === "memory_query") {
      const query = String(args.query).toLowerCase();
      return [...this.pages].filter(([p, body]) =>
        p.toLowerCase().includes(query) || body.toLowerCase().includes(query)
      )
        .map(([p, body]) => ({ path: p, snippet: body.slice(0, 200) }));
    }
    if (name === "memory_recent") return [...this.pages.keys()].map((p) => ({ path: p }));
    throw new Error(`unexpected tool ${name}`);
  }
}

function setup() {
  const directory = Deno.makeTempDirSync();
  const fallback = new FilesystemKnowledgeProvider(directory);
  const client = new MemoryMock();
  const provider = new AiMemoryKnowledgeProvider(client, {
    workspace: "ws",
    project: "proj",
    fallback,
  }, () => {});
  return { directory, fallback, client, provider };
}

Deno.test("ai-memory executa CRUD, search, list e link conforme contrato", async () => {
  const { directory, client, provider } = setup();
  try {
    await provider.create("wiki/a.md", "Alpha conteúdo");
    await provider.create("decisions/b.md", "Decisão Beta");
    assertEquals(await provider.read("wiki/a.md"), "Alpha conteúdo");
    await assertRejects(() => provider.create("wiki/a.md", "dup"), Error, "já existe");
    await assertRejects(() => provider.read("missing.md"), Error);
    await assertRejects(() => provider.update("missing.md", "x"), Error);
    await provider.update("wiki/a.md", "Conteúdo atualizado");
    assertEquals((await provider.search("ATUALIZADO")).map((hit) => hit.path), ["wiki/a.md"]);
    assertEquals((await provider.search("decisions/b")).map((hit) => hit.path), ["decisions/b.md"]);
    assertEquals(await provider.list("wiki"), ["wiki/a.md"]);
    await provider.link("wiki/a.md", "decisions/b.md");
    await provider.link("wiki/a.md", "decisions/b.md");
    assertEquals(
      (await provider.read("wiki/a.md")).match(/Relacionado: decisions\/b.md/g)?.length,
      1,
    );
    await assertRejects(() => provider.link("wiki/a.md", "missing.md"), Error);
    await assertRejects(() => provider.read("../escape"), Error, "path inválido");
    assertEquals(client.calls.includes("memory_write_page"), true);
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("ai-memory usa filesystem quando o MCP está indisponível", async () => {
  const directory = Deno.makeTempDirSync();
  const fallback = new FilesystemKnowledgeProvider(directory);
  const client = new MemoryMock();
  client.unavailable = true;
  const provider = new AiMemoryKnowledgeProvider(client, {
    workspace: "ws",
    project: "proj",
    fallback,
  }, () => {});
  try {
    await provider.create("wiki/fallback.md", "Fallback text");
    assertEquals(await provider.read("wiki/fallback.md"), "Fallback text");
    assertEquals((await provider.search("fallback")).length, 1);
    assertEquals(await provider.list("wiki"), ["wiki/fallback.md"]);
    await provider.create("wiki/other.md", "other");
    await provider.link("wiki/fallback.md", "wiki/other.md");
    assertEquals(
      (await provider.read("wiki/fallback.md")).includes("Relacionado: wiki/other.md"),
      true,
    );
    await provider.update("wiki/fallback.md", "updated");
    assertEquals(await provider.read("wiki/fallback.md"), "updated");
    assertEquals(provider.warning !== undefined, true);
  } finally {
    Deno.removeSync(directory, { recursive: true });
  }
});

Deno.test("ai-memory exige workspace e project", () => {
  const client = new MemoryMock();
  try {
    new AiMemoryKnowledgeProvider(client, { workspace: "", project: "" }, () => {});
    throw new Error("expected constructor to reject missing scope");
  } catch (error) {
    assertEquals((error as Error).message.includes("workspace e project"), true);
  }
});

Deno.test("detectKnowledgeState reconhece ai-memory", () => {
  assertEquals(detectKnowledgeState({ knowledge: { provider: "ai-memory" } }), {
    status: "ai-memory",
    label: "✓ ai-memory",
  });
});
