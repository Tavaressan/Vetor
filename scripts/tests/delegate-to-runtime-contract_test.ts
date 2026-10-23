import { assertEquals, assertStringIncludes } from "@std/assert";

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

async function listFiles(directory: URL): Promise<URL[]> {
  const files: URL[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const child = new URL(entry.name + (entry.isDirectory ? "/" : ""), directory);
    if (entry.isDirectory) files.push(...await listFiles(child));
    else files.push(child);
  }
  return files;
}

Deno.test("issue #486: o Alethe é o único orquestrador com adaptador e menção nas skills", async () => {
  const adapters = [];
  for await (const entry of Deno.readDir(new URL("scripts/lib/orchestrator/adapters/", root))) {
    adapters.push(entry.name);
  }
  assertEquals(adapters, ["alethe.ts"]);

  // Orca, o adaptador genérico e as variáveis de ambiente não tinham fonte (sonda de 2026-10-23)
  const unsourced =
    /orca|generic-?mcp|ALETHE_ORCHESTRATOR|ALETHE_SESSION_ID|ORCA_|delegation\.custom/i;
  const offenders: string[] = [];
  for (const file of await listFiles(new URL("skills/", root))) {
    if (!file.pathname.endsWith(".md")) continue;
    const match = unsourced.exec(await Deno.readTextFile(file));
    if (match) offenders.push(`${file.pathname}: ${match[0]}`);
  }
  assertEquals(offenders, []);
});
