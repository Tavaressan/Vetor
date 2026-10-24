'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  OPENCODE_SCRIPT_ENTRIES,
  resolveOpencodeScripts,
  rewriteNativeScriptImports,
} = require('../lib/installer/opencode-scripts.js');
const { MONOREPO_ROOT } = require('../scripts/sync-templates.js');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-opencode-scripts-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function write(root, relPath, content = '\n') {
  const file = path.join(root, ...relPath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// Fonte fake mínima: as quatro entradas explícitas, uma dependência transitiva em lib/ e um
// utilitário que ninguém importa (não deve ser empacotado).
function makeScriptsTree(root) {
  write(root, 'scripts/check-edit.ts', 'import { a } from "./lib/a.ts";\n');
  write(root, 'scripts/safety-check.ts', 'import { b } from "./lib/b.ts";\n');
  write(root, 'scripts/vetor-checks.sh', '#!/usr/bin/env bash\n');
  write(root, 'scripts/vetor-status.sh', '#!/usr/bin/env bash\n');
  write(root, 'scripts/lib/a.ts', 'export const a = 1;\n');
  write(root, 'scripts/lib/b.ts', 'import { c } from "./c.ts";\nexport const b = c;\n');
  write(root, 'scripts/lib/c.ts', 'export const c = 1;\n');
  write(root, 'scripts/nao-usado.ts', 'export const unused = 1;\n');
}

test('resolveOpencodeScripts: entradas explícitas mais as dependências locais, recursivamente', () => {
  withTempDir((root) => {
    makeScriptsTree(root);

    assert.deepEqual(resolveOpencodeScripts(root), [
      'check-edit.ts',
      'lib/a.ts',
      'lib/b.ts',
      'lib/c.ts',
      'safety-check.ts',
      'vetor-checks.sh',
      'vetor-status.sh',
    ]);
  });
});

test('resolveOpencodeScripts: inclui o canônico importado por módulo exclusivo do OpenCode', () => {
  withTempDir((root) => {
    makeScriptsTree(root);
    write(root, 'scripts/lib/status.ts', 'export const status = 1;\n');
    write(
      root,
      'opencode/scripts/resolve-model.ts',
      'import { status } from "../../scripts/lib/status.ts";\nimport { x } from "./lib/x.ts";\n',
    );
    write(root, 'opencode/scripts/lib/x.ts', 'export const x = 1;\n');

    const resolved = resolveOpencodeScripts(root);

    assert.ok(resolved.includes('lib/status.ts'));
    assert.ok(!resolved.some((entry) => entry.includes('x.ts')), 'módulo exclusivo não é canônico');
  });
});

test('resolveOpencodeScripts: entrada ausente falha indicando o path', () => {
  withTempDir((root) => {
    makeScriptsTree(root);
    fs.rmSync(path.join(root, 'scripts', 'vetor-status.sh'));

    assert.throws(() => resolveOpencodeScripts(root), /scripts[\\/]vetor-status\.sh/);
  });
});

test('resolveOpencodeScripts: dependência importada e ausente falha indicando o path e quem importa', () => {
  withTempDir((root) => {
    makeScriptsTree(root);
    fs.rmSync(path.join(root, 'scripts', 'lib', 'c.ts'));

    assert.throws(
      () => resolveOpencodeScripts(root),
      (error) => /lib\/c\.ts/.test(error.message) && /lib\/b\.ts/.test(error.message),
    );
  });
});

test('rewriteNativeScriptImports: reescreve o import do canônico para o layout instalado', () => {
  const source = [
    'import { readJson } from "../../scripts/lib/project.ts";',
    'import { normalizeCwd } from "./lib/cwd.ts";',
    'import { resolveWorktree } from "../../scripts/lib/status.ts";',
    '',
  ].join('\n');

  assert.equal(
    rewriteNativeScriptImports(source, 'scripts/resolve-model.ts'),
    [
      'import { readJson } from "./lib/project.ts";',
      'import { normalizeCwd } from "./lib/cwd.ts";',
      'import { resolveWorktree } from "./lib/status.ts";',
      '',
    ].join('\n'),
  );
});

test('rewriteNativeScriptImports: módulo em lib/ importa o canônico como irmão', () => {
  assert.equal(
    rewriteNativeScriptImports('import { a } from "../../../scripts/lib/a.ts";\n', 'scripts/lib/x.ts'),
    'import { a } from "./a.ts";\n',
  );
});

test('rewriteNativeScriptImports: devolve o conteúdo intacto quando não há import do canônico', () => {
  const source = 'import { x } from "./lib/x.ts";\nimport { assert } from "@std/assert";\n';

  assert.equal(rewriteNativeScriptImports(source, 'scripts/y.ts'), source);
});

// Guarda da issue #477: os oito espelhos não voltam a ser versionados em opencode/scripts/ e o
// resolvedor enxerga o canônico real, inclusive o módulo que a #476 extraiu para scripts/lib/.
test('árvore real: nenhum dos oito arquivos espelhados continua em opencode/scripts/', () => {
  const mirrored = [
    'check-edit.ts',
    'safety-check.ts',
    'vetor-checks.sh',
    'vetor-status.sh',
    'lib/guard.ts',
    'lib/project.ts',
    'lib/status.ts',
    'lib/worktree.ts',
  ];

  const present = mirrored.filter((file) =>
    fs.existsSync(path.join(MONOREPO_ROOT, 'opencode', 'scripts', ...file.split('/'))),
  );

  assert.deepEqual(present, []);
});

test('árvore real: o canônico resolvido cobre os oito arquivos e as dependências novas', () => {
  const resolved = resolveOpencodeScripts(MONOREPO_ROOT);

  for (const entry of OPENCODE_SCRIPT_ENTRIES) assert.ok(resolved.includes(entry), entry);
  for (const dependency of [
    'lib/guard.ts',
    'lib/project.ts',
    'lib/status.ts',
    'lib/worktree.ts',
    'lib/safety-policy.ts',
  ]) {
    assert.ok(resolved.includes(dependency), dependency);
  }
});
