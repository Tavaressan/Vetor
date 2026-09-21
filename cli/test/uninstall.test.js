'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { uninstall } = require('../lib/commands/uninstall.js');
const { writeManifest, readManifest, hashContent, manifestPathFor } = require('../lib/installer/manifest.js');

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-uninstall-test-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function captureInfo(fn) {
  const lines = [];
  const original = console.info;
  console.info = (msg) => lines.push(msg);
  try {
    await fn();
  } finally {
    console.info = original;
  }
  return lines.join('\n');
}

test('uninstall: sem manifesto, informa e não lança exceção', async () => {
  await withTempDir(async (dir) => {
    const output = await captureInfo(() => uninstall(dir, { confirm: async () => true }));
    assert.match(output, /Nada para desinstalar/);
  });
});

test('uninstall: cancelar a confirmação não apaga nenhum arquivo', async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, '.claude', 'skills', 'demo', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'conteúdo\n');
    writeManifest(dir, {
      version: 1,
      files: {
        '.claude/skills/demo/SKILL.md': {
          sha256: hashContent(Buffer.from('conteúdo\n')),
          engine: 'claude-code',
        },
      },
    });

    const output = await captureInfo(() => uninstall(dir, { confirm: async () => false }));

    assert.match(output, /Desinstalação cancelada/);
    assert.equal(fs.existsSync(filePath), true);
    assert.equal(Object.keys(readManifest(dir).files).length, 1);
  });
});

test('uninstall: remove arquivo íntegro e apaga o manifesto quando nada resta', async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, '.claude', 'skills', 'demo', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'conteúdo\n');
    writeManifest(dir, {
      version: 1,
      files: {
        '.claude/skills/demo/SKILL.md': {
          sha256: hashContent(Buffer.from('conteúdo\n')),
          engine: 'claude-code',
        },
      },
    });

    const output = await captureInfo(() => uninstall(dir, { confirm: async () => true }));

    assert.match(output, /1 arquivo\(s\) removido\(s\)/);
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(fs.existsSync(manifestPathFor(dir)), false);
  });
});

test('uninstall: arquivo editado pelo usuário é preservado e continua no manifesto', async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, '.claude', 'skills', 'demo', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'editado pelo usuário\n');
    writeManifest(dir, {
      version: 1,
      files: {
        '.claude/skills/demo/SKILL.md': {
          sha256: hashContent(Buffer.from('conteúdo original\n')),
          engine: 'claude-code',
        },
      },
    });

    const output = await captureInfo(() => uninstall(dir, { confirm: async () => true }));

    assert.match(output, /0 arquivo\(s\) removido\(s\)/);
    assert.match(output, /1 arquivo\(s\) preservado\(s\)/);
    assert.equal(fs.existsSync(filePath), true);
    assert.equal(Object.keys(readManifest(dir).files).length, 1);
  });
});
