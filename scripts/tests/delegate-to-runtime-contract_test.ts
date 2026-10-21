import { assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const reference = await Deno.readTextFile(
  new URL("skills/shared/references/delegate-to-runtime.md", root),
);

Deno.test("issues #431 e #434: invocações isolam OpenCode e documentam Codex", () => {
  assertStringIncludes(reference, '`opencode run --agent plan "<prompt>"`');
  assertStringIncludes(reference, "Para OpenCode, `$DELEGATE` é");
  assertStringIncludes(
    reference,
    "`opencode run --agent plan`; para Codex, `codex exec -s read-only`",
  );
  assertStringIncludes(
    reference,
    "compare `git status --porcelain` antes e depois de cada delegação",
  );
  assertStringIncludes(reference, "resposta venha somente pelo stdout");
  assertStringIncludes(reference, "não é um sandbox para comandos shell");
  assertStringIncludes(reference, '`codex exec -s read-only "<prompt>"`');
  assertStringIncludes(reference, "codex-cli 0.163.0");
  assertStringIncludes(reference, "**Confirmado empiricamente** (codex-cli 0.163.0, 2026-10-21)");
  assertStringIncludes(reference, "`--agent plan` deixou `git status --porcelain` inalterado");
  assertStringIncludes(reference, "stdin is appended as a `<stdin>` block");
  assertStringIncludes(reference, "--sandbox");
  assertStringIncludes(reference, "danger-full-access");
});
