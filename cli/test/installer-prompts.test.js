'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');

const { buildEngineChoices, runInstallPrompts } = require('../lib/installer/prompts.js');

test('buildEngineChoices: engine detectada nasce pré-marcada (checked: true)', () => {
  const engines = [{ id: 'claude-code', name: 'Claude Code', detected: true }];
  const choices = buildEngineChoices(engines);
  assert.equal(choices[0].checked, true);
});

// Critério de aceite da issue #254: mock sem nenhuma engine detectada resulta em nenhuma
// pré-marcação, sem erro.
test('buildEngineChoices: nenhuma engine detectada resulta em nenhuma pré-marcação, sem erro', () => {
  const engines = [
    { id: 'claude-code', name: 'Claude Code', detected: false },
    { id: 'codex', name: 'Codex', detected: false },
    { id: 'opencode', name: 'OpenCode', detected: false },
    { id: 'antigravity', name: 'Antigravity', detected: false },
  ];
  const choices = buildEngineChoices(engines);
  assert.equal(choices.length, 4);
  for (const choice of choices) {
    assert.equal(choice.checked, false);
  }
});

test('buildEngineChoices: lista vazia não lança erro e retorna lista vazia', () => {
  assert.deepEqual(buildEngineChoices([]), []);
});

test('runInstallPrompts (não-TTY): sem confirmação possível, resolve com seleção vazia', async () => {
  const engines = [
    { id: 'claude-code', name: 'Claude Code', detected: true },
    { id: 'codex', name: 'Codex', detected: false },
  ];
  const input = new PassThrough();
  input.isTTY = false;
  const outputChunks = [];
  const output = { write: (chunk) => outputChunks.push(chunk) };

  const promise = runInstallPrompts(engines, { input, output, isTTY: false });
  // Não-TTY: runInstallPrompts deve resolver imediatamente sem interação, mantendo a
  // pré-marcação (nenhuma engine "instala" sem confirmação explícita — aqui não há confirmação
  // possível, então a seleção fica vazia).
  const selected = await promise;
  assert.deepEqual(selected, []);
  assert.match(outputChunks.join(''), /Detected|detectad/i);
});

test('runInstallPrompts (TTY): toggle por número + confirmação retorna as engines marcadas', async () => {
  const engines = [
    { id: 'claude-code', name: 'Claude Code', detected: true },
    { id: 'codex', name: 'Codex', detected: false },
  ];
  const input = new PassThrough();
  const outputChunks = [];
  const output = { write: (chunk) => outputChunks.push(chunk) };

  const promise = runInstallPrompts(engines, { input, output, isTTY: true });

  // Marca Codex (índice 2) e confirma com linha vazia.
  input.write('2\n');
  input.write('\n');

  const selected = await promise;
  assert.deepEqual(
    selected.map((e) => e.id),
    ['claude-code', 'codex'],
  );
});

test('runInstallPrompts (TTY): confirmar sem nenhuma marcação exige ao menos uma engine antes de aceitar', async () => {
  const engines = [{ id: 'claude-code', name: 'Claude Code', detected: false }];
  const input = new PassThrough();
  const outputChunks = [];
  const output = { write: (chunk) => outputChunks.push(chunk) };

  const promise = runInstallPrompts(engines, { input, output, isTTY: true });

  input.write('\n'); // confirma vazio — deve ser rejeitado e re-perguntar
  input.write('1\n'); // marca a única engine
  input.write('\n'); // confirma

  const selected = await promise;
  assert.deepEqual(
    selected.map((e) => e.id),
    ['claude-code'],
  );
  assert.match(outputChunks.join(''), /Selecione pelo menos uma engine/);
});

test('runInstallPrompts (TTY): "q" cancela e retorna seleção vazia', async () => {
  const engines = [{ id: 'claude-code', name: 'Claude Code', detected: true }];
  const input = new PassThrough();
  const output = { write: () => {} };

  const promise = runInstallPrompts(engines, { input, output, isTTY: true });
  input.write('q\n');

  const selected = await promise;
  assert.deepEqual(selected, []);
});
