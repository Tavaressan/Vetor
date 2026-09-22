import { assertEquals } from "@std/assert";
import { normalizeCwd } from "./project.ts";

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
