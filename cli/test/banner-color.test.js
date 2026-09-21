'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const binPath = path.join(__dirname, '..', 'bin', 'vetor.js');

// Issue #269 (achado da PR #268): banner.js emitia códigos ANSI de cor incondicionalmente, sem
// checar se stdout é um TTY nem respeitar a convenção NO_COLOR (https://no-color.org/) — polui a
// saída quando redirecionada para arquivo/pipe (ex.: CI, `vetor --help > log.txt`).
test('vetor --help não emite códigos ANSI quando stdout não é um TTY (pipe)', () => {
  // execFileSync sempre captura stdout via pipe — nunca um TTY — então isTTY é false aqui.
  const output = execFileSync(process.execPath, [binPath, '--help'], { encoding: 'utf8' });
  assert.doesNotMatch(output, /\x1b\[\d+m/);
});

test('vetor --help não emite códigos ANSI quando NO_COLOR está definido', () => {
  const output = execFileSync(process.execPath, [binPath, '--help'], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.doesNotMatch(output, /\x1b\[\d+m/);
});
