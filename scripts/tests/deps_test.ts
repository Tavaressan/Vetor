import { assertEquals } from "@std/assert";
import { detectStructuralDeps } from "../lib/deps.ts";

function tempDir(): string {
  return Deno.makeTempDirSync();
}

function cleanup(dir: string) {
  try {
    Deno.removeSync(dir, { recursive: true });
  } catch { /* já removido */ }
}

Deno.test("package.json: dependência estrutural direta (Next.js) é detectada", () => {
  const dir = tempDir();
  try {
    Deno.writeTextFileSync(
      `${dir}/package.json`,
      JSON.stringify({ dependencies: { next: "^14.2.3", react: "^18.3.1" } }),
    );

    const deps = detectStructuralDeps(dir);

    assertEquals(
      deps.some((d) => d.name === "next" && d.version === "14.2.3" && d.ecosystem === "npm"),
      true,
    );
    assertEquals(
      deps.some((d) => d.name === "react" && d.version === "18.3.1"),
      true,
    );
  } finally {
    cleanup(dir);
  }
});

Deno.test("package.json: dependência não estrutural (utilitária) não é detectada", () => {
  const dir = tempDir();
  try {
    Deno.writeTextFileSync(
      `${dir}/package.json`,
      JSON.stringify({ dependencies: { lodash: "^4.17.21" } }),
    );

    const deps = detectStructuralDeps(dir);

    assertEquals(deps.length, 0);
  } finally {
    cleanup(dir);
  }
});

Deno.test("package.json: devDependencies também são varridas (ex.: framework em devDeps)", () => {
  const dir = tempDir();
  try {
    Deno.writeTextFileSync(
      `${dir}/package.json`,
      JSON.stringify({ devDependencies: { express: "~4.19.2" } }),
    );

    const deps = detectStructuralDeps(dir);

    assertEquals(deps.some((d) => d.name === "express" && d.version === "4.19.2"), true);
  } finally {
    cleanup(dir);
  }
});

Deno.test("deno.json: import estrutural via npm: specifier é detectado", () => {
  const dir = tempDir();
  try {
    Deno.writeTextFileSync(
      `${dir}/deno.json`,
      JSON.stringify({ imports: { "react": "npm:react@18.2.0", "lodash": "npm:lodash@4.17.21" } }),
    );

    const deps = detectStructuralDeps(dir);

    assertEquals(deps.length, 1);
    assertEquals(deps[0], { name: "react", version: "18.2.0", ecosystem: "deno" });
  } finally {
    cleanup(dir);
  }
});

Deno.test("pyproject.toml: dependência estrutural (Django) é detectada", () => {
  const dir = tempDir();
  try {
    Deno.writeTextFileSync(
      `${dir}/pyproject.toml`,
      '[tool.poetry.dependencies]\npython = "^3.11"\ndjango = "^4.2.0"\n',
    );

    const deps = detectStructuralDeps(dir);

    assertEquals(deps.some((d) => d.name === "django" && d.version === "4.2.0"), true);
  } finally {
    cleanup(dir);
  }
});

Deno.test("pyproject.toml: dependência estrutural em formato PEP 621 (dependencies = [...]) é detectada", () => {
  const dir = tempDir();
  try {
    Deno.writeTextFileSync(
      `${dir}/pyproject.toml`,
      '[project]\nname = "app"\ndependencies = [\n  "fastapi>=0.110.0",\n  "requests",\n]\n',
    );

    const deps = detectStructuralDeps(dir);

    assertEquals(deps.some((d) => d.name === "fastapi" && d.version === "0.110.0"), true);
    assertEquals(deps.some((d) => d.name === "requests"), false);
  } finally {
    cleanup(dir);
  }
});

Deno.test("Cargo.toml: dependência estrutural (Actix Web) é detectada", () => {
  const dir = tempDir();
  try {
    Deno.writeTextFileSync(
      `${dir}/Cargo.toml`,
      '[dependencies]\nactix-web = "4.4"\nserde = { version = "1.0" }\n',
    );

    const deps = detectStructuralDeps(dir);

    assertEquals(deps.some((d) => d.name === "actix-web" && d.version === "4.4"), true);
    assertEquals(deps.some((d) => d.name === "serde"), false);
  } finally {
    cleanup(dir);
  }
});

Deno.test("sem nenhum manifest reconhecido, retorna lista vazia", () => {
  const dir = tempDir();
  try {
    const deps = detectStructuralDeps(dir);
    assertEquals(deps, []);
  } finally {
    cleanup(dir);
  }
});
