import { assertEquals } from "@std/assert";

// Issue #525: corpo inline (--body "..." / heredoc) passa pelo shell e corrompe
// crases e BOM. Todo `gh issue create|comment` documentado nas skills deve usar
// --body-file com arquivo escrito pela ferramenta Write.
const skillsDir = new URL("../../skills/", import.meta.url);

async function* mdFiles(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory) yield* mdFiles(path);
    else if (e.name.endsWith(".md")) yield path;
  }
}

/** Blocos de código (```) que contêm um `gh issue create|comment` como comando. */
function offendingBlocks(text: string): string[] {
  const out: string[] = [];
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  for (const m of text.matchAll(fence)) {
    const block = m[1];
    if (!/^\s*gh issue (create|comment)\b/m.test(block)) continue;
    if (/--body(?!-file)\b/.test(block) || /<<-?\s*'?EOF/.test(block)) {
      out.push(block.split("\n")[0]);
    }
  }
  return out;
}

Deno.test("issue #525: skills não usam --body inline em gh issue create/comment", async () => {
  const bad: string[] = [];
  for await (const path of mdFiles(skillsDir.pathname)) {
    const text = await Deno.readTextFile(path);
    for (const b of offendingBlocks(text)) bad.push(`${path}: ${b}`);
  }
  assertEquals(bad, [], "use --body-file com arquivo escrito via Write");
});

Deno.test("issue #525: detector pega --body inline e aceita --body-file", () => {
  const inline = '```bash\ngh issue comment 1 --body "x"\n```';
  const file = "```bash\ngh issue comment 1 --body-file f.md\n```";
  assertEquals(offendingBlocks(inline).length, 1);
  assertEquals(offendingBlocks(file).length, 0);
});
