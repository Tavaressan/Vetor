// Camada de consumo do Knowledge Provider (issue #226): frontmatter, identidade estável e o
// padrão "consultar antes de agir". Consome `FilesystemKnowledgeProvider` (scripts/lib/knowledge.ts)
// sem alterar sua interface — ver scripts/lib/knowledge-docs.ts.

import { assertEquals, assertMatch, assertRejects } from "@std/assert";
import { FilesystemKnowledgeProvider } from "../lib/knowledge.ts";
import {
  buildFrontmatter,
  createDocument,
  docIdentity,
  findByIdentity,
  findRelatedSpecs,
  parseDocIdentity,
  parseFrontmatter,
  pathForIdentity,
  slugify,
  updateDocument,
} from "../lib/knowledge-docs.ts";

function tempProvider(): { dir: string; provider: FilesystemKnowledgeProvider } {
  const dir = Deno.makeTempDirSync();
  return { dir, provider: new FilesystemKnowledgeProvider(dir) };
}

function cleanup(dir: string) {
  Deno.removeSync(dir, { recursive: true });
}

// --- slugify ---

Deno.test("slugify normaliza tema livre em kebab-case sem acentos", () => {
  assertEquals(slugify("Autenticação de Usuários"), "autenticacao-de-usuarios");
  assertEquals(slugify("  espaços   extras  "), "espacos-extras");
});

// --- identidade ---

Deno.test("docIdentity/parseDocIdentity fazem round-trip", () => {
  assertEquals(docIdentity("spec", "authentication"), "spec:authentication");
  assertEquals(parseDocIdentity("spec:authentication"), { type: "spec", slug: "authentication" });
  assertEquals(parseDocIdentity("adr:001"), { type: "adr", slug: "001" });
});

Deno.test("parseDocIdentity devolve null para identidade sem separador ou incompleta", () => {
  assertEquals(parseDocIdentity("sempartes"), null);
  assertEquals(parseDocIdentity("spec:"), null);
  assertEquals(parseDocIdentity(":slug"), null);
});

Deno.test("pathForIdentity deriva o path canônico a partir do tipo", () => {
  assertEquals(pathForIdentity("spec:authentication"), "specs/authentication.md");
  assertEquals(pathForIdentity("adr:001"), "adr/001.md");
});

Deno.test("pathForIdentity lança para identidade inválida", () => {
  try {
    pathForIdentity("invalido");
    throw new Error("deveria ter lançado");
  } catch (err) {
    assertMatch((err as Error).message, /identidade de documento inválida/i);
  }
});

// --- frontmatter ---

Deno.test("buildFrontmatter/parseFrontmatter fazem round-trip com type/project/status", () => {
  const raw = buildFrontmatter({
    id: "spec:authentication",
    type: "spec",
    project: "vetor",
    status: "draft",
    created: "2026-09-16",
    updated: "2026-09-16",
  });
  const { frontmatter, body } = parseFrontmatter(`${raw}# Authentication\n\nConteúdo.`);
  assertEquals(frontmatter.id, "spec:authentication");
  assertEquals(frontmatter.type, "spec");
  assertEquals(frontmatter.project, "vetor");
  assertEquals(frontmatter.status, "draft");
  assertEquals(body.trim(), "# Authentication\n\nConteúdo.".trim());
});

Deno.test("parseFrontmatter em conteúdo sem frontmatter devolve objeto vazio e o corpo intacto", () => {
  const { frontmatter, body } = parseFrontmatter("# Sem frontmatter");
  assertEquals(frontmatter, {});
  assertEquals(body, "# Sem frontmatter");
});

// --- createDocument ---

Deno.test("createDocument grava frontmatter válido (type/project/status/datas) e identidade estável", async () => {
  const { dir, provider } = tempProvider();
  try {
    const { identity, path } = await createDocument(provider, {
      type: "spec",
      slug: "authentication",
      project: "vetor",
      status: "draft",
      body: "# Authentication\n\nConteúdo da spec.",
    });
    assertEquals(identity, "spec:authentication");
    assertEquals(path, "specs/authentication.md");

    const raw = await provider.read(path);
    const { frontmatter, body } = parseFrontmatter(raw);
    assertEquals(frontmatter.id, identity);
    assertEquals(frontmatter.type, "spec");
    assertEquals(frontmatter.project, "vetor");
    assertEquals(frontmatter.status, "draft");
    assertMatch(frontmatter.created, /^\d{4}-\d{2}-\d{2}$/);
    assertMatch(frontmatter.updated, /^\d{4}-\d{2}-\d{2}$/);
    assertEquals(body.trim(), "# Authentication\n\nConteúdo da spec.".trim());
  } finally {
    cleanup(dir);
  }
});

Deno.test("createDocument lança se já existir uma entrada na mesma identidade — nunca sobrescreve", async () => {
  const { dir, provider } = tempProvider();
  try {
    await createDocument(provider, {
      type: "spec",
      slug: "authentication",
      project: "vetor",
      status: "draft",
      body: "# v1",
    });
    await assertRejects(() =>
      createDocument(provider, {
        type: "spec",
        slug: "authentication",
        project: "vetor",
        status: "draft",
        body: "# v2",
      })
    );
  } finally {
    cleanup(dir);
  }
});

// --- updateDocument ---

Deno.test("updateDocument preserva id/type/project/created e avança updated (issue #219)", async () => {
  const { dir, provider } = tempProvider();
  try {
    await createDocument(provider, {
      type: "spec",
      slug: "authentication",
      project: "vetor",
      status: "draft",
      body: "# v1",
    });
    const rawBefore = await provider.read("specs/authentication.md");
    const createdBefore = parseFrontmatter(rawBefore).frontmatter.created;

    const { identity, path } = await updateDocument(provider, {
      type: "spec",
      slug: "authentication",
      body: "# v2",
    });
    assertEquals(identity, "spec:authentication");
    assertEquals(path, "specs/authentication.md");

    const raw = await provider.read(path);
    const { frontmatter, body } = parseFrontmatter(raw);
    assertEquals(frontmatter.id, "spec:authentication");
    assertEquals(frontmatter.type, "spec");
    assertEquals(frontmatter.project, "vetor");
    assertEquals(frontmatter.status, "draft"); // status preservado quando não informado
    assertEquals(frontmatter.created, createdBefore); // created nunca é sobrescrito por update
    assertMatch(frontmatter.updated, /^\d{4}-\d{2}-\d{2}$/);
    assertEquals(body.trim(), "# v2");
  } finally {
    cleanup(dir);
  }
});

Deno.test("updateDocument com status explícito sobrescreve o status atual", async () => {
  const { dir, provider } = tempProvider();
  try {
    await createDocument(provider, {
      type: "spec",
      slug: "authentication",
      project: "vetor",
      status: "draft",
      body: "# v1",
    });
    await updateDocument(provider, {
      type: "spec",
      slug: "authentication",
      status: "approved",
      body: "# v2",
    });
    const { frontmatter } = parseFrontmatter(await provider.read("specs/authentication.md"));
    assertEquals(frontmatter.status, "approved");
  } finally {
    cleanup(dir);
  }
});

Deno.test("updateDocument lança quando a identidade não existe — nunca cria por engano", async () => {
  const { dir, provider } = tempProvider();
  try {
    await assertRejects(() =>
      updateDocument(provider, { type: "spec", slug: "nao-existe", body: "# v1" })
    );
  } finally {
    cleanup(dir);
  }
});

// --- findByIdentity ---

Deno.test("findByIdentity localiza documento pela identidade estável", async () => {
  const { dir, provider } = tempProvider();
  try {
    await createDocument(provider, {
      type: "spec",
      slug: "authentication",
      project: "vetor",
      status: "draft",
      body: "# Authentication",
    });
    const found = await findByIdentity(provider, "spec:authentication");
    assertEquals(found?.path, "specs/authentication.md");
  } finally {
    cleanup(dir);
  }
});

Deno.test("findByIdentity devolve null quando a identidade não existe", async () => {
  const { dir, provider } = tempProvider();
  try {
    const found = await findByIdentity(provider, "spec:nao-existe");
    assertEquals(found, null);
  } finally {
    cleanup(dir);
  }
});

// --- findRelatedSpecs ---

Deno.test("findRelatedSpecs busca apenas sob specs/, ignorando outros tipos de documento", async () => {
  const { dir, provider } = tempProvider();
  try {
    await createDocument(provider, {
      type: "spec",
      slug: "authentication",
      project: "vetor",
      status: "draft",
      body: "# Authentication flow",
    });
    await createDocument(provider, {
      type: "adr",
      slug: "001",
      project: "vetor",
      status: "active",
      body: "# ADR sobre authentication",
    });

    const results = await findRelatedSpecs(provider, "authentication");
    assertEquals(results.length, 1);
    assertEquals(results[0].path, "specs/authentication.md");
  } finally {
    cleanup(dir);
  }
});

Deno.test("findRelatedSpecs sem nenhuma spec existente devolve array vazio — busca prévia por specs relacionadas", async () => {
  const { dir, provider } = tempProvider();
  try {
    const results = await findRelatedSpecs(provider, "authentication");
    assertEquals(results, []);
  } finally {
    cleanup(dir);
  }
});
