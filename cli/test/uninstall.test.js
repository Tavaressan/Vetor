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

test('uninstall: options.yes pula confirm e prossegue com a desinstalação', async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, '.claude', 'skills', 'demo', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'conteúdo íntegro\n');
    writeManifest(dir, {
      version: 1,
      files: {
        '.claude/skills/demo/SKILL.md': {
          sha256: hashContent(Buffer.from('conteúdo íntegro\n')),
          engine: 'claude-code',
        },
      },
    });

    let confirmCalled = false;
    const confirm = async () => {
      confirmCalled = true;
      return false;
    };

    const output = await captureInfo(() => uninstall(dir, { yes: true, confirm }));

    assert.equal(confirmCalled, false, 'confirm não deve ser chamado quando yes: true');
    assert.match(output, /1 arquivo\(s\) removido\(s\)/);
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(fs.existsSync(manifestPathFor(dir)), false);
  });
});

test('uninstall: remove skill Codex do destino .agents/skills pelo manifesto', async () => {
  await withTempDir(async (dir) => {
    const filePath = path.join(dir, '.agents', 'skills', 'demo', 'SKILL.md');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'codex skill\n');
    writeManifest(dir, { version: 1, files: { '.agents/skills/demo/SKILL.md': {
      sha256: hashContent(Buffer.from('codex skill\n')), engine: 'codex', engines: ['codex'],
    } } });
    await uninstall(dir, { yes: true });
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(fs.existsSync(manifestPathFor(dir)), false);
  });
});

// Issue #479: skill em diretório compartilhado tem vários donos no manifesto. `--engines`
// retira só a propriedade das engines informadas; o arquivo só sai do disco quando nenhum dono
// resta (e continua íntegro).
function seedSharedFiles(dir, { skillContent = 'skill compartilhada\n', skillManifestContent = skillContent } = {}) {
  const files = {
    '.agents/skills/demo/SKILL.md': [skillContent, skillManifestContent, ['codex', 'cursor']],
    '.cursor/agents/demo.md': ['agente do cursor\n', 'agente do cursor\n', ['cursor']],
  };
  const manifestFiles = {};
  for (const [key, [onDisk, forManifest, engines]] of Object.entries(files)) {
    const file = path.join(dir, ...key.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, onDisk);
    manifestFiles[key] = { sha256: hashContent(Buffer.from(forManifest)), engine: engines[0], engines };
  }
  writeManifest(dir, { version: 1, files: manifestFiles });
  return {
    skill: path.join(dir, '.agents', 'skills', 'demo', 'SKILL.md'),
    agent: path.join(dir, '.cursor', 'agents', 'demo.md'),
  };
}

test('uninstall --engines: desinstalação parcial preserva a skill usada por outra engine e atualiza os donos', async () => {
  await withTempDir(async (dir) => {
    const { skill, agent } = seedSharedFiles(dir);

    const output = await captureInfo(() => uninstall(dir, { yes: true, engines: 'codex' }));

    assert.match(output, /0 arquivo\(s\) removido\(s\)/);
    assert.match(output, /1 arquivo\(s\) mantido\(s\) \(em uso por outra engine\)/);
    assert.equal(fs.existsSync(skill), true);
    assert.equal(fs.existsSync(agent), true);
    const entry = readManifest(dir).files['.agents/skills/demo/SKILL.md'];
    assert.deepEqual(entry.engines, ['cursor']);
    assert.equal(entry.engine, 'cursor');
    assert.deepEqual(Object.keys(readManifest(dir).files).sort(), ['.agents/skills/demo/SKILL.md', '.cursor/agents/demo.md']);
  });
});

test('uninstall --engines: desinstalar a última engine dona remove o arquivo íntegro e a entrada', async () => {
  await withTempDir(async (dir) => {
    const { skill, agent } = seedSharedFiles(dir);
    await captureInfo(() => uninstall(dir, { yes: true, engines: 'codex' }));

    const output = await captureInfo(() => uninstall(dir, { yes: true, engines: 'cursor' }));

    assert.match(output, /2 arquivo\(s\) removido\(s\)/);
    assert.equal(fs.existsSync(skill), false);
    assert.equal(fs.existsSync(agent), false);
    assert.equal(fs.existsSync(manifestPathFor(dir)), false);
  });
});

test('uninstall --engines: informar todas as engines donas ao mesmo tempo remove a skill compartilhada', async () => {
  await withTempDir(async (dir) => {
    const { skill } = seedSharedFiles(dir);

    await captureInfo(() => uninstall(dir, { yes: true, engines: ['codex', 'cursor'] }));

    assert.equal(fs.existsSync(skill), false);
    assert.equal(fs.existsSync(manifestPathFor(dir)), false);
  });
});

test('uninstall --engines: skill compartilhada editada pelo usuário é preservada e continua registrada ao remover a última dona', async () => {
  await withTempDir(async (dir) => {
    const { skill } = seedSharedFiles(dir, { skillContent: 'editada\n', skillManifestContent: 'original\n' });
    await captureInfo(() => uninstall(dir, { yes: true, engines: 'codex' }));

    const output = await captureInfo(() => uninstall(dir, { yes: true, engines: 'cursor' }));

    assert.match(output, /1 arquivo\(s\) removido\(s\)/);
    assert.match(output, /1 arquivo\(s\) preservado\(s\)/);
    assert.equal(fs.readFileSync(skill, 'utf8'), 'editada\n');
    const manifest = readManifest(dir);
    assert.deepEqual(Object.keys(manifest.files), ['.agents/skills/demo/SKILL.md']);
    assert.deepEqual(manifest.files['.agents/skills/demo/SKILL.md'].engines, ['cursor']);
  });
});

test('uninstall --engines: engine sem arquivos no manifesto não altera nada', async () => {
  await withTempDir(async (dir) => {
    const { skill, agent } = seedSharedFiles(dir);

    const output = await captureInfo(() => uninstall(dir, { yes: true, engines: 'opencode' }));

    assert.match(output, /Nada para desinstalar/);
    assert.equal(fs.existsSync(skill), true);
    assert.equal(fs.existsSync(agent), true);
    assert.equal(Object.keys(readManifest(dir).files).length, 2);
  });
});

test('uninstall --engines: ID de engine inválido falha sem remover nada', async () => {
  await withTempDir(async (dir) => {
    const { skill } = seedSharedFiles(dir);
    const previousExitCode = process.exitCode;
    const errors = [];
    const originalError = console.error;
    console.error = (msg) => errors.push(msg);
    try {
      await uninstall(dir, { yes: true, engines: 'codex,nao-existe' });
      assert.equal(process.exitCode, 1);
    } finally {
      console.error = originalError;
      process.exitCode = previousExitCode;
    }

    assert.match(errors.join('\n'), /Engine inválida: nao-existe/);
    assert.equal(fs.existsSync(skill), true);
    assert.deepEqual(readManifest(dir).files['.agents/skills/demo/SKILL.md'].engines, ['codex', 'cursor']);
  });
});

