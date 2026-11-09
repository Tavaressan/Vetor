import { assert, assertMatch } from "@std/assert";

// Issue #568: o contrato de capacidades tem fonte única de fallbacks, e o `compatibility` de cada
// skill diz que ela exige só o núcleo.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const reference = await read("skills/shared/references/harness-capabilities.md");

Deno.test("issue #568: cada capacidade opcional tem uma seção de fallback na referência", () => {
  for (
    const id of [
      "subagents",
      "hooks",
      "worktree-isolation",
      "questions",
      "background",
      "scheduling",
    ]
  ) {
    assertMatch(
      reference,
      new RegExp(`### 2\\.\\d .*\\(\`${id}\`\\)[\\s\\S]*?\\*\\*Fallback:\\*\\*`),
    );
  }
});

Deno.test("issue #568: o compatibility de toda skill declara só o núcleo como obrigatório", async () => {
  for await (const entry of Deno.readDir(new URL("skills/", root))) {
    if (!entry.isDirectory || entry.name === "shared") continue;
    const skill = await read(`skills/${entry.name}/SKILL.md`);
    const compatibility = skill.match(/^compatibility: (.*)$/m)?.[1] ?? "";
    assert(
      compatibility.startsWith('"Núcleo: ler, editar e rodar shell.'),
      `${entry.name}: compatibility fora do contrato: ${compatibility}`,
    );
  }
});
