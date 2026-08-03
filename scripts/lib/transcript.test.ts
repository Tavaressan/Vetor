import { assertEquals } from "@std/assert";
import { findDivergences, parseTranscript } from "./transcript.ts";

function makeTranscript(lines: Record<string, unknown>[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

Deno.test("parseTranscript tracks Bash commands after edits", () => {
  const transcript = makeTranscript([
    {
      message: {
        content: [
          {
            type: "tool_use",
            id: "edit-1",
            name: "Edit",
            input: { file_path: "/repo/src/foo.ts", new_string: "hello" },
          },
        ],
      },
    },
    {
      message: {
        content: [
          { type: "tool_result", tool_use_id: "edit-1", is_error: false },
        ],
      },
    },
    {
      message: {
        content: [
          {
            type: "tool_use",
            id: "bash-1",
            name: "Bash",
            input: { command: "git worktree remove /repo" },
          },
        ],
      },
    },
    {
      message: {
        content: [
          { type: "tool_result", tool_use_id: "bash-1", is_error: false },
        ],
      },
    },
  ]);

  const { edits, bashCommands } = parseTranscript(transcript);
  assertEquals(edits.length, 1);
  assertEquals(edits[0].filePath, "/repo/src/foo.ts");
  assertEquals(bashCommands.length, 1);
  assertEquals(bashCommands[0].command, "git worktree remove /repo");
});

Deno.test("findDivergences does not flag file removed by later Bash command", () => {
  const transcript = makeTranscript([
    {
      message: {
        content: [
          {
            type: "tool_use",
            id: "edit-1",
            name: "Edit",
            input: { file_path: "/repo/src/foo.ts", new_string: "hello" },
          },
        ],
      },
    },
    {
      message: {
        content: [
          { type: "tool_result", tool_use_id: "edit-1", is_error: false },
        ],
      },
    },
    {
      message: {
        content: [
          {
            type: "tool_use",
            id: "bash-1",
            name: "Bash",
            input: { command: "git worktree remove /repo" },
          },
        ],
      },
    },
    {
      message: {
        content: [
          { type: "tool_result", tool_use_id: "bash-1", is_error: false },
        ],
      },
    },
  ]);

  const { edits: records, bashCommands } = parseTranscript(transcript);

  const readFile = (_path: string): string | null => null;
  const divergences = findDivergences(records, readFile, "/repo", undefined, bashCommands);

  assertEquals(divergences.length, 0);
});

Deno.test("findDivergences still flags file not removed by any command", () => {
  const transcript = makeTranscript([
    {
      message: {
        content: [
          {
            type: "tool_use",
            id: "edit-1",
            name: "Edit",
            input: { file_path: "/repo/src/foo.ts", new_string: "hello" },
          },
        ],
      },
    },
    {
      message: {
        content: [
          { type: "tool_result", tool_use_id: "edit-1", is_error: false },
        ],
      },
    },
  ]);

  const { edits: records, bashCommands } = parseTranscript(transcript);

  const readFile = (_path: string): string | null => null;
  const divergences = findDivergences(records, readFile, "/repo", undefined, bashCommands);

  assertEquals(divergences.length, 1);
  assertEquals(divergences[0].filePath, "/repo/src/foo.ts");
  assertEquals(divergences[0].reason, "arquivo não encontrado em disco");
});

Deno.test("findDivergences flags file removed by unrelated Bash command", () => {
  const transcript = makeTranscript([
    {
      message: {
        content: [
          {
            type: "tool_use",
            id: "edit-1",
            name: "Edit",
            input: { file_path: "/repo/src/foo.ts", new_string: "hello" },
          },
        ],
      },
    },
    {
      message: {
        content: [
          { type: "tool_result", tool_use_id: "edit-1", is_error: false },
        ],
      },
    },
    {
      message: {
        content: [
          {
            type: "tool_use",
            id: "bash-1",
            name: "Bash",
            input: { command: "ls -la" },
          },
        ],
      },
    },
    {
      message: {
        content: [
          { type: "tool_result", tool_use_id: "bash-1", is_error: false },
        ],
      },
    },
  ]);

  const { edits: records, bashCommands } = parseTranscript(transcript);

  const readFile = (_path: string): string | null => null;
  const divergences = findDivergences(records, readFile, "/repo", undefined, bashCommands);

  assertEquals(divergences.length, 1);
});
