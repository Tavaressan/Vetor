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

test('vetor install --engines antigravity --yes sem TTY instala skills e subagentes com model: inherit em .agents/ e grava manifesto', () => {
  withTempDir((dir) => {
    const result = spawnSync(
      process.execPath,
      [binPath, 'install', '--engines', 'antigravity', '--yes'],
      { cwd: dir, encoding: 'utf8' },
    );

    assert.equal(result.status, 0, `Process failed with stderr: ${result.stderr}`);
    assert.match(result.stdout, /Engines selecionadas: Antigravity/);
    assert.match(result.stdout, /arquivo\(s\) copiado\(s\)/);

    const manifest = readManifest(dir);
    const files = Object.keys(manifest.files);
    assert.ok(files.length > 0, 'Manifesto deve conter arquivos');
    assert.ok(files.some((f) => f.startsWith('.agents/skills/')), 'Skills do antigravity devem ser instaladas em .agents/skills/');
    assert.ok(files.some((f) => f.startsWith('.agents/agents/')), 'Agentes do antigravity devem ser instalados em .agents/agents/');
    assert.ok(!files.some((f) => f.includes('hooks')), 'Hooks não devem ser copiados para antigravity');

    const workerPath = path.join(dir, '.agents', 'agents', 'issue-worker.md');
    assert.ok(fs.existsSync(workerPath), 'issue-worker.md deve existir');
    const workerContent = fs.readFileSync(workerPath, 'utf8');
    assert.match(workerContent, /model:\s*inherit/);
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

// Issue #479: com as cinco engines, as skills do Vetor ocupam no máximo duas raízes
// (`.claude/skills` e `.agents/skills`); nada em `.cursor/skills`.
test('vetor install com as cinco engines grava as skills em .claude/skills e .agents/skills, sem .cursor/skills', () => {
  withTempDir((dir) => {
    const result = spawnSync(
      process.execPath,
      [binPath, 'install', '--engines', 'claude-code,antigravity,cursor,codex,opencode', '--yes'],
      { cwd: dir, encoding: 'utf8' },
    );

    assert.equal(result.status, 0, `Process failed with stderr: ${result.stderr}`);
    const roots = ['.claude', '.agents', '.cursor'].filter((root) => fs.existsSync(path.join(dir, root, 'skills')));
    assert.deepEqual(roots, ['.claude', '.agents']);

    const files = readManifest(dir).files;
    for (const [key, entry] of Object.entries(files)) {
      if (key.startsWith('.claude/skills/')) assert.deepEqual(entry.engines, ['claude-code'], key);
      if (key.startsWith('.agents/skills/')) assert.deepEqual(entry.engines.slice().sort(), ['antigravity', 'codex', 'cursor'], key);
    }
  });
});

test('vetor uninstall --engines retira só as engines informadas e mantém a skill compartilhada até a última', () => {
  withTempDir((dir) => {
    const install = spawnSync(
      process.execPath,
      [binPath, 'install', '--engines', 'claude-code,cursor', '--yes'],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(install.status, 0, `Process failed with stderr: ${install.stderr}`);
    assert.equal(fs.existsSync(path.join(dir, '.cursor', 'skills')), false);

    const partial = spawnSync(
      process.execPath,
      [binPath, 'uninstall', '--engines', 'claude-code', '--yes'],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(partial.status, 0, `Process failed with stderr: ${partial.stderr}`);
    assert.match(partial.stdout, /arquivo\(s\) mantido\(s\) \(em uso por outra engine\)/);
    const afterPartial = Object.keys(readManifest(dir).files);
    const skillKeys = afterPartial.filter((key) => key.startsWith('.claude/skills/'));
    assert.ok(skillKeys.length > 0, 'skills compartilhadas continuam no manifesto');
    assert.ok(skillKeys.every((key) => fs.existsSync(path.join(dir, ...key.split('/')))), 'skills compartilhadas continuam no disco');
    assert.ok(!afterPartial.some((key) => key.startsWith('.claude/agents/')), 'agents só do Claude Code saem do manifesto');
    assert.ok(afterPartial.some((key) => key.startsWith('.cursor/agents/')), 'agents do Cursor continuam');

    const last = spawnSync(
      process.execPath,
      [binPath, 'uninstall', '--engines', 'cursor', '--yes'],
      { cwd: dir, encoding: 'utf8' },
    );
    assert.equal(last.status, 0, `Process failed with stderr: ${last.stderr}`);
    assert.equal(fs.existsSync(path.join(dir, '.vetor', 'install-manifest.json')), false);
    assert.ok(skillKeys.every((key) => !fs.existsSync(path.join(dir, ...key.split('/')))), 'última dona removida: skills saem do disco');
  });
});

// Revisão da PR #491, achado 2: a raiz do Cursor converge na chamada que muda o conjunto de
// engines, então desinstalar a engine antiga não deixa arquivo "em uso por outra engine".
test('vetor install de uma nova engine move o Cursor de raiz e uninstall --engines da antiga não deixa skills órfãs', () => {
  withTempDir((dir) => {
    const run = (...args) => {
      const result = spawnSync(process.execPath, [binPath, ...args], { cwd: dir, encoding: 'utf8' });
      assert.equal(result.status, 0, `Process failed with stderr: ${result.stderr}`);
      return result.stdout;
    };
    const skillKeys = (root) => Object.keys(readManifest(dir).files).filter((key) => key.startsWith(`${root}/skills/`));

    run('install', '--engines', 'cursor', '--yes');
    assert.ok(skillKeys('.cursor').length > 0, 'Cursor sozinho grava em .cursor/skills');

    run('install', '--engines', 'claude-code', '--yes');
    assert.equal(skillKeys('.cursor').length, 0, 'Cursor sai de .cursor/skills na mesma chamada');
    assert.equal(fs.existsSync(path.join(dir, '.cursor', 'skills')), false);

    run('install', '--engines', 'codex', '--yes');
    for (const key of skillKeys('.claude')) {
      assert.deepEqual(readManifest(dir).files[key].engines, ['claude-code'], key);
    }
    for (const key of skillKeys('.agents')) {
      assert.deepEqual(readManifest(dir).files[key].engines.slice().sort(), ['codex', 'cursor'], key);
    }

    const claudeSkills = skillKeys('.claude');
    assert.ok(claudeSkills.length > 0);
    run('uninstall', '--engines', 'claude-code', '--yes');
    assert.ok(claudeSkills.every((key) => !fs.existsSync(path.join(dir, ...key.split('/')))), '.claude/skills não fica órfão');
    assert.ok(skillKeys('.agents').every((key) => fs.existsSync(path.join(dir, ...key.split('/')))), '.agents/skills continua atendendo Cursor e Codex');
  });
});

test('vetor uninstall --engines com ID inválido sai com exit 1 e não remove nada', () => {
  withTempDir((dir) => {
    const cleanRelPath = '.claude/skills/demo/SKILL.md';
    const cleanAbsPath = path.join(dir, cleanRelPath);
    fs.mkdirSync(path.dirname(cleanAbsPath), { recursive: true });
    fs.writeFileSync(cleanAbsPath, 'conteúdo\n', 'utf8');
    writeManifest(dir, {
      version: 1,
      files: { [cleanRelPath]: { sha256: hashContent(Buffer.from('conteúdo\n')), engine: 'claude-code' } },
    });

    const result = spawnSync(
      process.execPath,
      [binPath, 'uninstall', '--engines', 'nao-existe', '--yes'],
      { cwd: dir, encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Engine inválida: nao-existe/);
    assert.equal(fs.existsSync(cleanAbsPath), true);
  });
});
