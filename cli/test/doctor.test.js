'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { doctor } = require('../lib/commands/doctor.js');

async function runDoctor(spawnSync, extra = {}) {
  const lines = [];
  const originalInfo = console.info;
  const previousExitCode = process.exitCode;
  console.info = (line) => lines.push(line);
  process.exitCode = undefined;
  try {
    await doctor('/project', {
      commandExists: () => true,
      spawnSync,
      detectEngines: () => [{ name: 'Claude Code', detected: true }],
      readFileSync: () => { throw new Error('sem config'); },
      ...extra,
    });
    return { output: lines.join('\n'), exitCode: process.exitCode };
  } finally {
    console.info = originalInfo;
    process.exitCode = previousExitCode;
  }
}

test('doctor: pré-requisitos válidos fora de repositório saem com exit 0', async () => {
  const result = await runDoctor((_command, args) => args[0] === 'worktree'
    ? { status: 129, stdout: '', stderr: 'usage: git worktree add ...' }
    : { status: 0 });
  assert.equal(result.exitCode, undefined);
  assert.match(result.output, /\[ok\] Deno/);
  assert.match(result.output, /\[ok\] gh autenticado/);
  assert.match(result.output, /\[ok\] Git worktree/);
  assert.match(result.output, /\[ok\] Engines — Detectadas: Claude Code/);
});

test('doctor: falha na autenticação do gh sai com exit 1 e mostra dica', async () => {
  const result = await runDoctor((_command, args) => args[0] === 'auth'
    ? { status: 1 }
    : args[0] === 'worktree'
    ? { status: 129, stderr: 'usage: git worktree add ...' }
    : { status: 0 });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /\[falha\] gh autenticado/);
  assert.match(result.output, /gh auth login/);
});

test('doctor: Git sem suporte a worktree falha', async () => {
  const result = await runDoctor((_command, args) => args[0] === 'worktree'
    ? { status: 129, stderr: 'usage: git worktree <command>' }
    : { status: 0 });
  assert.equal(result.exitCode, 1);
  assert.match(result.output, /\[falha\] Git worktree/);
});

test('doctor: MCP ai-memory é informativo, com rede injetável', async () => {
  const result = await runDoctor((_command, args) => args[0] === 'worktree'
    ? { status: 129, stderr: 'usage: git worktree add ...' }
    : { status: 0 }, {
    readFileSync: () => JSON.stringify({ mcpServers: { 'ai-memory': { type: 'http', url: 'http://localhost/mcp' } } }),
    fetch: async (_url, init) => {
      assert.equal(JSON.parse(init.body).method, 'initialize');
      throw new Error('offline');
    },
  });
  assert.equal(result.exitCode, undefined);
  assert.match(result.output, /\[info\] ai-memory MCP — indisponível/);
});
