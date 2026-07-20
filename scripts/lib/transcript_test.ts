import { assertEquals } from "@std/assert";
import { findDivergences, parseTranscript } from "./transcript.ts";

/** Monta um transcript .jsonl a partir de blocos de mensagem já prontos. */
function jsonl(...lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n");
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
  const records = parseTranscript(raw);

  assertEquals(records.length, 1);
  assertEquals(records[0].filePath, "/repo/a.ts");
  assertEquals(records[0].incomplete, true);
});

Deno.test("parseTranscript: edição rejeitada (is_error) é descartada", () => {
  const raw = jsonl(editToolUse("t1", "/repo/a.ts", "novo conteudo"), toolResult("t1", true));
  const records = parseTranscript(raw);

  assertEquals(records.length, 0);
});

Deno.test("parseTranscript: só a última edição por arquivo é mantida", () => {
  const raw = jsonl(
    writeToolUse("t1", "/repo/a.ts", "primeira versao"),
    toolResult("t1"),
    writeToolUse("t2", "/repo/a.ts", "versao final"),
    toolResult("t2"),
  );
  const records = parseTranscript(raw);

  assertEquals(records.length, 1);
  assertEquals(records[0].expected, "versao final");
});

Deno.test("findDivergences: edição não persistida em disco é reportada", () => {
  const raw = jsonl(editToolUse("t1", "/repo/a.ts", "linha nova"));
  const records = parseTranscript(raw);

  const divergences = findDivergences(records, (path) => {
    assertEquals(path, "/repo/a.ts");
    return "conteudo antigo sem a mudanca esperada";
  });

  assertEquals(divergences.length, 1);
  assertEquals(divergences[0].filePath, "/repo/a.ts");
});

Deno.test("findDivergences: sem divergência, nada é reportado", () => {
  const raw = jsonl(
    editToolUse("t1", "/repo/a.ts", "linha nova"),
    toolResult("t1"),
  );
  const records = parseTranscript(raw);

  const divergences = findDivergences(records, () => "conteudo com a linha nova aplicada");

  assertEquals(divergences.length, 0);
});

Deno.test("findDivergences: arquivo ausente em disco é reportado", () => {
  const raw = jsonl(writeToolUse("t1", "/repo/novo.ts", "conteudo"), toolResult("t1"));
  const records = parseTranscript(raw);

  const divergences = findDivergences(records, () => null);

  assertEquals(divergences.length, 1);
  assertEquals(divergences[0].reason, "arquivo não encontrado em disco");
});
