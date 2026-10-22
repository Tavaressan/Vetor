'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scriptPath = path.resolve(__dirname, '..', '..', 'scripts', 'safety-check-antigravity.js');

const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: 'NUL' };

function runHook(payload, { args = [], cwd = process.cwd() } = {}) {
  const stdinInput = payload !== null ? JSON.stringify(payload) : '';
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    input: stdinInput,
    cwd,
    env: gitEnv,
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  const stdout = result.stdout ? result.stdout.trim() : '';
  const stderr = result.stderr ? result.stderr.trim() : '';
  return {
    status: result.status,
    stdout,
    stderr,
    parsed: stdout ? JSON.parse(stdout) : null,
  };
}

test('permite comandos comuns e inócuos', () => {
  const { status, parsed } = runHook({
    toolCall: {
      name: 'run_command',
      args: { CommandLine: 'npm test' },
    },
  });

  assert.equal(status, 0);
  assert.deepEqual(parsed, { decision: 'allow' });
});

test('bloqueia push para branches protegidas (main, master, production)', () => {
  const branches = ['main', 'master', 'production'];
  for (const branch of branches) {
    const { status, parsed } = runHook({
      toolCall: {
        name: 'run_command',
        args: { CommandLine: `git push origin ${branch}` },
      },
    });

    assert.equal(status, 0);
    assert.equal(parsed.decision, 'deny');
    assert.match(parsed.reason, /Push to protected branches/);
  }
});

test('bloqueia push para branch protegida com flags (--force, -u)', () => {
  const { status, parsed } = runHook({
    toolCall: {
      name: 'run_command',
      args: { CommandLine: 'git push --force origin main' },
    },
  });

  assert.equal(status, 0);
  assert.equal(parsed.decision, 'deny');
  assert.match(parsed.reason, /Push to protected branches/);
});

test('permite push para branch de feature não protegida fora de worktree linkado', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-safety-standalone-'));
  try {
    const gitOpts = { cwd: tempDir, encoding: 'utf8', stdio: 'pipe', env: gitEnv };
    spawnSync('git', ['init', '-b', 'feat/test'], gitOpts);
    spawnSync('git', ['config', 'user.name', 'Test'], gitOpts);
    spawnSync('git', ['config', 'user.email', 'test@test.com'], gitOpts);
    spawnSync('git', ['commit', '--allow-empty', '-m', 'init'], gitOpts);

    const { status, parsed } = runHook(
      {
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'git push origin feat/test' },
        },
        cwd: tempDir,
      },
      { cwd: tempDir },
    );

    assert.equal(status, 0);
    assert.deepEqual(parsed, { decision: 'allow' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('bloqueia comandos git destrutivos (reset --hard, clean -f, branch -D, checkout .)', () => {
  const destructiveCommands = [
    'git reset --hard HEAD~1',
    'git clean -fd',
    'git clean -xdf',
    'git branch -D feat/branch',
    'git checkout .',
    'git checkout . ',
  ];

  for (const cmd of destructiveCommands) {
    const { status, parsed } = runHook({
      toolCall: {
        name: 'run_command',
        args: { CommandLine: cmd },
      },
    });

    assert.equal(status, 0);
    assert.equal(parsed.decision, 'deny');
    assert.match(parsed.reason, /comando git destrutivo bloqueado incondicionalmente/);
  }
});

test('permite git checkout em arquivos específicos sem colidir com checkout .', () => {
  const { status, parsed } = runHook({
    toolCall: {
      name: 'run_command',
      args: { CommandLine: 'git checkout .github/workflows/ci.yml' },
    },
  });

  assert.equal(status, 0);
  assert.deepEqual(parsed, { decision: 'allow' });
});

test('trata JSON inválido no stdin com tolerância e permite execução sem travar', () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    input: 'not-valid-json',
    env: gitEnv,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout.trim());
  assert.deepEqual(parsed, { decision: 'allow' });
  assert.match(result.stderr, /JSON inválido recebido no stdin/);
});

test('suporta comando passado via argv como fallback', () => {
  const result = spawnSync(process.execPath, [scriptPath, 'git push origin main'], {
    input: '',
    env: gitEnv,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(parsed.decision, 'deny');
  assert.match(parsed.reason, /Push to protected branches/);
});

test('bloqueia push de worker não-GREEN em worktree linkado e permite quando GREEN', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-safety-wt-test-'));
  try {
    const gitOpts = { cwd: tempDir, encoding: 'utf8', stdio: 'pipe', env: gitEnv };
    const r1 = spawnSync('git', ['init', '-b', 'master'], gitOpts);
    assert.equal(r1.status, 0, `git init falhou: ${r1.stderr}`);
    spawnSync('git', ['config', 'user.name', 'Test'], gitOpts);
    spawnSync('git', ['config', 'user.email', 'test@test.com'], gitOpts);
    const r2 = spawnSync('git', ['commit', '--allow-empty', '-m', 'initial'], gitOpts);
    assert.equal(r2.status, 0, `git commit falhou: ${r2.stderr}`);

    const wtDir = path.join(tempDir, 'wt-feat');
    const r3 = spawnSync('git', ['worktree', 'add', '-b', 'feat/minha-feature', wtDir], gitOpts);
    assert.equal(r3.status, 0, `git worktree add falhou: ${r3.stderr}`);

    // Status file no root com RUNNING
    const statusDir = path.join(tempDir, '.claude', 'vetor', 'status');
    fs.mkdirSync(statusDir, { recursive: true });
    const statusFile = path.join(statusDir, 'feat-minha-feature.md');
    fs.writeFileSync(statusFile, 'Status: RUNNING\n', 'utf8');

    // Teste 1: Não-GREEN deve ser bloqueado
    const blockedRes = runHook(
      {
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'git push origin feat/minha-feature' },
        },
        cwd: wtDir,
      },
      { cwd: wtDir },
    );

    assert.equal(blockedRes.status, 0);
    assert.equal(blockedRes.parsed.decision, 'deny');
    assert.match(blockedRes.parsed.reason, /worker não-GREEN/);

    // Teste 2: Atualizado para GREEN deve ser liberado
    fs.writeFileSync(statusFile, 'Status: GREEN\n', 'utf8');
    const allowedRes = runHook(
      {
        toolCall: {
          name: 'run_command',
          args: { CommandLine: 'git push origin feat/minha-feature' },
        },
        cwd: wtDir,
      },
      { cwd: wtDir },
    );

    assert.equal(allowedRes.status, 0);
    assert.deepEqual(allowedRes.parsed, { decision: 'allow' });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
