import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { END_MARKER, injectBlock, START_MARKER } from "./inject-capabilities-doc.ts";

function tmpDir(): string {
  return Deno.makeTempDirSync();
}

Deno.test("insere o bloco no fim de um arquivo existente sem marcadores", () => {
  const dir = tmpDir();
  const path = `${dir}/CLAUDE.md`;
  Deno.writeTextFileSync(path, "# Projeto X\n\nAlgumas instruções existentes.\n");

  const result = injectBlock(path, "CONTEUDO_DO_BLOCO");

  assertEquals(result, "inserted");
  const content = Deno.readTextFileSync(path);
  assertStringIncludes(content, "Algumas instruções existentes.");
  assertStringIncludes(content, START_MARKER);
  assertStringIncludes(content, "CONTEUDO_DO_BLOCO");
  assertStringIncludes(content, END_MARKER);
  // Marcadores aparecem exatamente uma vez cada
  assertEquals(content.split(START_MARKER).length - 1, 1);
  assertEquals(content.split(END_MARKER).length - 1, 1);
});

Deno.test("é idempotente: rodar de novo atualiza o bloco existente sem duplicar", () => {
  const dir = tmpDir();
  const path = `${dir}/CLAUDE.md`;
  Deno.writeTextFileSync(path, "# Projeto X\n\nInstruções.\n");

  injectBlock(path, "VERSAO_1");
  const result = injectBlock(path, "VERSAO_2");

  assertEquals(result, "updated");
  const content = Deno.readTextFileSync(path);
  assertStringIncludes(content, "VERSAO_2");
  assert(!content.includes("VERSAO_1"), "conteúdo antigo não deve sobrar");
  assertEquals(content.split(START_MARKER).length - 1, 1);
  assertEquals(content.split(END_MARKER).length - 1, 1);
  assertStringIncludes(content, "Instruções.");
});

Deno.test("preserva conteúdo antes e depois do bloco ao atualizar", () => {
  const dir = tmpDir();
  const path = `${dir}/CLAUDE.md`;
  Deno.writeTextFileSync(
    path,
    `# Antes\n\n${START_MARKER}\nBLOCO_ANTIGO\n${END_MARKER}\n\n# Depois\nConteúdo pós-bloco.\n`,
  );

  injectBlock(path, "BLOCO_NOVO");

  const content = Deno.readTextFileSync(path);
  assertStringIncludes(content, "# Antes");
  assertStringIncludes(content, "# Depois");
  assertStringIncludes(content, "Conteúdo pós-bloco.");
  assertStringIncludes(content, "BLOCO_NOVO");
  assert(!content.includes("BLOCO_ANTIGO"));
});

Deno.test("não cria o arquivo se ele não existir", () => {
  const dir = tmpDir();
  const path = `${dir}/CLAUDE.md`;

  const result = injectBlock(path, "CONTEUDO");

  assertEquals(result, "skipped_missing_file");
  assertEquals(
    (() => {
      try {
        Deno.statSync(path);
        return true;
      } catch {
        return false;
      }
    })(),
    false,
  );
});
