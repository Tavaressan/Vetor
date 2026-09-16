import { assertEquals, assertRejects } from "@std/assert";
import { detectKnowledgeState, FilesystemKnowledgeProvider } from "../lib/knowledge.ts";

function tempProvider(): { dir: string; provider: FilesystemKnowledgeProvider } {
  const dir = Deno.makeTempDirSync();
  return { dir, provider: new FilesystemKnowledgeProvider(dir) };
}

function cleanup(dir: string) {
  Deno.removeSync(dir, { recursive: true });
}

// --- FilesystemKnowledgeProvider: funciona sem nenhuma configuração de knowledge ---

Deno.test("create escreve um novo arquivo e read devolve o conteúdo", async () => {
  const { dir, provider } = tempProvider();
  try {
    await provider.create("notes/hello.md", "# Hello");
    assertEquals(await provider.read("notes/hello.md"), "# Hello");
  } finally {
    cleanup(dir);
  }
});

Deno.test("create em path já existente lança erro", async () => {
  const { dir, provider } = tempProvider();
  try {
    await provider.create("a.md", "x");
    await assertRejects(() => provider.create("a.md", "y"));
  } finally {
    cleanup(dir);
  }
});

Deno.test("update em path inexistente lança erro", async () => {
  const { dir, provider } = tempProvider();
  try {
    await assertRejects(() => provider.update("missing.md", "y"));
  } finally {
    cleanup(dir);
  }
});

Deno.test("update sobrescreve conteúdo de entrada existente", async () => {
  const { dir, provider } = tempProvider();
  try {
    await provider.create("a.md", "x");
    await provider.update("a.md", "z");
    assertEquals(await provider.read("a.md"), "z");
  } finally {
    cleanup(dir);
  }
});

Deno.test("read em path inexistente lança erro", async () => {
  const { dir, provider } = tempProvider();
  try {
    await assertRejects(() => provider.read("missing.md"));
  } finally {
    cleanup(dir);
  }
});

Deno.test("list devolve entradas relativas ao root com separador /", async () => {
  const { dir, provider } = tempProvider();
  try {
    await provider.create("specs/one.md", "1");
    await provider.create("specs/two.md", "2");

    const entries = await provider.list("specs");
    assertEquals(entries.sort(), ["specs/one.md", "specs/two.md"]);
  } finally {
    cleanup(dir);
  }
});

Deno.test("list sem argumento lista a partir da raiz do provider", async () => {
  const { dir, provider } = tempProvider();
  try {
    await provider.create("root.md", "1");
    const entries = await provider.list();
    assertEquals(entries, ["root.md"]);
  } finally {
    cleanup(dir);
  }
});

Deno.test("search encontra entradas por conteúdo, case-insensitive", async () => {
  const { dir, provider } = tempProvider();
  try {
    await provider.create("a.md", "contém ADR importante");
    await provider.create("b.md", "sem relação");

    const results = await provider.search("adr");
    assertEquals(results.length, 1);
    assertEquals(results[0].path, "a.md");
  } finally {
    cleanup(dir);
  }
});

Deno.test("search também encontra por path", async () => {
  const { dir, provider } = tempProvider();
  try {
    await provider.create("adrs/001-decisao.md", "conteúdo qualquer");
    const results = await provider.search("decisao");
    assertEquals(results.length, 1);
  } finally {
    cleanup(dir);
  }
});

Deno.test("link é idempotente — aplicar duas vezes não duplica a referência", async () => {
  const { dir, provider } = tempProvider();
  try {
    await provider.create("source.md", "# Source");
    await provider.create("target.md", "# Target");

    await provider.link("source.md", "target.md");
    await provider.link("source.md", "target.md");

    const content = await provider.read("source.md");
    const occurrences = content.split("target.md").length - 1;
    assertEquals(occurrences, 1);
  } finally {
    cleanup(dir);
  }
});

Deno.test("link não trata substring de outro nome como referência já presente", async () => {
  const { dir, provider } = tempProvider();
  try {
    await provider.create("ab.md", "# AB");
    await provider.create("b.md", "# B");
    await provider.create("source.md", "# Source");

    // Link para "ab.md" não deve "satisfazer" um link futuro para "b.md" só porque
    // a string "b.md" aparece como substring de "ab.md" no conteúdo.
    await provider.link("source.md", "ab.md");
    await provider.link("source.md", "b.md");

    const content = await provider.read("source.md");
    assertEquals(content.includes("- Relacionado: ab.md"), true);
    assertEquals(content.includes("- Relacionado: b.md"), true);
  } finally {
    cleanup(dir);
  }
});

Deno.test("link lança erro se source ou target não existirem", async () => {
  const { dir, provider } = tempProvider();
  try {
    await provider.create("source.md", "# Source");
    await assertRejects(() => provider.link("source.md", "missing.md"));
    await assertRejects(() => provider.link("missing.md", "source.md"));
  } finally {
    cleanup(dir);
  }
});

Deno.test("delete remove uma entrada existente", async () => {
  const { dir, provider } = tempProvider();
  try {
    await provider.create("a.md", "x");
    await provider.delete!("a.md");
    assertEquals(await provider.exists!("a.md"), false);
  } finally {
    cleanup(dir);
  }
});

Deno.test("move renomeia uma entrada preservando o conteúdo", async () => {
  const { dir, provider } = tempProvider();
  try {
    await provider.create("a.md", "x");
    await provider.move!("a.md", "b.md");
    assertEquals(await provider.exists!("a.md"), false);
    assertEquals(await provider.read("b.md"), "x");
  } finally {
    cleanup(dir);
  }
});

Deno.test("exists reflete a presença de uma entrada", async () => {
  const { dir, provider } = tempProvider();
  try {
    assertEquals(await provider.exists!("a.md"), false);
    await provider.create("a.md", "x");
    assertEquals(await provider.exists!("a.md"), true);
  } finally {
    cleanup(dir);
  }
});

Deno.test("paths com .. são rejeitados (guarda contra path traversal)", async () => {
  const { dir, provider } = tempProvider();
  try {
    await assertRejects(() => provider.read("../outside.md"));
    await assertRejects(() => provider.create("../outside.md", "x"));
  } finally {
    cleanup(dir);
  }
});

Deno.test("paths absolutos são rejeitados", async () => {
  const { dir, provider } = tempProvider();
  try {
    await assertRejects(() => provider.read("/etc/passwd"));
  } finally {
    cleanup(dir);
  }
});

Deno.test("exists e list também rejeitam path inválido, não apenas retornam false/vazio", async () => {
  const { dir, provider } = tempProvider();
  try {
    await assertRejects(() => provider.exists!("../outside.md"));
    await assertRejects(() => provider.list("../outside"));
  } finally {
    cleanup(dir);
  }
});

Deno.test("search ignora entradas binárias ilegíveis como texto, sem lançar", async () => {
  const { dir, provider } = tempProvider();
  try {
    await provider.create("readable.md", "contém termo-alvo");
    // Bytes inválidos como UTF-8 simulam uma entrada binária (ex.: imagem num vault).
    Deno.writeFileSync(`${dir}/binary.bin`, new Uint8Array([0xff, 0xfe, 0x00, 0xff]));

    const results = await provider.search("termo-alvo");

    assertEquals(results.length, 1);
    assertEquals(results[0].path, "readable.md");
  } finally {
    cleanup(dir);
  }
});

// --- FilesystemKnowledgeProvider funciona independentemente de config.json ---

Deno.test("FilesystemKnowledgeProvider funciona sem nenhuma config de knowledge", async () => {
  const { dir, provider } = tempProvider();
  try {
    // Nenhuma referência a config.json é lida pelo provider: ele nunca depende de
    // `knowledge` estar presente ou habilitado.
    await provider.create("doc.md", "conteúdo");
    assertEquals(await provider.read("doc.md"), "conteúdo");
  } finally {
    cleanup(dir);
  }
});

// --- detectKnowledgeState: reportado na inicialização, nunca interrompe o workflow ---

Deno.test("detectKnowledgeState: config ausente -> Filesystem (default sempre funcional)", () => {
  assertEquals(detectKnowledgeState(undefined), { status: "filesystem", label: "✓ Filesystem" });
  assertEquals(detectKnowledgeState({}), { status: "filesystem", label: "✓ Filesystem" });
});

Deno.test("detectKnowledgeState: knowledge.enabled false -> Disabled", () => {
  assertEquals(
    detectKnowledgeState({ knowledge: { enabled: false } }),
    { status: "disabled", label: "○ Disabled" },
  );
});

Deno.test("detectKnowledgeState: knowledge ausente dentro do objeto -> Filesystem", () => {
  assertEquals(
    detectKnowledgeState({ knowledge: {} }),
    { status: "filesystem", label: "✓ Filesystem" },
  );
});

Deno.test("detectKnowledgeState: provider obsidian explícito -> Obsidian", () => {
  assertEquals(
    detectKnowledgeState({ knowledge: { enabled: true, provider: "obsidian" } }),
    { status: "obsidian", label: "✓ Obsidian" },
  );
});

Deno.test("detectKnowledgeState: provider filesystem explícito -> Filesystem", () => {
  assertEquals(
    detectKnowledgeState({ knowledge: { enabled: true, provider: "filesystem" } }),
    { status: "filesystem", label: "✓ Filesystem" },
  );
});

Deno.test("detectKnowledgeState: enabled false vence mesmo com provider setado", () => {
  assertEquals(
    detectKnowledgeState({ knowledge: { enabled: false, provider: "obsidian" } }),
    { status: "disabled", label: "○ Disabled" },
  );
});
