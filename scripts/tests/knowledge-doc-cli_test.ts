// Exercita o CLI real documentado em skills/spec/SKILL.md (scripts/knowledge-doc.ts) via
// subprocesso — não uma reimplementação em memória (mesmo critério de guardian-check9_test.ts):
// o teste precisa rodar o comando que a skill efetivamente invoca, senão um bug de parsing de
// flags ou de output passaria despercebido.
//
// Cobre o critério de aceite 5 da issue #226: gerar uma Spec com Knowledge Provider filesystem
// e confirmar frontmatter válido + busca prévia por Specs relacionadas.

import { assertEquals, assertMatch } from "@std/assert";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../knowledge-doc.ts", import.meta.url));

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(
  args: string[],
  opts: { cwd?: string; stdin?: string } = {},
): Promise<RunResult> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", SCRIPT, ...args],
    cwd: opts.cwd,
    stdin: opts.stdin !== undefined ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
  });
  const child = command.spawn();
  if (opts.stdin !== undefined) {
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(opts.stdin));
    await writer.close();
  }
  const output = await child.output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

async function tempDir(): Promise<string> {
  return await Deno.realPath(await Deno.makeTempDir());
}

Deno.test("status: sem config.json usa default filesystem (sempre habilitado)", async () => {
  const dir = await tempDir();
  try {
    const result = await run(["status", "--config", `${dir}/config.json`]);
    assertEquals(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assertEquals(parsed, { enabled: true, status: "filesystem" });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("status: knowledge.enabled=false reporta desabilitado", async () => {
  const dir = await tempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/config.json`,
      JSON.stringify({ knowledge: { enabled: false } }),
    );
    const result = await run(["status", "--config", `${dir}/config.json`]);
    const parsed = JSON.parse(result.stdout);
    assertEquals(parsed, { enabled: false, status: "disabled" });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("search-specs sem nenhuma spec existente devolve array vazio — busca prévia", async () => {
  const dir = await tempDir();
  try {
    const result = await run(["search-specs", "authentication", "--root", dir]);
    assertEquals(result.code, 0);
    assertEquals(JSON.parse(result.stdout), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("create-spec grava frontmatter válido (type/project/status) e find localiza pela identidade", async () => {
  const dir = await tempDir();
  try {
    const created = await run(
      [
        "create-spec",
        "--slug",
        "authentication",
        "--project",
        "vetor",
        "--status",
        "draft",
        "--root",
        dir,
      ],
      { stdin: "# Authentication\n\nFluxo de autenticação." },
    );
    assertEquals(created.code, 0);
    const { identity, path } = JSON.parse(created.stdout);
    assertEquals(identity, "spec:authentication");
    assertEquals(path, "specs/authentication.md");

    const raw = await Deno.readTextFile(`${dir}/${path}`);
    assertMatch(raw, /id: spec:authentication/);
    assertMatch(raw, /type: spec/);
    assertMatch(raw, /project: vetor/);
    assertMatch(raw, /status: draft/);
    assertMatch(raw, /created: \d{4}-\d{2}-\d{2}/);

    const found = await run(["find", "spec:authentication", "--root", dir]);
    assertEquals(JSON.parse(found.stdout).path, "specs/authentication.md");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("create-spec com --link cria referência para o documento relacionado (ex.: ADR)", async () => {
  const dir = await tempDir();
  try {
    await Deno.mkdir(`${dir}/adr`, { recursive: true });
    await Deno.writeTextFile(`${dir}/adr/001-oauth.md`, "# ADR 001 - OAuth");

    const created = await run(
      [
        "create-spec",
        "--slug",
        "authentication",
        "--project",
        "vetor",
        "--status",
        "draft",
        "--root",
        dir,
        "--link",
        "adr/001-oauth.md",
      ],
      { stdin: "# Authentication" },
    );
    assertEquals(created.code, 0);

    const raw = await Deno.readTextFile(`${dir}/specs/authentication.md`);
    assertMatch(raw, /- Relacionado: adr\/001-oauth\.md/);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("create-spec com --link contendo o prefixo docs/ redundante ainda cria o link (issue de code-review)", async () => {
  const dir = await tempDir();
  try {
    await Deno.mkdir(`${dir}/docs/adr`, { recursive: true });
    await Deno.writeTextFile(`${dir}/docs/adr/001-oauth.md`, "# ADR 001 - OAuth");

    // Sem --root explícito (default "docs"), rodando com cwd=dir: mesma condição real de uso da
    // skill. Context Discovery (SKILL.md passo 1) reporta paths relativos à raiz do repo, ex.
    // "docs/adr/001-oauth.md" — sem a normalização, isso duplicava o prefixo ("docs/docs/...")
    // e o link sempre falhava, mesmo com a Spec já persistida com sucesso.
    const created = await run(
      [
        "create-spec",
        "--slug",
        "authentication",
        "--project",
        "vetor",
        "--link",
        "docs/adr/001-oauth.md",
      ],
      { cwd: dir, stdin: "# Authentication" },
    );
    assertEquals(created.code, 0, created.stderr);

    const raw = await Deno.readTextFile(`${dir}/docs/specs/authentication.md`);
    assertMatch(raw, /- Relacionado: adr\/001-oauth\.md/);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("create-spec com --link para destino inexistente: Spec fica persistida e o erro é reportado de forma clara (não crasha)", async () => {
  const dir = await tempDir();
  try {
    const created = await run(
      [
        "create-spec",
        "--slug",
        "authentication",
        "--project",
        "vetor",
        "--root",
        dir,
        "--link",
        "adr/inexistente.md",
      ],
      { stdin: "# Authentication" },
    );

    assertEquals(created.code, 1);
    assertMatch(created.stderr, /AVISO: Spec criada em/);
    assertEquals(JSON.parse(created.stdout).linkFailed, true);

    // A Spec foi persistida de verdade, apesar do link ter falhado — não é um erro total.
    const raw = await Deno.readTextFile(`${dir}/specs/authentication.md`);
    assertMatch(raw, /type: spec/);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("create-spec com --slug contendo caracteres reservados de filesystem é normalizado via slugify (nunca usado literalmente)", async () => {
  const dir = await tempDir();
  try {
    const created = await run(
      ["create-spec", "--slug", "a:b weird/slug!", "--project", "vetor", "--root", dir],
      { stdin: "# Teste" },
    );
    assertEquals(created.code, 0, created.stderr);
    const { identity, path } = JSON.parse(created.stdout);
    assertEquals(identity, "spec:a-b-weird-slug");
    assertEquals(path, "specs/a-b-weird-slug.md");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("create-spec falha com ERRO claro (não stack trace) quando a identidade já existe", async () => {
  const dir = await tempDir();
  try {
    const args = ["create-spec", "--slug", "dup", "--project", "vetor", "--root", dir];
    const first = await run(args, { stdin: "# Um" });
    assertEquals(first.code, 0);

    const second = await run(args, { stdin: "# Dois" });
    assertEquals(second.code, 1);
    assertMatch(second.stderr, /^ERRO: /);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("find com identidade malformada falha com ERRO claro (não stack trace)", async () => {
  const dir = await tempDir();
  try {
    const result = await run(["find", "sem-separador", "--root", dir]);
    assertEquals(result.code, 1);
    assertMatch(result.stderr, /^ERRO: /);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("update-spec preserva id/type/project/created e bump em updated (issue #219)", async () => {
  const dir = await tempDir();
  try {
    const created = await run(
      [
        "create-spec",
        "--slug",
        "checkout",
        "--project",
        "vetor",
        "--status",
        "draft",
        "--root",
        dir,
      ],
      { stdin: "# Checkout v1" },
    );
    assertEquals(created.code, 0);
    const before = await Deno.readTextFile(`${dir}/specs/checkout.md`);
    const createdDateMatch = before.match(/created: (\S+)/);
    assertMatch(before, /created: \d{4}-\d{2}-\d{2}/);

    const updated = await run(
      ["update-spec", "--slug", "checkout", "--root", dir],
      { stdin: "# Checkout v2" },
    );
    assertEquals(updated.code, 0, updated.stderr);
    const { identity, path } = JSON.parse(updated.stdout);
    assertEquals(identity, "spec:checkout");
    assertEquals(path, "specs/checkout.md");

    const after = await Deno.readTextFile(`${dir}/specs/checkout.md`);
    assertMatch(after, /id: spec:checkout/);
    assertMatch(after, /type: spec/);
    assertMatch(after, /project: vetor/);
    // status preservado (não resetado para draft/undefined) quando --status é omitido
    assertMatch(after, /status: draft/);
    // created nunca é substituído por um update — apenas `created` na criação é a verdade
    assertMatch(after, new RegExp(`created: ${createdDateMatch![1]}`));
    assertMatch(after, /# Checkout v2/);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("update-spec com --status altera o status explicitamente", async () => {
  const dir = await tempDir();
  try {
    await run(
      [
        "create-spec",
        "--slug",
        "checkout",
        "--project",
        "vetor",
        "--status",
        "draft",
        "--root",
        dir,
      ],
      { stdin: "# Checkout v1" },
    );
    const updated = await run(
      ["update-spec", "--slug", "checkout", "--root", dir, "--status", "approved"],
      { stdin: "# Checkout v2" },
    );
    assertEquals(updated.code, 0, updated.stderr);
    const after = await Deno.readTextFile(`${dir}/specs/checkout.md`);
    assertMatch(after, /status: approved/);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("update-spec falha com ERRO claro (não stack trace) quando a identidade não existe", async () => {
  const dir = await tempDir();
  try {
    const result = await run(
      ["update-spec", "--slug", "inexistente", "--root", dir],
      { stdin: "# Corpo" },
    );
    assertEquals(result.code, 1);
    assertMatch(result.stderr, /^ERRO: /);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("fluxo completo do critério de aceite: busca prévia vazia, depois cria e confirma frontmatter", async () => {
  const dir = await tempDir();
  try {
    const before = await run(["search-specs", "checkout", "--root", dir]);
    assertEquals(JSON.parse(before.stdout), []);

    await run(
      ["create-spec", "--slug", "checkout", "--project", "vetor", "--root", dir],
      { stdin: "# Checkout" },
    );

    const after = await run(["search-specs", "checkout", "--root", dir]);
    const results = JSON.parse(after.stdout);
    assertEquals(results.length, 1);
    assertEquals(results[0].path, "specs/checkout.md");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
