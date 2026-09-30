'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readManifest, writeManifest, hashContent } = require('../lib/installer/manifest.js');

const binPath = path.join(__dirname, '..', 'bin', 'vetor.js');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-non-interactive-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('vetor install --engines claude-code --yes sem TTY instala e grava o manifesto em diretório temporário', () => {
  withTempDir((dir) => {
    const result = spawnSync(
      process.execPath,
      [binPath, 'install', '--engines', 'claude-code', '--yes'],
      { cwd: dir, encoding: 'utf8' },
    );

    assert.equal(result.status, 0, `Process failed with stderr: ${result.stderr}`);
    assert.match(result.stdout, /Engines selecionadas: Claude Code/);
    assert.match(result.stdout, /arquivo\(s\) copiado\(s\)/);

    const manifest = readManifest(dir);
    const files = Object.keys(manifest.files);
    assert.ok(files.length > 0, 'Manifesto deve conter arquivos');
    assert.ok(files.some((f) => f.startsWith('.claude/')), 'Arquivos do claude-code devem ser instalados');
  });
});

test('vetor install -y com -engines claude-code instala com short flags', () => {
  withTempDir((dir) => {
    const result = spawnSync(
      process.execPath,
      [binPath, 'install', '--engines', 'claude-code', '-y'],
      { cwd: dir, encoding: 'utf8' },
    );

    assert.equal(result.status, 0, `Process failed with stderr: ${result.stderr}`);
    assert.match(result.stdout, /Engines selecionadas: Claude Code/);

    const manifest = readManifest(dir);
    assert.ok(Object.keys(manifest.files).length > 0);
  });
});

test('vetor install --engines foo --yes sai com exit 1 e lista os ids válidos', () => {
  withTempDir((dir) => {
    const result = spawnSync(
      process.execPath,
      [binPath, 'install', '--engines', 'foo', '--yes'],
      { cwd: dir, encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Engine inválida: foo/);
    assert.match(result.stderr, /Engines disponíveis:/);
    assert.match(result.stderr, /claude-code/);
    assert.match(result.stderr, /codex/);
    assert.match(result.stderr, /opencode/);
    assert.match(result.stderr, /antigravity/);
    assert.match(result.stderr, /cursor/);
  });
});

test('vetor uninstall --yes sem TTY remove os arquivos íntegros e preserva os modificados', () => {
  withTempDir((dir) => {
    const cleanRelPath = '.claude/skills/demo/SKILL.md';
    const cleanAbsPath = path.join(dir, cleanRelPath);
    fs.mkdirSync(path.dirname(cleanAbsPath), { recursive: true });
    fs.writeFileSync(cleanAbsPath, 'conteúdo íntegro\n', 'utf8');

    const modifiedRelPath = '.claude/skills/demo/MODIFIED.md';
    const modifiedAbsPath = path.join(dir, modifiedRelPath);
    fs.writeFileSync(modifiedAbsPath, 'editado pelo usuário\n', 'utf8');

    writeManifest(dir, {
      version: 1,
      files: {
        [cleanRelPath]: {
          sha256: hashContent(Buffer.from('conteúdo íntegro\n')),
          engine: 'claude-code',
        },
        [modifiedRelPath]: {
          sha256: hashContent(Buffer.from('conteúdo original\n')),
          engine: 'claude-code',
        },
      },
    });

    const result = spawnSync(
      process.execPath,
      [binPath, 'uninstall', '--yes'],
      { cwd: dir, encoding: 'utf8' },
    );

    assert.equal(result.status, 0, `Process failed with stderr: ${result.stderr}`);
    assert.match(result.stdout, /1 arquivo\(s\) removido\(s\)/);
    assert.match(result.stdout, /1 arquivo\(s\) preservado\(s\)/);
    assert.equal(fs.existsSync(cleanAbsPath), false, 'Arquivo íntegro deve ser removido');
    assert.equal(fs.existsSync(modifiedAbsPath), true, 'Arquivo modificado deve ser preservado');

    const manifestAfter = readManifest(dir);
    assert.deepEqual(Object.keys(manifestAfter.files), [modifiedRelPath]);
  });
});

test('vetor uninstall -y sem TTY remove arquivos íntegros com flag curta', () => {
  withTempDir((dir) => {
    const cleanRelPath = '.claude/skills/demo/SKILL.md';
    const cleanAbsPath = path.join(dir, cleanRelPath);
    fs.mkdirSync(path.dirname(cleanAbsPath), { recursive: true });
    fs.writeFileSync(cleanAbsPath, 'conteúdo íntegro\n', 'utf8');

    writeManifest(dir, {
      version: 1,
      files: {
        [cleanRelPath]: {
          sha256: hashContent(Buffer.from('conteúdo íntegro\n')),
          engine: 'claude-code',
        },
      },
    });

    const result = spawnSync(
      process.execPath,
      [binPath, 'uninstall', '-y'],
      { cwd: dir, encoding: 'utf8' },
    );

    assert.equal(result.status, 0, `Process failed with stderr: ${result.stderr}`);
    assert.match(result.stdout, /1 arquivo\(s\) removido\(s\)/);
    assert.equal(fs.existsSync(cleanAbsPath), false);
  });
});

test('sem as flags, o comportamento sem TTY não muda (install e uninstall cancelam)', () => {
  withTempDir((dir) => {
    // 1. install sem flags e sem TTY cancela
    const installResult = spawnSync(
      process.execPath,
      [binPath, 'install'],
      { cwd: dir, encoding: 'utf8' },
    );

    assert.equal(installResult.status, 0);
    assert.match(installResult.stdout, /Sessão não-interativa: nenhuma engine selecionada/);
    assert.match(installResult.stdout, /Instalação cancelada/);

    // 2. uninstall sem flags e sem TTY cancela
    const cleanRelPath = '.claude/skills/demo/SKILL.md';
    const cleanAbsPath = path.join(dir, cleanRelPath);
    fs.mkdirSync(path.dirname(cleanAbsPath), { recursive: true });
    fs.writeFileSync(cleanAbsPath, 'conteúdo\n', 'utf8');

    writeManifest(dir, {
      version: 1,
      files: {
        [cleanRelPath]: {
          sha256: hashContent(Buffer.from('conteúdo\n')),
          engine: 'claude-code',
        },
      },
    });

    const uninstallResult = spawnSync(
      process.execPath,
      [binPath, 'uninstall'],
      { cwd: dir, encoding: 'utf8' },
    );

    assert.equal(uninstallResult.status, 0);
    assert.match(uninstallResult.stdout, /Sessão não-interativa: cancelado/);
    assert.match(uninstallResult.stdout, /Desinstalação cancelada/);
    assert.equal(fs.existsSync(cleanAbsPath), true, 'Arquivo deve permanecer intacto');
  });
});
