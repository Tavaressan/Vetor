'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveOpencodeSkillFiles } = require('../lib/installer/opencode-skills.js');
const { MONOREPO_ROOT } = require('../scripts/sync-templates.js');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-opencode-skills-test-'));
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

function makeSkillsTree(root) {
  write(root, 'skills/coordinator/SKILL.md', 'Leia `../shared/references/a.md` e `c.md`.\n');
  write(root, 'skills/shared/references/a.md', 'Veja também `b.md` e `nao-existe.md`.\n');
  write(root, 'skills/shared/references/b.md', 'Folha.\n');
  write(root, 'skills/shared/references/c.md', 'Outra folha.\n');
  write(root, 'skills/shared/references/solta.md', 'Ninguém cita este arquivo.\n');
  write(root, 'skills/outra/SKILL.md', 'Não faz parte do OpenCode.\n');
}

test('resolveOpencodeSkillFiles: skill coordinator e as referências citadas, transitivamente', () => {
  withTempDir((root) => {
    makeSkillsTree(root);
    write(root, 'skills/coordinator/extra.md', 'Arquivo de apoio da skill.\n');

    const files = resolveOpencodeSkillFiles(root);

    assert.deepEqual(files.map((file) => file.dest), [
      'skills/coordinator/SKILL.md',
      'skills/coordinator/extra.md',
      'skills/shared/references/a.md',
      'skills/shared/references/b.md',
      'skills/shared/references/c.md',
    ]);
    assert.ok(files.every((file) => fs.existsSync(file.source)));
  });
});

test('resolveOpencodeSkillFiles: skill ausente falha indicando o path', () => {
  withTempDir((root) => {
    write(root, 'skills/shared/references/a.md');

    assert.throws(() => resolveOpencodeSkillFiles(root), /skills[\\/]coordinator/);
  });
});

test('resolveOpencodeSkillFiles: skill sem o diretório de referências ainda é instalável', () => {
  withTempDir((root) => {
    write(root, 'skills/coordinator/SKILL.md', 'Sem referências.\n');

    assert.deepEqual(resolveOpencodeSkillFiles(root).map((file) => file.dest), [
      'skills/coordinator/SKILL.md',
    ]);
  });
});

// Contrato da issue #478: a skill usa `../shared/references/<nome>.md` (relativo ao diretório
// dela), então toda referência citada precisa estar no destino, em `skills/shared/references/`.
test('árvore real: toda referência citada pelo coordinator e pelas próprias referências chega ao destino', () => {
  const dests = new Set(resolveOpencodeSkillFiles(MONOREPO_ROOT).map((file) => file.dest));
  const cited = new Set();
  const pattern = /\.\.\/shared\/references\/([A-Za-z0-9._-]+\.md)/g;

  for (const dest of dests) {
    if (!dest.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(MONOREPO_ROOT, dest), 'utf8');
    for (const match of text.matchAll(pattern)) cited.add(match[1]);
  }

  assert.ok(dests.has('skills/coordinator/SKILL.md'));
  assert.ok(cited.size > 0);
  for (const name of cited) {
    assert.ok(dests.has(`skills/shared/references/${name}`), `${name} não chega ao destino`);
  }
});

test('árvore real: só a skill coordinator é instalada, não as demais skills do plugin', () => {
  const dests = resolveOpencodeSkillFiles(MONOREPO_ROOT).map((file) => file.dest);

  assert.ok(dests.every((dest) =>
    dest.startsWith('skills/coordinator/') || dest.startsWith('skills/shared/references/')
  ));
});
