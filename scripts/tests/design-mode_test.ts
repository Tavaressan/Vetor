import { assertEquals, assertNotEquals } from "@std/assert";
import {
  DESIGN_DIRECTION_DIR,
  DESIGN_SYSTEM_DIR,
  detectDesignSystemEvidence,
  detectOperationMode,
  PROTOTYPE_DIR,
  renderDesignDirectionFile,
  renderDesignSystemFiles,
  writeDesignFiles,
} from "../lib/design-mode.ts";

function tempDir(): string {
  return Deno.makeTempDirSync();
}

function cleanup(dir: string) {
  try {
    Deno.removeSync(dir, { recursive: true });
  } catch { /* já removido */ }
}

Deno.test("sem tokens/componentes/prototype, o modo é vetor-first", () => {
  const dir = tempDir();
  try {
    const result = detectOperationMode(dir);
    assertEquals(result.mode, "vetor-first");
    assertEquals(result.hasPrototype, false);
    assertEquals(result.evidence, []);
  } finally {
    cleanup(dir);
  }
});

Deno.test("tailwind.config.js + components/ sem prototype: modo é system-first", () => {
  const dir = tempDir();
  try {
    Deno.writeTextFileSync(`${dir}/tailwind.config.js`, "module.exports = { theme: {} };");
    Deno.mkdirSync(`${dir}/components`);

    const result = detectOperationMode(dir);

    assertEquals(result.mode, "system-first");
    assertEquals(result.hasPrototype, false);
    assertEquals(
      result.evidence.some((e) => e.relPath === "tailwind.config.js" && e.kind === "tokens-config"),
      true,
    );
    assertEquals(
      result.evidence.some((e) => e.relPath === "components" && e.kind === "components-dir"),
      true,
    );
  } finally {
    cleanup(dir);
  }
});

Deno.test(`${PROTOTYPE_DIR} presente: modo é prototype-first mesmo com Design System`, () => {
  const dir = tempDir();
  try {
    Deno.mkdirSync(`${dir}/${PROTOTYPE_DIR}`, { recursive: true });
    Deno.writeTextFileSync(`${dir}/tailwind.config.js`, "module.exports = {};");

    const result = detectOperationMode(dir);

    assertEquals(result.mode, "prototype-first");
    assertEquals(result.hasPrototype, true);
  } finally {
    cleanup(dir);
  }
});

Deno.test("package.json com dependência de Design System (tailwindcss) é detectado", () => {
  const dir = tempDir();
  try {
    Deno.writeTextFileSync(
      `${dir}/package.json`,
      JSON.stringify({ devDependencies: { tailwindcss: "^3.4.1" } }),
    );

    const evidence = detectDesignSystemEvidence(dir);

    assertEquals(
      evidence.some((e) =>
        e.kind === "package-dep" && e.relPath === "package.json" && e.detail?.includes("3.4.1")
      ),
      true,
    );
  } finally {
    cleanup(dir);
  }
});

Deno.test("Design System Import referencia o arquivo original em vez de copiar os tokens", () => {
  const dir = tempDir();
  try {
    Deno.writeTextFileSync(
      `${dir}/tailwind.config.js`,
      'module.exports = { theme: { colors: { primary: "#ABCDEF" } } };',
    );
    Deno.mkdirSync(`${dir}/components`);

    const { evidence } = detectOperationMode(dir);
    const files = renderDesignSystemFiles(evidence);
    const { written } = writeDesignFiles(dir, files);

    assertEquals(written.includes(`${DESIGN_SYSTEM_DIR}/tokens.md`), true);
    assertEquals(written.includes(`${DESIGN_SYSTEM_DIR}/components.md`), true);

    const tokensContent = Deno.readTextFileSync(`${dir}/${DESIGN_SYSTEM_DIR}/tokens.md`);
    assertEquals(tokensContent.includes("tailwind.config.js"), true);
    assertEquals(tokensContent.includes("authority: project"), true);
    // A asserção negativa é o que garante que é referência, não cópia.
    assertEquals(tokensContent.includes("#ABCDEF"), false);

    const componentsContent = Deno.readTextFileSync(`${dir}/${DESIGN_SYSTEM_DIR}/components.md`);
    assertEquals(componentsContent.includes("components"), true);
  } finally {
    cleanup(dir);
  }
});

Deno.test("Design System Import sem evidência de tokens ainda gera patterns.md e evidence.md", () => {
  const dir = tempDir();
  try {
    Deno.mkdirSync(`${dir}/components`);

    const { evidence } = detectOperationMode(dir);
    const files = renderDesignSystemFiles(evidence);
    const { written } = writeDesignFiles(dir, files);

    assertEquals(written.includes(`${DESIGN_SYSTEM_DIR}/patterns.md`), true);
    assertEquals(written.includes(`${DESIGN_SYSTEM_DIR}/evidence.md`), true);

    const patterns = Deno.readTextFileSync(`${dir}/${DESIGN_SYSTEM_DIR}/patterns.md`);
    assertEquals(patterns.includes("OPEN_QUESTION"), true);
  } finally {
    cleanup(dir);
  }
});

Deno.test("writeDesignFiles nunca sobrescreve um arquivo já existente (preserva edição humana)", () => {
  const dir = tempDir();
  try {
    Deno.writeTextFileSync(`${dir}/tailwind.config.js`, "module.exports = {};");
    Deno.mkdirSync(`${dir}/components`);

    const { evidence } = detectOperationMode(dir);
    const files = renderDesignSystemFiles(evidence);

    const first = writeDesignFiles(dir, files);
    assertEquals(first.skipped, []);

    const tokensPath = `${dir}/${DESIGN_SYSTEM_DIR}/tokens.md`;
    Deno.writeTextFileSync(tokensPath, "# editado manualmente\n");

    const second = writeDesignFiles(dir, files);
    assertEquals(second.written.includes(`${DESIGN_SYSTEM_DIR}/tokens.md`), false);
    assertEquals(second.skipped.includes(`${DESIGN_SYSTEM_DIR}/tokens.md`), true);
    assertEquals(Deno.readTextFileSync(tokensPath), "# editado manualmente\n");
  } finally {
    cleanup(dir);
  }
});

Deno.test("Design Direction: cria .vetor/design/direction/product.md com a estrutura especificada", () => {
  const dir = tempDir();
  try {
    const file = renderDesignDirectionFile();
    const { written } = writeDesignFiles(dir, [file]);

    assertEquals(written, [`${DESIGN_DIRECTION_DIR}/product.md`]);

    const content = Deno.readTextFileSync(`${dir}/${DESIGN_DIRECTION_DIR}/product.md`);
    for (
      const section of [
        "Product",
        "Audience",
        "Primary job",
        "Visual personality",
        "Density",
        "Typography",
        "Palette",
        "Layout",
        "Design Signature",
        "Motion",
        "Avoid",
      ]
    ) {
      assertEquals(content.includes(`## ${section}`), true, `esperava seção ## ${section}`);
    }
    assertEquals(content.includes("DEFAULT"), true);
    assertEquals(content.includes("FORBIDDEN"), true);
  } finally {
    cleanup(dir);
  }
});

Deno.test("Design Direction é atualizável: segunda chamada preserva edição humana", () => {
  const dir = tempDir();
  try {
    const file = renderDesignDirectionFile();
    writeDesignFiles(dir, [file]);

    const path = `${dir}/${DESIGN_DIRECTION_DIR}/product.md`;
    Deno.writeTextFileSync(path, "# Design Direction\n\n## Product\nApp de finanças pessoais.\n");

    const second = writeDesignFiles(dir, [file]);
    assertEquals(second.written, []);
    assertNotEquals(Deno.readTextFileSync(path), file.content);
  } finally {
    cleanup(dir);
  }
});
