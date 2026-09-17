import { assertEquals } from "@std/assert";

// Issue #251: nenhum SKILL.md em skills/ pode depender de $CLAUDE_PLUGIN_ROOT — as referências a
// docs/scripts compartilhados devem resolver por path relativo ao próprio diretório da skill, sem
// nenhuma variável de ambiente específica de engine (Claude Code/Codex/OpenCode).
//
// Achado do code review da PR #263: um path relativo dentro de um fence bash/deno executável
// resolve contra o cwd do processo (o worktree do projeto-alvo), não contra o diretório da skill —
// diferente de uma referência em prosa, que só orienta o agente a montar o path ele mesmo. Todo
// path relativo usado dentro de um fence precisa estar prefixado por `$SKILL_DIR` (definido uma vez
// em "## Referências"), nunca solto.

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

function extractFences(content: string): string[] {
  const fences: string[] = [];
  const pattern = /```[^\n]*\n([\s\S]*?)```/g;
  for (const match of content.matchAll(pattern)) {
    fences.push(match[1]);
  }
  return fences;
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

Deno.test("referências relativas em prosa (shared/references, scripts, templates, plugin.json) resolvem a partir do diretório da skill", async () => {
  const files = await findSkillFiles();
  const pattern = /`(\$SKILL_DIR\/)?(\.\.\/[^`\s]+\.(?:md|ts|sh|json))`/g;

  let checked = 0;
  for (const file of files) {
    const content = await Deno.readTextFile(file);
    const dir = file.slice(0, file.lastIndexOf("/") + 1);

    for (const match of content.matchAll(pattern)) {
      const relPath = match[2];
      const resolved = new URL(relPath, `file:///${dir}`);
      try {
        await Deno.stat(resolved);
        checked++;
      } catch {
        throw new Error(
          `${file}: path relativo "${relPath}" não resolve para um arquivo existente`,
        );
      }
    }
  }
  assertEquals(checked > 0, true, "esperava validar ao menos um path relativo");
});

Deno.test("nenhum fence bash/deno usa path relativo sem prefixo $SKILL_DIR — achado da PR #263", async () => {
  const files = await findSkillFiles();
  const barePathPattern = /["'](\.\.\/(?:scripts|templates|shared|\.claude-plugin)\/[^"']*)["']/g;

  let fencesWithPath = 0;
  for (const file of files) {
    const content = await Deno.readTextFile(file);
    for (const fence of extractFences(content)) {
      for (const match of fence.matchAll(barePathPattern)) {
        throw new Error(
          `${file}: fence executável usa path relativo solto "${match[1]}" — precisa do prefixo ` +
            `"$SKILL_DIR/" (path relativo dentro de um fence resolve contra o cwd do processo, ` +
            `não contra o diretório da skill).`,
        );
      }
      if (/\$SKILL_DIR\/\.\.\//.test(fence)) fencesWithPath++;
    }
  }
  assertEquals(
    fencesWithPath > 0,
    true,
    "esperava encontrar ao menos um fence usando $SKILL_DIR/../ corretamente",
  );
});

Deno.test("paths $SKILL_DIR/../../... usados em fences resolvem a partir do diretório da skill", async () => {
  const files = await findSkillFiles();
  const skillDirPathPattern = /\$SKILL_DIR(\/\.\.\/[^"'\s`]+)/g;

  let checked = 0;
  for (const file of files) {
    const content = await Deno.readTextFile(file);
    const dir = file.slice(0, file.lastIndexOf("/") + 1);

    for (const fence of extractFences(content)) {
      for (const match of fence.matchAll(skillDirPathPattern)) {
        const relPath = match[1].slice(1); // remove a barra inicial duplicada
        // ignora placeholders de exemplo sem extensão real de arquivo (ex.: <PR-number> em templates)
        if (!/\.(md|ts|sh|json)$/.test(relPath)) continue;
        const resolved = new URL(relPath, `file:///${dir}`);
        try {
          await Deno.stat(resolved);
          checked++;
        } catch {
          throw new Error(
            `${file}: "$SKILL_DIR${
              match[1]
            }" não resolve para um arquivo existente a partir do diretório da skill`,
          );
        }
      }
    }
  }
  assertEquals(checked > 0, true, "esperava validar ao menos um path $SKILL_DIR/../... em fence");
});
