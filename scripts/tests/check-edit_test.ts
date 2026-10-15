import { assertEquals, assertStringIncludes } from "@std/assert";
import { filterNextTypegenDiagnostics } from "../check-edit.ts";

const TYPEGEN_ERRORS = [
  "app/layout.tsx(1,1): error TS2304: Cannot find name 'LayoutProps'.",
  "app/page.tsx(1,1): error TS2304: Cannot find name 'PageProps'.",
  "app/api/route.ts(1,1): error TS2304: Cannot find name 'RouteContext'.",
].join("\n");

Deno.test("Next.js ignora apenas TS2304 dos tipos globais gerados pelo typegen", () => {
  assertEquals(filterNextTypegenDiagnostics(TYPEGEN_ERRORS, true), "");
  assertEquals(filterNextTypegenDiagnostics(TYPEGEN_ERRORS, false), TYPEGEN_ERRORS);
});

Deno.test("Next.js mantém diagnósticos reais junto aos tipos do typegen", () => {
  const realError =
    "app/page.tsx(2,1): error TS2322: Type 'string' is not assignable to type 'number'.";
  const output = filterNextTypegenDiagnostics(`${TYPEGEN_ERRORS}\n${realError}`, true);
  assertStringIncludes(output, realError);
  assertEquals(output.includes("LayoutProps"), false);
});
