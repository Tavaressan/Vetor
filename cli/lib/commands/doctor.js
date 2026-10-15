'use strict';

const { spawnSync: defaultSpawnSync } = require('node:child_process');
const { commandExists: defaultCommandExists } = require('../installer/command-exists.js');
const { detectEngines: defaultDetectEngines } = require('../installer/detector.js');

function doctor(cwd = process.cwd(), options = {}) {
  const spawnSync = options.spawnSync ?? defaultSpawnSync;
  const commandExists = options.commandExists ?? defaultCommandExists;
  const detectEngines = options.detectEngines ?? defaultDetectEngines;
  const checks = [
    {
      name: 'Deno',
      ok: commandExists('deno'),
      hint: 'Instale o Deno e adicione-o ao PATH.',
      required: true,
    },
  ];

  let ghResult;
  try {
    ghResult = spawnSync('gh', ['auth', 'status'], { cwd, encoding: 'utf8', shell: false });
  } catch {
    ghResult = { status: 1 };
  }
  checks.push({
    name: 'gh autenticado',
    ok: ghResult.status === 0,
    hint: 'Execute "gh auth login" para autenticar o GitHub CLI.',
    required: true,
  });

  let gitResult;
  try {
    gitResult = spawnSync('git', ['worktree', '-h'], { cwd, encoding: 'utf8', shell: false });
  } catch {
    gitResult = { status: 1 };
  }
  checks.push({
    name: 'Git worktree',
    ok: /git worktree add/i.test(`${gitResult.stdout ?? ''}\n${gitResult.stderr ?? ''}`),
    hint: 'Instale uma versão do Git com suporte a "git worktree".',
    required: true,
  });

  const engines = detectEngines(cwd);
  const detected = engines.filter((engine) => engine.detected).map((engine) => engine.name);
  checks.push({
    name: 'Engines',
    ok: detected.length > 0,
    hint: detected.length > 0 ? `Detectadas: ${detected.join(', ')}.` : 'Nenhuma engine detectada (informativo).',
    required: false,
  });

  for (const check of checks) {
    const label = check.ok ? '[ok]' : (check.required ? '[falha]' : '[info]');
    console.info(`${label} ${check.name}${check.ok && check.required ? '' : ` — ${check.hint}`}`);
  }
  if (checks.some((check) => check.required && !check.ok)) process.exitCode = 1;
}

module.exports = { doctor };
