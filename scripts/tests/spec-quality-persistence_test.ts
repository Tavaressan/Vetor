// Testes de scripts/lib/spec-quality-persistence.ts — persistência do estado de validação
// separado do conteúdo da Spec (#222, #203 §12).

import { assertEquals } from "@std/assert";
import {
  loadValidationState,
  resolveDefaultHistoryPath,
  saveValidationState,
  validationPathFor,
} from "../lib/spec-quality-persistence.ts";

async function git(args: string[], cwd: string): Promise<void> {
  const { code, stderr } = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  })
    .output();
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} falhou: ${new TextDecoder().decode(stderr)}`);
  }
}

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

Deno.test("resolveDefaultHistoryPath resolve a partir da raiz do repositório git, não do cwd (#222 fix)", async () => {
  const repoRoot = await Deno.makeTempDir();
  const subdir = `${repoRoot}/nested/dir`;
  try {
    await git(["init", "-q"], repoRoot);
    await Deno.mkdir(subdir, { recursive: true });

    const fromRoot = await resolveDefaultHistoryPath("docs/specs/authentication.md", repoRoot);
    const fromSubdir = await resolveDefaultHistoryPath("docs/specs/authentication.md", subdir);

    const expected = `${
      repoRoot.replaceAll("\\", "/")
    }/.claude/vetor/specs/authentication.validation.json`;
    assertEquals(fromRoot, expected);
    // A mesma Spec, resolvida a partir de um subdiretório do mesmo checkout, aponta para o mesmo
    // arquivo de histórico — sem isso, duas invocações do CLI em cwds diferentes do mesmo
    // repositório perderiam a continuidade do refinamento iterativo.
    assertEquals(fromSubdir, expected);
  } finally {
    await Deno.remove(repoRoot, { recursive: true });
  }
});

Deno.test("resolveDefaultHistoryPath cai no path relativo quando cwd não é um repositório git", async () => {
  const tmpDir = await Deno.makeTempDir();
  try {
    const resolved = await resolveDefaultHistoryPath("docs/specs/authentication.md", tmpDir);
    assertEquals(resolved, ".claude/vetor/specs/authentication.validation.json");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
