import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import {
  CAPABILITIES_BODY,
  END_MARKER,
  importsAgentsMd,
  injectBlock,
  START_MARKER,
} from "../inject-capabilities-doc.ts";

function tmpDir(): string {
  return Deno.makeTempDirSync();
}

Deno.test("insere o bloco no fim de um arquivo existente sem marcadores", () => {
  const dir = tmpDir();
  try {
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
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("é idempotente: rodar de novo atualiza o bloco existente sem duplicar", () => {
  const dir = tmpDir();
  try {
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
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("preserva conteúdo antes e depois do bloco ao atualizar", () => {
  const dir = tmpDir();
  try {
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
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("não cria o arquivo se ele não existir", () => {
  const dir = tmpDir();
  try {
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
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("importsAgentsMd detecta padrões válidos de importação de AGENTS.md", () => {
  assert(importsAgentsMd("@AGENTS.md"));
  assert(importsAgentsMd("@./AGENTS.md"));
  assert(importsAgentsMd("- @AGENTS.md"));
  assert(importsAgentsMd("# Projeto\n\n@AGENTS.md\n"));
  assert(importsAgentsMd("Linha antes\n  @./AGENTS.md\nLinha depois"));

  assertFalse(importsAgentsMd("# Projeto sem import"));
  assertFalse(importsAgentsMd("AGENTS.md mencionado sem arroba"));
  assertFalse(importsAgentsMd("@OTHER.md"));
});

Deno.test("pula injeção em CLAUDE.md quando importa AGENTS.md (issue #408)", () => {
  const dir = tmpDir();
  try {
    const claudePath = `${dir}/CLAUDE.md`;
    const agentsPath = `${dir}/AGENTS.md`;

    const originalClaude = "# Config\n\n@AGENTS.md\n\nInstruções locais.\n";
    Deno.writeTextFileSync(claudePath, originalClaude);
    Deno.writeTextFileSync(agentsPath, "# Instruções Compartilhadas\n");

    const claudeResult = injectBlock(claudePath, "BLOCO");
    assertEquals(claudeResult, "skipped_imports_agents");
    assertEquals(Deno.readTextFileSync(claudePath), originalClaude);

    const agentsResult = injectBlock(agentsPath, "BLOCO");
    assertEquals(agentsResult, "inserted");
    assertStringIncludes(Deno.readTextFileSync(agentsPath), "BLOCO");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("CAPABILITIES_BODY contém todas as skills ativas e nenhum comando deprecado (issue #407)", () => {
  // Comandos ativos esperados
  const requiredSkills = [
    "/vetor:install",
    "/vetor:now",
    "/vetor:spec",
    "/vetor:spec-validate",
    "/vetor:backlog",
    "/vetor:coordinator",
    "/vetor:worktree-create",
    "/vetor:fix",
    "/vetor:design",
    "/vetor:ship",
    "/vetor:guardian",
    "/vetor:stack-practices",
    "/vetor:architecture-review",
    "/vetor:retro",
  ];

  for (const skill of requiredSkills) {
    assertStringIncludes(
      CAPABILITIES_BODY,
      skill,
      `CAPABILITIES_BODY deve conter a skill ${skill}`,
    );
  }

  // Não deve conter o comando deprecado `/vetor` isolado como item de lista
  assertFalse(
    /- `\/vetor`\s/.test(CAPABILITIES_BODY),
    "CAPABILITIES_BODY não deve conter o comando deprecado `/vetor` isolado",
  );

  // guardian não deve ser descrito apenas como auditoria de banco de dados
  assertFalse(
    CAPABILITIES_BODY.includes("auditoria de banco de dados por stack"),
    "guardian deve refletir auditoria e auto-fix de integridade ampla",
  );
  assertStringIncludes(
    CAPABILITIES_BODY,
    "guardian",
  );
});
