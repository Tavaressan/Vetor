'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const { LOGO_LINES } = require('../lib/banner.js');

const binPath = path.join(__dirname, '..', 'bin', 'vetor.js');

test('vetor sem args imprime o banner ASCII antes da lista de comandos', () => {
  const output = execFileSync(process.execPath, [binPath], { encoding: 'utf8' });

  for (const line of LOGO_LINES) {
    assert.ok(output.includes(line), `banner ausente do stdout: ${line}`);
  }

  const bannerIndex = output.indexOf(LOGO_LINES[0]);
  const commandsIndex = output.indexOf('Comandos:');
  assert.ok(bannerIndex >= 0, 'banner não encontrado no stdout');
  assert.ok(commandsIndex >= 0, 'lista de comandos não encontrada no stdout');
  assert.ok(bannerIndex < commandsIndex, 'banner deve aparecer antes da lista de comandos');
});
