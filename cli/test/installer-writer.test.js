'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { installFiles } = require('../lib/installer/writer.js');
const { manifestPathFor, readManifest } = require('../lib/installer/manifest.js');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-writer-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Cria uma fonte fake com skills/agents/hooks, no mesmo formato esperado pelo writer
// (`sourceRoot/{skills,agents,hooks}/**`), sem depender da árvore real do repo.
function makeFakeSourceRoot() {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-writer-source-'));
  fs.mkdirSync(path.join(sourceRoot, 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'skills', 'demo', 'SKILL.md'), 'conteúdo v1\n');
  fs.mkdirSync(path.join(sourceRoot, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'agents', 'demo.md'), 'agente v1\n');
  fs.mkdirSync(path.join(sourceRoot, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'hooks', 'hooks.json'), '{}\n');
  return sourceRoot;
}

const CLAUDE_ENGINE = { id: 'claude-code', name: 'Claude Code', detected: true };

test('installFiles: copia skills/agents/hooks para o destino da engine e grava manifesto com sha256', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const { copied, skipped } = installFiles({
        projectRoot,
        engines: [CLAUDE_ENGINE],
        sourceRoot,
      });

      assert.equal(skipped.length, 0);
      assert.deepEqual(copied.sort(), [
        '.claude/agents/demo.md',
        '.claude/hooks/hooks.json',
        '.claude/skills/demo/SKILL.md',
      ]);

      const skillDest = path.join(projectRoot, '.claude', 'skills', 'demo', 'SKILL.md');
      assert.equal(fs.readFileSync(skillDest, 'utf8'), 'conteúdo v1\n');

      const manifest = readManifest(projectRoot);
      assert.equal(
        manifest.files['.claude/skills/demo/SKILL.md'].sha256,
        sha256(fs.readFileSync(skillDest)),
      );
      assert.equal(manifest.files['.claude/skills/demo/SKILL.md'].engine, 'claude-code');
      assert.ok(fs.existsSync(manifestPathFor(projectRoot)));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: idempotente — rodar duas vezes seguidas não duplica nem corrompe arquivos', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, engines: [CLAUDE_ENGINE], sourceRoot });
      const secondRun = installFiles({ projectRoot, engines: [CLAUDE_ENGINE], sourceRoot });

      assert.equal(secondRun.skipped.length, 0);
      assert.deepEqual(secondRun.copied.sort(), [
        '.claude/agents/demo.md',
        '.claude/hooks/hooks.json',
        '.claude/skills/demo/SKILL.md',
      ]);

      const skillDest = path.join(projectRoot, '.claude', 'skills', 'demo', 'SKILL.md');
      assert.equal(fs.readFileSync(skillDest, 'utf8'), 'conteúdo v1\n');

      // Não duplica: continua exatamente 1 arquivo no diretório de destino.
      const entries = fs.readdirSync(path.join(projectRoot, '.claude', 'skills', 'demo'));
      assert.deepEqual(entries, ['SKILL.md']);

      const manifest = readManifest(projectRoot);
      assert.equal(Object.keys(manifest.files).length, 3);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: atualiza arquivo não editado pelo usuário quando a fonte muda (update seguro)', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, engines: [CLAUDE_ENGINE], sourceRoot });

      fs.writeFileSync(path.join(sourceRoot, 'skills', 'demo', 'SKILL.md'), 'conteúdo v2\n');
      const { copied, skipped } = installFiles({ projectRoot, engines: [CLAUDE_ENGINE], sourceRoot });

      assert.equal(skipped.length, 0);
      assert.ok(copied.includes('.claude/skills/demo/SKILL.md'));

      const skillDest = path.join(projectRoot, '.claude', 'skills', 'demo', 'SKILL.md');
      assert.equal(fs.readFileSync(skillDest, 'utf8'), 'conteúdo v2\n');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: nunca sobrescreve arquivo editado pelo usuário desde a última instalação', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, engines: [CLAUDE_ENGINE], sourceRoot });

      const skillDest = path.join(projectRoot, '.claude', 'skills', 'demo', 'SKILL.md');
      fs.writeFileSync(skillDest, 'edição do usuário\n');

      fs.writeFileSync(path.join(sourceRoot, 'skills', 'demo', 'SKILL.md'), 'conteúdo v2\n');
      const { copied, skipped } = installFiles({ projectRoot, engines: [CLAUDE_ENGINE], sourceRoot });

      assert.deepEqual(copied.sort(), ['.claude/agents/demo.md', '.claude/hooks/hooks.json']);
      assert.equal(skipped.length, 1);
      assert.equal(skipped[0].path, '.claude/skills/demo/SKILL.md');
      assert.equal(skipped[0].reason, 'user-modified');

      assert.equal(fs.readFileSync(skillDest, 'utf8'), 'edição do usuário\n');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: nunca sobrescreve arquivo pré-existente no destino que não consta no manifesto', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const skillDestDir = path.join(projectRoot, '.claude', 'skills', 'demo');
      fs.mkdirSync(skillDestDir, { recursive: true });
      fs.writeFileSync(path.join(skillDestDir, 'SKILL.md'), 'arquivo do próprio usuário\n');

      const { copied, skipped } = installFiles({ projectRoot, engines: [CLAUDE_ENGINE], sourceRoot });

      assert.ok(!copied.includes('.claude/skills/demo/SKILL.md'));
      const skippedEntry = skipped.find((s) => s.path === '.claude/skills/demo/SKILL.md');
      assert.ok(skippedEntry);
      assert.equal(skippedEntry.reason, 'unmanaged');

      assert.equal(
        fs.readFileSync(path.join(skillDestDir, 'SKILL.md'), 'utf8'),
        'arquivo do próprio usuário\n',
      );
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: copia para múltiplas engines selecionadas, cada uma no seu destino nativo', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const engines = [CLAUDE_ENGINE, { id: 'codex', name: 'Codex', detected: false }];
      const { copied } = installFiles({ projectRoot, engines, sourceRoot });

      assert.ok(copied.includes('.claude/skills/demo/SKILL.md'));
      assert.ok(copied.includes('.codex/skills/demo/SKILL.md'));
      assert.ok(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 'demo', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(projectRoot, '.codex', 'skills', 'demo', 'SKILL.md')));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: engine sem destino conhecido (ex.: Cursor) é ignorada sem erro', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const { copied, skipped } = installFiles({
        projectRoot,
        engines: [{ id: 'cursor', name: 'Cursor', detected: false }],
        sourceRoot,
      });

      assert.deepEqual(copied, []);
      assert.deepEqual(skipped, []);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});
