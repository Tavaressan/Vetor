// Detecção de dependências diretas *estruturais* (frameworks web, ORMs, libs de UI principais)
// de um projeto, usada pela skill stack-practices para saber quais libs consultar no Context7.
//
// Escopo deliberadamente restrito ao ALLOWLIST abaixo: o objetivo não é listar toda dependência
// declarada, é achar o punhado de libs estruturais que merecem uma rule de melhores práticas —
// uma rule por dependência transitiva/utilitária inflaria o contexto sem ganho.

export type Ecosystem = "npm" | "deno" | "python" | "rust";

export interface StructuralDependency {
  name: string;
  version: string;
  ecosystem: Ecosystem;
}

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

function readJson(path: string): unknown {
  return JSON.parse(Deno.readTextFileSync(path).replace(/^﻿/, ""));
}

function readTextSafe(path: string): string | null {
  try {
    return Deno.readTextFileSync(path).replace(/^﻿/, "");
  } catch {
    return null;
  }
}

/** Nome de pacote/import (chave em package.json/deno.json) reconhecido como lib estrutural. */
const STRUCTURAL_ALLOWLIST = new Set<string>([
  // frameworks web (JS/TS)
  "next",
  "react",
  "react-dom",
  "vue",
  "nuxt",
  "svelte",
  "@sveltejs/kit",
  "@angular/core",
  "express",
  "fastify",
  "koa",
  "@nestjs/core",
  "hono",
  "remix",
  "@remix-run/react",
  // ORMs (JS/TS)
  "prisma",
  "@prisma/client",
  "typeorm",
  "sequelize",
  "drizzle-orm",
  "mongoose",
  // Python
  "django",
  "flask",
  "fastapi",
  "sqlalchemy",
  // Rust
  "actix-web",
  "rocket",
  "axum",
  "diesel",
]);

function stripVersionPrefix(v: string): string {
  return v.replace(/^[\^~>=<\s]+/, "").trim();
}

function fromNpmDeps(
  deps: Record<string, string> | undefined,
  out: StructuralDependency[],
  seen: Set<string>,
) {
  if (!deps) return;
  for (const [name, version] of Object.entries(deps)) {
    if (!STRUCTURAL_ALLOWLIST.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, version: stripVersionPrefix(version), ecosystem: "npm" });
  }
}

function detectFromPackageJson(dir: string, seen: Set<string>): StructuralDependency[] {
  const path = `${dir}/package.json`;
  if (!exists(path)) return [];
  const out: StructuralDependency[] = [];
  try {
    const parsed = readJson(path) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    fromNpmDeps(parsed.dependencies, out, seen);
    fromNpmDeps(parsed.devDependencies, out, seen);
  } catch { /* package.json ilegível: nenhuma dependência a relatar */ }
  return out;
}

/** Extrai o nome do pacote e a versão de um specifier `npm:pkg@versão` ou `jsr:@scope/pkg@versão`. */
function parseDenoSpecifier(specifier: string): { name: string; version: string } | null {
  const match = specifier.match(/^(?:npm|jsr):(@[^/@]+\/[^@/]+|[^@/]+)@([^/]+)$/);
  if (!match) return null;
  return { name: match[1], version: match[2] };
}

function detectFromDenoJson(dir: string, seen: Set<string>): StructuralDependency[] {
  const out: StructuralDependency[] = [];
  for (const name of ["deno.json", "deno.jsonc"]) {
    const path = `${dir}/${name}`;
    if (!exists(path)) continue;
    try {
      const parsed = readJson(path) as { imports?: Record<string, string> };
      for (const [alias, specifier] of Object.entries(parsed.imports ?? {})) {
        const parsedSpec = parseDenoSpecifier(specifier);
        const pkgName = parsedSpec?.name ?? alias;
        if (!STRUCTURAL_ALLOWLIST.has(pkgName) || seen.has(pkgName)) continue;
        seen.add(pkgName);
        out.push({
          name: pkgName,
          version: parsedSpec?.version ?? "unknown",
          ecosystem: "deno",
        });
      }
    } catch { /* config ilegível (jsonc com comentários, etc.): nenhuma dependência a relatar */ }
    break;
  }
  return out;
}

/** Varredura simples (não é um parser TOML completo) por `<lib> = "<versão>"` no texto. */
function scanTomlForAllowlist(
  text: string,
  ecosystem: Ecosystem,
  seen: Set<string>,
): StructuralDependency[] {
  const out: StructuralDependency[] = [];
  for (const lib of STRUCTURAL_ALLOWLIST) {
    if (seen.has(lib)) continue;
    const escaped = lib.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(?:^|\\n)\\s*"?${escaped}"?\\s*=\\s*[{"]?\\s*(?:version\\s*=\\s*)?"([^"]+)"`,
      "i",
    );
    const match = text.match(re);
    if (!match) continue;
    seen.add(lib);
    out.push({ name: lib, version: stripVersionPrefix(match[1]), ecosystem });
  }
  return out;
}

function detectFromPyprojectToml(dir: string, seen: Set<string>): StructuralDependency[] {
  const text = readTextSafe(`${dir}/pyproject.toml`);
  if (text === null) return [];
  return scanTomlForAllowlist(text, "python", seen);
}

function detectFromCargoToml(dir: string, seen: Set<string>): StructuralDependency[] {
  const text = readTextSafe(`${dir}/Cargo.toml`);
  if (text === null) return [];
  return scanTomlForAllowlist(text, "rust", seen);
}

/**
 * Detecta dependências diretas estruturais do projeto em `dir`, cruzando package.json,
 * deno.json/deno.jsonc, pyproject.toml e Cargo.toml. Cada lib aparece no máximo uma vez
 * (primeira fonte que a encontrar vence).
 */
export function detectStructuralDeps(dir: string): StructuralDependency[] {
  const seen = new Set<string>();
  return [
    ...detectFromPackageJson(dir, seen),
    ...detectFromDenoJson(dir, seen),
    ...detectFromPyprojectToml(dir, seen),
    ...detectFromCargoToml(dir, seen),
  ];
}
