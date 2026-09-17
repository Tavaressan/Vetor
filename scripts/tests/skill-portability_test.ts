import { assertEquals } from "@std/assert";

// Issue #251: nenhum SKILL.md em skills/ pode depender de $CLAUDE_PLUGIN_ROOT — as referências a
// docs/scripts compartilhados devem resolver por path relativo ao próprio diretório da skill, sem
// nenhuma variável de ambiente específica de engine (Claude Code/Codex/OpenCode).

const repoRoot = new URL("../../", import.meta.url);

async function findSkillFiles(): Promise<string[]> {
  const skillsDir = new URL("skills/", repoRoot);
  const files: string[] = [];
  for await (const entry of Deno.readDir(skillsDir)) {
    if (!entry.isDirectory) continue;
    const candidate = new URL(`skills/${entry.name}/SKILL.md`, repoRoot);
    try {
      await Deno.stat(candidate);
      files.push(candidate.pathname.replace(/^\/([A-Za-z]):/, "$1:"));
    } catch {
      // sem SKILL.md neste subdiretório (ex.: skills/shared) — ignora
    }
  }
  return files;
}

Deno.test("nenhum SKILL.md em skills/ referencia $CLAUDE_PLUGIN_ROOT", async () => {
  const files = await findSkillFiles();
  assertEquals(files.length > 0, true, "esperava encontrar ao menos um SKILL.md");

  for (const file of files) {
    const content = await Deno.readTextFile(file);
    assertEquals(
      content.includes("CLAUDE_PLUGIN_ROOT"),
      false,
      `${file} ainda referencia CLAUDE_PLUGIN_ROOT`,
    );
  }
});

Deno.test("referências relativas (shared/references, scripts, templates, plugin.json) resolvem a partir do diretório da skill", async () => {
  const files = await findSkillFiles();
  const pattern = /`(\.\.\/[^`\s]+\.(?:md|ts|sh|json))`/g;

  let checked = 0;
  for (const file of files) {
    const content = await Deno.readTextFile(file);
    const dir = file.slice(0, file.lastIndexOf("/") + 1);

    for (const match of content.matchAll(pattern)) {
      const relPath = match[1];
      const resolved = new URL(relPath, `file:///${dir}`);
      try {
        await Deno.stat(resolved);
        checked++;
      } catch {
        throw new Error(`${file}: path relativo "${relPath}" não resolve para um arquivo existente`);
      }
    }
  }
  assertEquals(checked > 0, true, "esperava validar ao menos um path relativo");
});
