'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const fs = require('node:fs');
const os = require('node:os');
const { writeManifest } = require('../lib/installer/manifest.js');

const binPath = path.join(__dirname, '..', 'bin', 'vetor.js');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-router-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Issue #269 (achado da PR #268): comandos com nome de propriedade herdada de Object.prototype
// (toString, constructor, valueOf, ...) resolviam para um valor truthy herdado em COMMANDS[command],
// escapando do guard `if (!entry)` e caindo em `entry.fn()` com `entry.fn === undefined` — TypeError
// não tratado em vez do fluxo limpo "Comando desconhecido".
test('vetor toString reporta comando desconhecido em vez de lançar TypeError', () => {
  const result = spawnSync(process.execPath, [binPath, 'toString'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /TypeError/);
  assert.match(result.stderr, /Comando desconhecido: toString/);
});

test('vetor constructor reporta comando desconhecido em vez de lançar TypeError', () => {
  const result = spawnSync(process.execPath, [binPath, 'constructor'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /TypeError/);
  assert.match(result.stderr, /Comando desconhecido: constructor/);
});

// Issue #357: flags após o comando são ignoradas — vetor update --help executa o update
test('vetor update --help exibe ajuda do comando e não executa o update', () => {
  withTempDir((dir) => {
    writeManifest(dir, {
      version: 1,
      files: {
        '.claude/skills/demo/SKILL.md': { sha256: 'abc', engine: 'claude-code' },
      },
    });

    const result = spawnSync(process.execPath, [binPath, 'update', '--help'], {
      cwd: dir,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Uso: vetor update/);
    assert.match(result.stdout, /Atualiza a instalação existente a partir do manifesto/);
    assert.doesNotMatch(result.stdout, /Atualizando engines/);
  });
});

test('vetor update -h exibe ajuda do comando e não executa o update', () => {
  withTempDir((dir) => {
    writeManifest(dir, {
      version: 1,
      files: {
        '.claude/skills/demo/SKILL.md': { sha256: 'abc', engine: 'claude-code' },
      },
    });

    const result = spawnSync(process.execPath, [binPath, 'update', '-h'], {
      cwd: dir,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Uso: vetor update/);
    assert.match(result.stdout, /Atualiza a instalação existente a partir do manifesto/);
    assert.doesNotMatch(result.stdout, /Atualizando engines/);
  });
});

test('vetor status --help exibe ajuda do comando e não executa o status', () => {
  const result = spawnSync(process.execPath, [binPath, 'status', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Uso: vetor status/);
  assert.match(result.stdout, /Mostra o status da instalação por engine/);
});

test('vetor install --help exibe ajuda do comando incluindo as opções --engines e --yes', () => {
  const result = spawnSync(process.execPath, [binPath, 'install', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Uso: vetor install/);
  assert.match(result.stdout, /--engines/);
  assert.match(result.stdout, /-y, --yes/);
});

test('vetor uninstall --help exibe ajuda do comando e não executa o uninstall', () => {
  const result = spawnSync(process.execPath, [binPath, 'uninstall', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Uso: vetor uninstall/);
  assert.match(result.stdout, /Remove os arquivos instalados pelo Vetor/);
  assert.match(result.stdout, /-y, --yes/);
});

test('vetor <cmd> com flag não declarada reporta erro amigável, exit 1 e não executa o comando', () => {
  withTempDir((dir) => {
    writeManifest(dir, {
      version: 1,
      files: {
        '.claude/skills/demo/SKILL.md': { sha256: 'abc', engine: 'claude-code' },
      },
    });

    const result = spawnSync(process.execPath, [binPath, 'update', '--flag-invalida'], {
      cwd: dir,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Opção desconhecida: --flag-invalida/);
    assert.doesNotMatch(result.stdout, /Atualizando engines/);
  });
});

test('router repassa flags declaradas em COMMANDS para options da fn', async () => {
  const { run, COMMANDS } = require('../lib/router.js');
  let receivedOptions;
  COMMANDS.__test_cmd = {
    fn: (_cwd, options) => {
      receivedOptions = options;
    },
    description: 'Comando de teste',
    flags: {
      '--dry-run': { description: 'Dry run', type: 'boolean' },
      '--name': { description: 'Nome', type: 'string' },
    },
  };

  try {
    await run(['__test_cmd', '--dry-run', '--name', 'meu-projeto']);
    assert.ok(receivedOptions);
    assert.equal(receivedOptions.dryRun, true);
    assert.equal(receivedOptions.name, 'meu-projeto');
  } finally {
    delete COMMANDS.__test_cmd;
  }
});

