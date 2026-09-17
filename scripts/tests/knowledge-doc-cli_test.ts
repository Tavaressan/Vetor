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
