'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { status } = require('../lib/commands/status.js');
const { writeManifest, hashContent } = require('../lib/installer/manifest.js');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-status-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function captureInfo(fn) {
  const lines = [];
  const original = console.info;
  console.info = (msg) => lines.push(msg);
  try {
    fn();
  } finally {
    console.info = original;
  }
  return lines.join('\n');
}

test('status: sem manifesto, informa "não instalado" sem lançar exceção', () => {
  withTempDir((dir) => {
    const output = captureInfo(() => status(dir));
    assert.match(output, /não está instalado/);
  });
});

test('status: arquivo íntegro aparece como ok, modificado como modificado, ausente como ausente', () => {
  withTempDir((dir) => {
    const okFile = path.join(dir, '.claude', 'skills', 'ok', 'SKILL.md');
    const modifiedFile = path.join(dir, '.claude', 'skills', 'modificada', 'SKILL.md');
    fs.mkdirSync(path.dirname(okFile), { recursive: true });
    fs.mkdirSync(path.dirname(modifiedFile), { recursive: true });
    fs.writeFileSync(okFile, 'conteúdo original\n');
    fs.writeFileSync(modifiedFile, 'editado pelo usuário depois da instalação\n');

    writeManifest(dir, {
      version: 1,
      files: {
        '.claude/skills/ok/SKILL.md': {
          sha256: hashContent(Buffer.from('conteúdo original\n')),
          engine: 'claude-code',
        },
        '.claude/skills/modificada/SKILL.md': {
          sha256: hashContent(Buffer.from('conteúdo original diferente\n')),
          engine: 'claude-code',
        },
        '.claude/skills/apagada/SKILL.md': {
          sha256: hashContent(Buffer.from('conteúdo qualquer\n')),
          engine: 'claude-code',
        },
      },
    });

    const output = captureInfo(() => status(dir));

    assert.match(output, /\[ok\] \.claude\/skills\/ok\/SKILL\.md/);
    assert.match(output, /\[modificado\] \.claude\/skills\/modificada\/SKILL\.md/);
    assert.match(output, /\[ausente\] \.claude\/skills\/apagada\/SKILL\.md/);
    assert.match(output, /Claude Code:/);
  });
});
