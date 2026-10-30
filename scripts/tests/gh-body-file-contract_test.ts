import { assertEquals } from "@std/assert";

// Issues #525/#532: corpo inline (--body "..." / --body=... / heredoc / $(cat <<'EOF'))
// passa pelo shell e corrompe crases e BOM. Todo `gh issue|pr create|comment`
// documentado nas skills deve usar --body-file com arquivo escrito pela ferramenta Write.
const skillsDir = new URL("../../skills/", import.meta.url);

async function* mdFiles(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory) yield* mdFiles(path);
    else if (e.name.endsWith(".md")) yield path;
  }
}

// Comando em qualquer posição da linha (início, após `&&`, `;`, `|`, `$(`).
const GH_CMD = /(?:^|[\s;&|(`])gh (?:issue|pr) (?:create|comment)\b/;
const INLINE_BODY = /--body(?:=|\s+)(?!-file)|--body$/m;
const HEREDOC = /<<-?\s*['"]?[A-Za-z_]+/;

function isOffending(text: string): boolean {
  if (!GH_CMD.test(text)) return false;
  return INLINE_BODY.test(text) || HEREDOC.test(text);
}

/** Blocos cercados e code spans inline com `gh issue|pr create|comment` e corpo inline. */
function offendingBlocks(text: string): string[] {
  const out: string[] = [];
  const fence = /```[^\n]*\n([\s\S]*?)```/g;
  for (const m of text.matchAll(fence)) {
    if (isOffending(m[1])) out.push(m[1].split("\n")[0]);
  }
  const noFences = text.replace(fence, "");
  for (const m of noFences.matchAll(/`([^`\n]+)`/g)) {
    if (isOffending(m[1])) out.push(m[1]);
  }
  return out;
}

Deno.test("issues #525/#532: skills não usam --body inline em gh issue|pr create|comment", async () => {
  const bad: string[] = [];
  for await (const path of mdFiles(skillsDir.pathname)) {
    const text = await Deno.readTextFile(path);
    for (const b of offendingBlocks(text)) bad.push(`${path}: ${b}`);
  }
  assertEquals(bad, [], "use --body-file com arquivo escrito via Write");
});

const fenced = (s: string) => "```bash\n" + s + "\n```";

Deno.test("detector pega --body inline e aceita --body-file", () => {
  assertEquals(offendingBlocks(fenced('gh issue comment 1 --body "x"')).length, 1);
  assertEquals(offendingBlocks(fenced('gh pr comment 1 --body "x `y`"')).length, 1);
  assertEquals(offendingBlocks(fenced('gh pr create --title t --body "x"')).length, 1);
  assertEquals(offendingBlocks(fenced("gh pr create --body=x")).length, 1);
  assertEquals(offendingBlocks(fenced("gh issue comment 1 --body-file f.md")).length, 0);
  assertEquals(offendingBlocks(fenced("gh pr comment 1 --body-file f.md")).length, 0);
});

Deno.test("detector pega heredoc, $(cat <<'EOF') e comando após &&", () => {
  assertEquals(offendingBlocks(fenced("gh pr comment 1 --body-file - <<'EOF'\nx\nEOF")).length, 1);
  assertEquals(offendingBlocks(fenced("gh pr create --body \"$(cat <<'EOF'\nx\nEOF\n)\"")).length, 1);
  assertEquals(offendingBlocks(fenced('cd w && gh pr comment 1 --body "x"')).length, 1);
  assertEquals(offendingBlocks(fenced("cd w && gh pr comment 1 --body-file f.md")).length, 0);
});

Deno.test("detector pega code span inline com --body", () => {
  assertEquals(offendingBlocks('veja `gh pr comment 1 --body "@dependabot rebase"` ok').length, 1);
  assertEquals(offendingBlocks("veja `gh pr comment 1 --body-file f.md` ok").length, 0);
});
