import { assertEquals } from "@std/assert";
import { detectProject, normalizeCwd } from "./project.ts";

Deno.test({
  name:
    "normalizeCwd converte path POSIX-style de drive (Git Bash Windows) para nativo (issue #307)",
  ignore: Deno.build.os !== "windows",
  fn: () => {
    assertEquals(normalizeCwd("/c/Users/test"), "C:/Users/test");
  },
});

Deno.test({
  name: "normalizeCwd não altera path já nativo (Windows)",
  ignore: Deno.build.os !== "windows",
  fn: () => {
    assertEquals(normalizeCwd("C:/Users/test"), "C:/Users/test");
  },
});

// Issue #313: um dispatch real do issue-coordinator, rodando de dentro de um mount MSYS sem letra
// de unidade (`/tmp/...`, comum quando o cwd do Git Bash está sob um diretório temp), quebrou
// `ensure-external-directory-permission.ts`/`resolve-model.ts` com `$(pwd)` cru — o Deno nativo do
// Windows não resolve esse path, e o erro de escrita apareceu como um falso "config não encontrado".
// `normalizeCwd()` só cobre o padrão `/<letra>/...` (issue #307), não mounts MSYS arbitrários — a
// mitigação escolhida foi no call site (`issue-coordinator.md` usa `$(pwd -W 2>/dev/null || pwd)`
// em vez de `$(pwd)`), não aqui. Este teste documenta a limitação conhecida para quem for revisitar
// `normalizeCwd()` no futuro, em vez de deixá-la implícita.
Deno.test({
  name:
    "normalizeCwd não resolve mounts MSYS sem letra de unidade (ex. /tmp/...) — mitigado no call site (issue #313)",
  ignore: Deno.build.os !== "windows",
  fn: () => {
    assertEquals(normalizeCwd("/tmp/foo/bar"), "/tmp/foo/bar");
  },
});

Deno.test({
  name: "normalizeCwd é identidade fora do Windows",
  ignore: Deno.build.os === "windows",
  fn: () => {
    assertEquals(normalizeCwd("/c/Users/test"), "/c/Users/test");
    assertEquals(normalizeCwd("/home/test"), "/home/test");
  },
});

async function nodeProject(pkg: unknown): Promise<string> {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/package.json`, JSON.stringify(pkg));
    return detectProject(dir).testCommand;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("detectProject (OpenCode) usa <pm> test só quando o script test existe — paridade #406", async () => {
  assertEquals(await nodeProject({ scripts: { test: "vitest" } }), "npm test");
  assertEquals(
    await nodeProject({ scripts: { dev: "next dev", build: "next build", lint: "next lint" } }),
    "npm run lint && npm run build",
  );
  assertEquals(
    await nodeProject({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }),
    "AJUSTE: comando de teste não detectado",
  );
  assertEquals(await nodeProject({}), "AJUSTE: comando de teste não detectado");
});
