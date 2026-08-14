import { assertEquals } from "@std/assert";
import { findDivergences, parseTranscript } from "./transcript.ts";

/** Monta um transcript .jsonl a partir de blocos de mensagem já prontos. */
function jsonl(...lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

/**
 * Executa `fn` com o home do usuário fixado, já que a exclusão de `~/.claude/**` é ancorada nele.
 * Restaura o valor original (ou a ausência dele) ao final.
 */
function withHome<T>(home: string, fn: () => T): T {
  const prevHome = Deno.env.get("HOME");
  const prevProfile = Deno.env.get("USERPROFILE");
  Deno.env.set("HOME", home);
  Deno.env.delete("USERPROFILE");
  try {
    return fn();
  } finally {
    prevHome === undefined ? Deno.env.delete("HOME") : Deno.env.set("HOME", prevHome);
    if (prevProfile !== undefined) Deno.env.set("USERPROFILE", prevProfile);
  }
}

function editToolUse(id: string, filePath: string, newString: string) {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id,
          name: "Edit",
          input: { file_path: filePath, old_string: "a", new_string: newString },
        },
      ],
    },
  };
}

function writeToolUse(id: string, filePath: string, content: string) {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        { type: "tool_use", id, name: "Write", input: { file_path: filePath, content } },
      ],
    },
  };
}

function toolResult(id: string, isError = false) {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, is_error: isError }],
    },
  };
}

Deno.test("parseTranscript: edição sem tool_result fica marcada como incompleta", () => {
  const raw = jsonl(editToolUse("t1", "/repo/a.ts", "novo conteudo"));
  const { edits } = parseTranscript(raw);

  assertEquals(edits.length, 1);
  assertEquals(edits[0].filePath, "/repo/a.ts");
  assertEquals(edits[0].incomplete, true);
});

Deno.test("parseTranscript: edição rejeitada (is_error) é descartada", () => {
  const raw = jsonl(editToolUse("t1", "/repo/a.ts", "novo conteudo"), toolResult("t1", true));
  const { edits } = parseTranscript(raw);

  assertEquals(edits.length, 0);
});

Deno.test("parseTranscript: só a última edição por arquivo é mantida", () => {
  const raw = jsonl(
    writeToolUse("t1", "/repo/a.ts", "primeira versao"),
    toolResult("t1"),
    writeToolUse("t2", "/repo/a.ts", "versao final"),
    toolResult("t2"),
  );
  const { edits } = parseTranscript(raw);

  assertEquals(edits.length, 1);
  assertEquals(edits[0].expected, "versao final");
});

Deno.test("findDivergences: edição não persistida em disco é reportada", () => {
  const raw = jsonl(editToolUse("t1", "/repo/a.ts", "linha nova"));
  const { edits } = parseTranscript(raw);

  const divergences = findDivergences(edits, (path) => {
    assertEquals(path, "/repo/a.ts");
    return "conteudo antigo sem a mudanca esperada";
  }, "/repo");

  assertEquals(divergences.length, 1);
  assertEquals(divergences[0].filePath, "/repo/a.ts");
});

Deno.test("findDivergences: sem divergência, nada é reportado", () => {
  const raw = jsonl(
    editToolUse("t1", "/repo/a.ts", "linha nova"),
    toolResult("t1"),
  );
  const { edits } = parseTranscript(raw);

  const divergences = findDivergences(edits, () => "conteudo com a linha nova aplicada");

  assertEquals(divergences.length, 0);
});

Deno.test("findDivergences: arquivo ausente em disco é reportado", () => {
  const raw = jsonl(writeToolUse("t1", "/repo/novo.ts", "conteudo"), toolResult("t1"));
  const { edits } = parseTranscript(raw);

  const divergences = findDivergences(edits, () => null, "/repo");

  assertEquals(divergences.length, 1);
  assertEquals(divergences[0].reason, "arquivo não encontrado em disco");
});

Deno.test("findDivergences: arquivo fora do repo mutado por processo externo (issue #87) não é reportado", () => {
  // Edit aplicado com sucesso a um arquivo de memória fora do repositório (ex.: ~/.claude/**);
  // o subsistema de memória reescreve o campo `modified:` depois, então o disco não contém
  // mais o `new_string` exato — mas isso não é trabalho perdido: é mutação legítima de terceiro.
  const raw = jsonl(
    editToolUse("t1", "/home/user/.claude/projects/x/memory/MEMORY.md", "modified: 10:00"),
    toolResult("t1"),
  );
  const { edits } = parseTranscript(raw);

  const divergences = withHome("/home/user", () =>
    findDivergences(
      edits,
      () => "modified: 10:05\nconteudo mutado por outro processo",
      "/repo",
    ));

  assertEquals(divergences.length, 0);
});

Deno.test("findDivergences: arquivo revertido via git checkout (issue #105) não é reportado", () => {
  // Edit registrado no transcript sem tool_result (parece trabalho perdido), mas o usuário
  // reverteu a mudança via `git checkout` — o disco não bate com o esperado, porém o arquivo
  // está "limpo" no git (sem modificações pendentes). isResolvedExternally simula o isGitClean
  // de stop-recovery.ts nesse cenário: a divergência não deve ser reportada.
  const raw = jsonl(editToolUse("t1", "/repo/a.ts", "linha nova"));
  const { edits } = parseTranscript(raw);

  const divergences = findDivergences(
    edits,
    () => "conteudo antigo sem a mudanca esperada",
    "/repo",
    () => true,
  );

  assertEquals(divergences.length, 0);
});

Deno.test("findDivergences: regressão issue #46 — edição dentro do repo não persistida continua detectada", () => {
  const raw = jsonl(editToolUse("t1", "/repo/a.ts", "linha nova"));
  const { edits } = parseTranscript(raw);

  const divergences = findDivergences(
    edits,
    () => "conteudo antigo sem a mudanca esperada",
    "/repo",
  );

  assertEquals(divergences.length, 1);
  assertEquals(divergences[0].filePath, "/repo/a.ts");
});

Deno.test("findDivergences: issue #136 — sem repoRoot, arquivo em ~/.claude/** continua ignorado incondicionalmente", () => {
  // Sessão fora de repo git: repoRoot() falha e devolve undefined. Antes da #136, a guarda de
  // exclusão de ~/.claude/** dependia de repoRoot !== undefined e se desligava por completo,
  // fazendo até arquivos de memória (mutados legitimamente por outro subsistema) serem
  // reportados como divergência. Isso não deve mais acontecer.
  const raw = jsonl(
    editToolUse("t1", "/home/user/.claude/projects/x/memory/MEMORY.md", "modified: 10:00"),
    toolResult("t1"),
  );
  const { edits } = parseTranscript(raw);

  const divergences = withHome("/home/user", () =>
    findDivergences(
      edits,
      () => "modified: 10:05\nconteudo mutado por outro processo",
      undefined,
    ));

  assertEquals(divergences.length, 0);
});

Deno.test("findDivergences: .claude/ versionado dentro do repo-alvo continua sendo verificado", () => {
  // A exclusão da #136 vale só para o ~/.claude/** do usuário. Um .claude/ versionado no repo
  // (ex.: .claude/settings.json, .claude/vetor/config.json) é conteúdo do projeto: uma edição
  // não persistida ali é trabalho perdido de verdade e deve continuar sendo reportada.
  const raw = jsonl(editToolUse("t1", "/repo/.claude/settings.json", "linha nova"));
  const { edits } = parseTranscript(raw);

  const divergences = withHome("/home/user", () =>
    findDivergences(
      edits,
      () => "conteudo antigo sem a mudanca esperada",
      "/repo",
    ));

  assertEquals(divergences.length, 1);
  assertEquals(divergences[0].filePath, "/repo/.claude/settings.json");
});

Deno.test("findDivergences: issue #136 — sem repoRoot, divergência fora de subsistema conhecido fica em silêncio", () => {
  // Sem repo-alvo detectável, não há como restringir a checagem (propósito original da #46);
  // em vez de verificar tudo, a divergência é tratada como não verificável.
  const raw = jsonl(editToolUse("t1", "/tmp/scratch/a.ts", "linha nova"));
  const { edits } = parseTranscript(raw);

  const divergences = findDivergences(
    edits,
    () => "conteudo antigo sem a mudanca esperada",
    undefined,
  );

  assertEquals(divergences.length, 0);
});
