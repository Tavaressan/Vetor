import { assertEquals } from "@std/assert";
import { filterNextDiagnostics, isNextProject } from "../check-edit.ts";

Deno.test("filterNextDiagnostics: elimina erro isolado de LayoutProps/PageProps/RouteContext — issue #345", () => {
  const tscOutput = `app/layout.tsx:5:18 - error TS2304: Cannot find name 'LayoutProps'.

5 export default function RootLayout({ children }: LayoutProps) {
                                                   ~~~~~~~~~~~

Found 1 error in app/layout.tsx:5`;

  const filtered = filterNextDiagnostics(tscOutput);
  assertEquals(filtered, "");
});

Deno.test("filterNextDiagnostics: elimina múltiplos falsos positivos do Next — issue #345", () => {
  const tscOutput = `app/layout.tsx:5:18 - error TS2304: Cannot find name 'LayoutProps'.

5 export default function RootLayout({ children }: LayoutProps) {
                                                   ~~~~~~~~~~~

app/page.tsx:3:12 - error TS2304: Cannot find name 'PageProps'.

3 export default function Page(props: PageProps) {
                                      ~~~~~~~~~

app/api/route.ts:4:20 - error TS2552: Cannot find name 'RouteContext'. Did you mean ...?

4 export async function GET(req: Request, ctx: RouteContext) {
                                               ~~~~~~~~~~~~

Found 3 errors in 3 files.`;

  const filtered = filterNextDiagnostics(tscOutput);
  assertEquals(filtered, "");
});

Deno.test("filterNextDiagnostics: preserva erros reais que não são falsos positivos — issue #345", () => {
  const tscOutput = `app/layout.tsx:5:18 - error TS2304: Cannot find name 'LayoutProps'.

5 export default function RootLayout({ children }: LayoutProps) {
                                                   ~~~~~~~~~~~

app/components/button.tsx:12:5 - error TS2304: Cannot find name 'unknownIdentifier'.

12     unknownIdentifier();
       ~~~~~~~~~~~~~~~~~

Found 2 errors in 2 files.`;

  const filtered = filterNextDiagnostics(tscOutput);
  assertEquals(
    filtered,
    `app/components/button.tsx:12:5 - error TS2304: Cannot find name 'unknownIdentifier'.\n\n12     unknownIdentifier();\n       ~~~~~~~~~~~~~~~~~`,
  );
});

Deno.test("isNextProject: detecta projeto Next.js por config ou package.json — issue #345", () => {
  const tempDir = Deno.makeTempDirSync();
  try {
    assertEquals(isNextProject(tempDir), false);

    Deno.writeTextFileSync(`${tempDir}/next.config.mjs`, "export default {};");
    assertEquals(isNextProject(tempDir), true);
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
});
