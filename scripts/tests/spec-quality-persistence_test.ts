// Testes de scripts/lib/spec-quality-persistence.ts — persistência do estado de validação
// separado do conteúdo da Spec (#222, #203 §12).

import { assertEquals } from "@std/assert";
import {
  loadValidationState,
  saveValidationState,
  validationPathFor,
} from "../lib/spec-quality-persistence.ts";

Deno.test("validationPathFor deriva o path de persistência a partir do path da Spec (função pura)", () => {
  assertEquals(
    validationPathFor("docs/specs/authentication.md"),
    ".claude/vetor/specs/authentication.validation.json",
  );
  assertEquals(
    validationPathFor("docs/specs/authentication.md", ".claude/vetor/specs"),
    ".claude/vetor/specs/authentication.validation.json",
  );
});

Deno.test("validationPathFor normaliza separadores de path (Windows/POSIX)", () => {
  assertEquals(
    validationPathFor("docs\\specs\\authentication.md"),
    ".claude/vetor/specs/authentication.validation.json",
  );
});

Deno.test("loadValidationState devolve null quando o arquivo não existe", async () => {
  const state = await loadValidationState("caminho/que/nao/existe.validation.json");
  assertEquals(state, null);
});

Deno.test("saveValidationState + loadValidationState fazem round-trip do histórico", async () => {
  const tmpDir = await Deno.makeTempDir();
  const path = `${tmpDir}/authentication.validation.json`;
  try {
    await saveValidationState(path, {
      specPath: "docs/specs/authentication.md",
      history: [{ timestamp: "t1", score: 54, gate: "INCOMPLETE" }],
    });
    const loaded = await loadValidationState(path);
    assertEquals(loaded?.specPath, "docs/specs/authentication.md");
    assertEquals(loaded?.history.length, 1);
    assertEquals(loaded?.history[0].score, 54);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("saveValidationState cria diretórios intermediários quando não existem", async () => {
  const tmpDir = await Deno.makeTempDir();
  const path = `${tmpDir}/nested/dir/authentication.validation.json`;
  try {
    await saveValidationState(path, {
      specPath: "docs/specs/authentication.md",
      history: [],
    });
    const loaded = await loadValidationState(path);
    assertEquals(loaded?.specPath, "docs/specs/authentication.md");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
