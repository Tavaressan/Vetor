// Exercita a CLI real scripts/draft-scan.ts via subprocesso (mesmo critério de
// knowledge-doc-cli_test.ts): o que importa é o código de saída e a saída que o coordinator
// recebe, não só a biblioteca. Fixtures por sequências de escape na forma \u{...}, porque o
// `deno fmt` converte \uXXXX de volta no caractere literal.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../draft-scan.ts", import.meta.url));

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(
  args: string[],
  cwd?: string,
  env: Record<string, string> = {},
): Promise<RunResult> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", SCRIPT, ...args],
    cwd,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  const output = await new Deno.Command("git", {
    args: [
      "-c",
      "core.autocrlf=false",
      "-c",
      "user.name=teste",
      "-c",
      "user.email=t@t.test",
      ...args,
    ],
    cwd,
    stdout: "null",
    stderr: "piped",
  }).output();
  assert(output.success, `git ${args.join(" ")}: ${new TextDecoder().decode(output.stderr)}`);
}

async function withTempDir(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "draft-scan-" });
  try {
    await body(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

const documented = `/**
 * Soma dois números.
 */
export function add(a: number, b: number) {
  return a + b;
}
`;

Deno.test("draft-scan: arquivos limpos saem com zero", async () => {
  await withTempDir(async (dir) => {
    const ts = `${dir}/limpo.ts`;
    const md = `${dir}/limpo.md`;
    await Deno.writeTextFile(ts, documented);
    await Deno.writeTextFile(md, "# ação\n\nTexto com acentos: não é você.\n");

    const result = await run([ts, md]);
    assertEquals(result.code, 0, result.stdout + result.stderr);
    assertStringIncludes(result.stdout, "2 arquivo(s) escaneado(s), nenhum achado.");
    assertEquals(result.stderr, "");
  });
});

Deno.test("draft-scan: achados saem não-zero citando arquivo e linha de cada um", async () => {
  await withTempDir(async (dir) => {
    const bom = `${dir}/bom.ts`;
    const mojibake = `${dir}/doc.md`;
    const shell = `${dir}/setup.sh`;
    await Deno.writeTextFile(bom, "\u{feff}export const x = 1;\n");
    await Deno.writeTextFile(mojibake, "linha limpa\nlinha com \u{c3}\u{a9} quebrado\n");
    await Deno.writeTextFile(shell, "#!/bin/bash\ndeclare -A MAPA\n");

    const result = await run([bom, mojibake, shell]);
    assertEquals(result.code, 1, result.stdout + result.stderr);
    assertStringIncludes(result.stdout, `${bom}:1: [bom]`);
    assertStringIncludes(result.stdout, `${mojibake}:2: [mojibake]`);
    assertStringIncludes(result.stdout, `${shell}:2: [bash-declare-assoc]`);
    assertStringIncludes(result.stdout, "3 achado(s).");
  });
});

Deno.test("draft-scan: UTF-8 inválido é achado, não erro e muito menos limpo", async () => {
  await withTempDir(async (dir) => {
    const file = `${dir}/quebrado.ts`;
    await Deno.writeFile(file, new Uint8Array([0x61, 0x0a, 0x62, 0xff, 0x0a]));

    const result = await run([file]);
    assertEquals(result.code, 1, result.stdout + result.stderr);
    assertStringIncludes(result.stdout, `${file}:2: [invalid-utf8]`);
  });
});

Deno.test("draft-scan: arquivo inexistente é falha interna com diagnóstico, nunca limpo", async () => {
  await withTempDir(async (dir) => {
    const result = await run([`${dir}/nao-existe.ts`]);
    assertEquals(result.code, 2);
    assertStringIncludes(result.stderr, "draft-scan: falha interna:");
    assertEquals(result.stdout.includes("nenhum achado"), false);
  });
});

Deno.test("draft-scan: uso incorreto sai com 2 e mostra o uso", async () => {
  for (const args of [[], ["--base"], ["--base", "a", "b"], ["--base", "--help"], ["--outra"]]) {
    const result = await run(args);
    assertEquals(result.code, 2, args.join(" "));
    assertStringIncludes(result.stderr, "uso: draft-scan.ts");
  }
});

Deno.test("draft-scan --base: varre alterados e novos, compara JSDoc e lista o que ignorou", async () => {
  await withTempDir(async (dir) => {
    await git(dir, "init", "-q");
    await Deno.writeTextFile(`${dir}/src.ts`, documented);
    await Deno.writeTextFile(`${dir}/lido.md`, "texto\n");
    await Deno.writeTextFile(`${dir}/apagado.ts`, "export const z = 1;\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "base");

    // Alterado (JSDoc removido), removido, novo não rastreado com BOM e binário
    await Deno.writeTextFile(`${dir}/src.ts`, documented.replace(/\/\*\*[\s\S]*?\*\/\n/, ""));
    await Deno.remove(`${dir}/apagado.ts`);
    await Deno.writeTextFile(`${dir}/novo.md`, "\u{feff}# novo\n");
    await Deno.writeFile(`${dir}/imagem.png`, new Uint8Array([0x89, 0x50, 0xff, 0xfe]));

    const result = await run(["--base", "HEAD"], dir);
    assertEquals(result.code, 1, result.stdout + result.stderr);
    assertStringIncludes(result.stdout, "src.ts:1: [stripped-jsdoc]");
    assertStringIncludes(result.stdout, "novo.md:1: [bom]");
    assertStringIncludes(result.stdout, "ignorado (extensão fora da lista de texto): imagem.png");
    assertEquals(result.stdout.includes("apagado.ts"), false);
    assertEquals(result.stdout.includes("lido.md"), false);
    assertStringIncludes(result.stdout, "2 arquivo(s) escaneado(s), 2 achado(s).");
  });
});

Deno.test("draft-scan --base: alterações limpas saem com zero, inclusive JSDoc reescrito", async () => {
  await withTempDir(async (dir) => {
    await git(dir, "init", "-q");
    await Deno.writeTextFile(`${dir}/src.ts`, documented);
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "base");

    await Deno.writeTextFile(`${dir}/src.ts`, documented.replace("Soma dois", "Adiciona dois"));
    await Deno.writeTextFile(`${dir}/novo.ts`, "export const ok = true;\n");

    const result = await run(["--base", "HEAD"], dir);
    assertEquals(result.code, 0, result.stdout + result.stderr);
    assertStringIncludes(result.stdout, "2 arquivo(s) escaneado(s), nenhum achado.");
  });
});

Deno.test("draft-scan --base: compara com uma base anterior ao commit do worker", async () => {
  await withTempDir(async (dir) => {
    await git(dir, "init", "-q");
    await Deno.writeTextFile(`${dir}/src.ts`, documented);
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "base");
    await Deno.writeTextFile(`${dir}/src.ts`, "export function add() {}\n");
    await git(dir, "commit", "-q", "-am", "worker remove o JSDoc");

    const fromBase = await run(["--base", "HEAD~1"], dir);
    assertEquals(fromBase.code, 1, fromBase.stdout + fromBase.stderr);
    assertStringIncludes(fromBase.stdout, "src.ts:1: [stripped-jsdoc]");

    const fromHead = await run(["--base", "HEAD"], dir);
    assertEquals(fromHead.code, 0, fromHead.stdout + fromHead.stderr);
  });
});

Deno.test("draft-scan --base: ref inválida e diretório fora de um repositório são falha interna", async () => {
  await withTempDir(async (dir) => {
    // O teto impede o git de achar um repositório acima do diretório temporário
    const ceiling = dir.replaceAll("\\", "/").replace(/\/[^/]+$/, "");
    const outside = await run(["--base", "HEAD"], dir, { GIT_CEILING_DIRECTORIES: ceiling });
    assertEquals(outside.code, 2);
    assertStringIncludes(outside.stderr, "draft-scan: falha interna:");

    await git(dir, "init", "-q");
    await Deno.writeTextFile(`${dir}/a.ts`, "export const a = 1;\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-q", "-m", "base");

    const invalidRef = await run(["--base", "ref-que-nao-existe"], dir);
    assertEquals(invalidRef.code, 2);
    assertStringIncludes(invalidRef.stderr, "base inválida: 'ref-que-nao-existe'");
    assertEquals(invalidRef.stdout.includes("nenhum achado"), false);
  });
});
