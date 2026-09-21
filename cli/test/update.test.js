'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { update } = require('../lib/commands/update.js');
const { writeManifest } = require('../lib/installer/manifest.js');

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-update-test-'));
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

test('update: sem manifesto, informa e não lança exceção', async () => {
  await withTempDir(async (dir) => {
    const installFiles = () => {
      throw new Error('installFiles não deveria ser chamado sem instalação prévia');
    };

    const output = await captureInfo(() => update(dir, { installFiles }));

    assert.match(output, /Nenhuma instalação encontrada/);
  });
});

test('update: deriva as engines do manifesto, não de detecção do ambiente', async () => {
  await withTempDir(async (dir) => {
    writeManifest(dir, {
      version: 1,
      files: {
        '.claude/skills/demo/SKILL.md': { sha256: 'abc', engine: 'claude-code' },
      },
    });

    let receivedArgs;
    const installFiles = (args) => {
      receivedArgs = args;
      return { copied: ['.claude/skills/demo/SKILL.md'], skipped: [] };
    };

    const output = await captureInfo(() => update(dir, { installFiles }));

    assert.equal(receivedArgs.projectRoot, dir);
    assert.deepEqual(receivedArgs.engines, [{ id: 'claude-code', name: 'Claude Code' }]);
    assert.match(output, /Atualizando engines: Claude Code/);
    assert.match(output, /1 arquivo\(s\) sincronizado\(s\)/);
  });
});

test('update: arquivo que não existe mais na fonte é reportado como órfão, não apagado', async () => {
  await withTempDir(async (dir) => {
    writeManifest(dir, {
      version: 1,
      files: {
        '.claude/skills/demo/SKILL.md': { sha256: 'abc', engine: 'claude-code' },
        '.claude/skills/descontinuada/SKILL.md': { sha256: 'def', engine: 'claude-code' },
      },
    });

    const filePath = path.join(dir, '.claude', 'skills', 'descontinuada', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'ainda no disco\n');

    // A fonte não tem mais o arquivo descontinuado: installFiles só reporta o que ainda
    // existe na fonte (copied/skipped) — a skill removida não aparece em nenhum dos dois.
    const installFiles = () => ({
      copied: ['.claude/skills/demo/SKILL.md'],
      skipped: [],
    });

    const output = await captureInfo(() => update(dir, { installFiles }));

    assert.match(output, /descontinuada\/SKILL\.md: não existe mais na fonte/);
    assert.equal(fs.existsSync(filePath), true);
  });
});
