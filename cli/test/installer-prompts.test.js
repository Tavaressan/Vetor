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

function keypressInput() {
  const input = new PassThrough();
  input.isTTY = true;
  input.rawModes = [];
  input.setRawMode = (enabled) => input.rawModes.push(enabled);
  return input;
}

function press(input, key, sequence = key) {
  input.emit('keypress', sequence, { name: key, ctrl: key === 'c' && sequence === '\u0003' });
}

test('runInstallPrompts (TTY raw): navega, alterna e confirma; restaura raw mode', async () => {
  const input = keypressInput();
  const outputChunks = [];
  const output = { write: (chunk) => outputChunks.push(chunk) };
  const promise = runInstallPrompts([
    { id: 'claude-code', name: 'Claude Code', detected: true },
    { id: 'codex', name: 'Codex', detected: false },
  ], { input, output, isTTY: true });

  press(input, 'down', '\u001b[B');
  press(input, 'space', ' ');
  press(input, 'up', '\u001b[A');
  press(input, 'space', ' ');
  press(input, 'return', '\r');

  const selected = await promise;
  assert.deepEqual(selected.map((engine) => engine.id), ['codex']);
  assert.deepEqual(input.rawModes, [true, false]);
  assert.match(outputChunks.join(''), /❯/);
});

test('runInstallPrompts (TTY raw): confirmar sem seleção pede ao menos uma engine', async () => {
  const input = keypressInput();
  const outputChunks = [];
  const promise = runInstallPrompts(
    [{ id: 'claude-code', name: 'Claude Code', detected: false }],
    { input, output: { write: (chunk) => outputChunks.push(chunk) }, isTTY: true },
  );
  press(input, 'return', '\r');
  press(input, 'space', ' ');
  press(input, 'return', '\r');
  assert.deepEqual((await promise).map((engine) => engine.id), ['claude-code']);
  assert.match(outputChunks.join(''), /Selecione pelo menos uma engine/);
  assert.deepEqual(input.rawModes, [true, false]);
});

test('runInstallPrompts (TTY raw): Escape cancela e restaura raw mode', async () => {
  const input = keypressInput();
  const promise = runInstallPrompts(
    [{ id: 'claude-code', name: 'Claude Code', detected: true }],
    { input, output: { write: () => {} }, isTTY: true },
  );
  press(input, 'escape', '\u001b');
  assert.deepEqual(await promise, []);
  assert.deepEqual(input.rawModes, [true, false]);
  assert.equal(input.listenerCount('keypress'), 0);
});

for (const [label, sequence, key] of [
  ['q', 'q', { name: 'q' }],
  ['Ctrl+C', '\u0003', { name: 'c', ctrl: true }],
]) {
  test(`runInstallPrompts (TTY raw): ${label} cancela e restaura raw mode`, async () => {
    const input = keypressInput();
    const promise = runInstallPrompts(
      [{ id: 'claude-code', name: 'Claude Code', detected: true }],
      { input, output: { write: () => {} }, isTTY: true },
    );
    input.emit('keypress', sequence, key);
    assert.deepEqual(await promise, []);
    assert.deepEqual(input.rawModes, [true, false]);
    assert.equal(input.listenerCount('keypress'), 0);
  });
}


test('runInstallPrompts (TTY raw): redesenha subindo as linhas anteriores sem salvar cursor', async () => {
  const input = keypressInput();
  const outputChunks = [];
  const output = { write: (chunk) => outputChunks.push(chunk) };
  const promise = runInstallPrompts([
    { id: 'claude-code', name: 'Claude Code', detected: true },
    { id: 'codex', name: 'Codex', detected: false },
  ], { input, output, isTTY: true });

  press(input, 'down', '\u001b[B');
  press(input, 'q', 'q');
  assert.deepEqual(await promise, []);

  const rendered = outputChunks.join('');
  assert.match(rendered, /\u001b\[4A\r\u001b\[J/);
  assert.doesNotMatch(rendered, /\u001b\[(?:s|u)/);
  assert.doesNotMatch(rendered, /\n  1\. \[x\]/);
});
