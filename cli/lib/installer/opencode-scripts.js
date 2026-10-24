'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Issue #477: `.opencode/scripts/` do projeto-alvo deixa de ser uma árvore versionada em
// `opencode/scripts/` e passa a ser gerada a partir do canônico em `scripts/`. Este módulo é a
// fonte única da lista usada pelo instalador (writer.js) e pelo empacotamento
// (cli/scripts/sync-templates.js).
//
// Lista explícita de entradas: só o que o plugin `opencode/plugin/vetor.ts` e o agent do
// coordinator invocam. As dependências locais de cada uma (`lib/*.ts`) entram por import,
// recursivamente — assim um módulo novo importado por um script canônico (ex.:
// `lib/safety-policy.ts`, #476) acompanha a geração sem alterar esta lista.
const OPENCODE_SCRIPT_ENTRIES = [
  'check-edit.ts',
  'safety-check.ts',
  'vetor-checks.sh',
  'vetor-status.sh',
];

// Cobre `import x from "./a.ts"`, `export ... from "./a.ts"`, `import "./a.ts"` e `import("./a.ts")`.
// Só especificadores relativos terminados em `.ts` (o Deno exige a extensão).
const LOCAL_IMPORT_PATTERN = /(\b(?:from|import)\s*\(?\s*["'])(\.{1,2}\/[^"']+\.ts)(["'])/g;

function listTsFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listTsFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(fullPath);
  }
  return result;
}

function localImports(content) {
  return [...content.matchAll(LOCAL_IMPORT_PATTERN)].map((match) => match[2]);
}

// Path (posix, relativo à raiz da fonte) de `specifier` importado por `importerRel`.
function resolveSpecifier(importerRel, specifier) {
  return path.posix.join(path.posix.dirname(importerRel), specifier);
}

function isCanonicalPath(relPath) {
  return relPath.startsWith('scripts/');
}

/**
 * Lista, relativos a `scripts/` e em ordem estável, os arquivos canônicos que o OpenCode precisa:
 * as entradas explícitas, as dependências locais delas e o canônico importado pelos módulos
 * exclusivos de `opencode/scripts/` (ex.: `lib/status.ts`, usado por `resolve-model.ts`).
 *
 * Entrada ou dependência ausente faz a geração falhar com o path, nunca um no-op silencioso.
 */
function resolveOpencodeScripts(sourceRoot) {
  const found = new Set();
  const pending = [];

  const enqueue = (relPath, importer) => {
    if (found.has(relPath)) return;
    if (!fs.existsSync(path.join(sourceRoot, ...relPath.split('/')))) {
      const origin = importer ? ` (importado por ${importer})` : '';
      throw new Error(`OpenCode: arquivo canônico ausente: ${relPath}${origin}`);
    }
    found.add(relPath);
    pending.push(relPath);
  };

  for (const entry of OPENCODE_SCRIPT_ENTRIES) enqueue(`scripts/${entry}`, null);

  const nativeScriptsDir = path.join(sourceRoot, 'opencode', 'scripts');
  if (fs.existsSync(nativeScriptsDir)) {
    for (const file of listTsFiles(nativeScriptsDir)) {
      const importerRel = path.relative(sourceRoot, file).split(path.sep).join('/');
      for (const specifier of localImports(fs.readFileSync(file, 'utf8'))) {
        const target = resolveSpecifier(importerRel, specifier);
        if (isCanonicalPath(target)) enqueue(target, importerRel);
      }
    }
  }

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current.endsWith('.ts')) continue;
    const content = fs.readFileSync(path.join(sourceRoot, ...current.split('/')), 'utf8');
    for (const specifier of localImports(content)) {
      const target = resolveSpecifier(current, specifier);
      if (isCanonicalPath(target)) enqueue(target, current);
    }
  }

  return [...found].map((relPath) => relPath.slice('scripts/'.length)).sort();
}

/**
 * Reescreve, num módulo exclusivo de `opencode/scripts/`, os imports do canônico para o layout
 * instalado. No repositório o exclusivo importa o canônico por caminho real
 * (`../../scripts/lib/project.ts`), o que mantém `deno check`/`deno test` funcionando sem cópia
 * versionada; no destino o canônico fica ao lado (`./lib/project.ts`).
 *
 * `nativeRel` é o path do arquivo relativo a `opencode/` (ex.: `scripts/lib/x.ts`), que é também
 * o path dele relativo ao destino `.opencode/`.
 */
function rewriteNativeScriptImports(content, nativeRel) {
  const sourceRel = `opencode/${nativeRel}`;
  const destDir = path.posix.dirname(nativeRel);

  return content.replace(LOCAL_IMPORT_PATTERN, (match, prefix, specifier, suffix) => {
    const target = resolveSpecifier(sourceRel, specifier);
    if (!isCanonicalPath(target)) return match;

    const relative = path.posix.relative(destDir, target);
    return `${prefix}${relative.startsWith('.') ? relative : `./${relative}`}${suffix}`;
  });
}

module.exports = {
  OPENCODE_SCRIPT_ENTRIES,
  resolveOpencodeScripts,
  rewriteNativeScriptImports,
};
