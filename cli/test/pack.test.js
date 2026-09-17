'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const cliRoot = path.join(__dirname, '..');

// npm sempre inclui alguns arquivos implícitos (package.json, README, LICENSE)
// independente do campo "files" — só o conteúdo de diretório é restrito por ele.
const ALLOWED_PREFIXES = ['bin/', 'lib/', 'templates/'];
const ALLOWED_EXACT = ['package.json', 'README.md', 'LICENSE'];

test('npm pack --dry-run só empacota bin/, lib/ e templates/ (além dos implícitos)', () => {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: cliRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const [pkg] = JSON.parse(output);

  for (const file of pkg.files) {
    const allowed =
      ALLOWED_EXACT.includes(file.path) ||
      ALLOWED_PREFIXES.some((prefix) => file.path.startsWith(prefix));
    assert.ok(allowed, `arquivo inesperado no pacote: ${file.path}`);
  }

  // Garante que o allowlist não está vazio por acidente (ex.: "files" quebrado
  // silenciosamente): os arquivos reais de bin/ e lib/ precisam aparecer.
  const paths = pkg.files.map((file) => file.path);
  assert.ok(paths.includes('bin/vetor.js'), 'bin/vetor.js ausente do pacote');
  assert.ok(paths.includes('lib/router.js'), 'lib/router.js ausente do pacote');
});
