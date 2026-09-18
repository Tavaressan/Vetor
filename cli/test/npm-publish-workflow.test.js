'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Issue #258: pipeline de publicação no npm registry.
// Este teste não valida um publish real (isso exigiria NPM_TOKEN e efeito
// externo); ele verifica que o workflow declara os elementos exigidos pelo
// critério de aceite: gatilho por release, checagem de versão existente e
// autenticação via NPM_TOKEN.
const workflowPath = path.join(
  __dirname,
  '..',
  '..',
  '.github',
  'workflows',
  'npm-publish.yml',
);

test('workflow de publish no npm existe e dispara em release published', () => {
  assert.ok(fs.existsSync(workflowPath), `workflow ausente: ${workflowPath}`);
  const content = fs.readFileSync(workflowPath, 'utf8');

  assert.match(content, /release:\s*\n\s*types:\s*\[published\]/);
  assert.match(content, /workflow_dispatch/);
});

test('workflow declara a checagem de versão existente antes do publish', () => {
  const content = fs.readFileSync(workflowPath, 'utf8');

  assert.match(content, /npm view/);
  assert.match(content, /exit 1/);
});

test('a checagem de versão (mesma lógica do workflow) falha para versão já publicada e passa para versão inexistente', () => {
  const { execSync } = require('node:child_process');

  // Duplica a condição usada no step "Falha se a versão já existir no
  // registry" do workflow (não faz parsing do YAML — o snippet é curto e
  // manter as duas cópias em sincronia é mais simples do que extrair e
  // reexecutar shell parseado a partir do YAML).
  const gate = (pkgAtVersion) =>
    execSync(
      `EXISTING=$(npm view "${pkgAtVersion}" version 2>/dev/null || true); if [ -n "$EXISTING" ]; then exit 1; fi; exit 0`,
      { shell: 'bash', encoding: 'utf8' },
    );

  // react@18.2.0 é uma versão real e estável já publicada — a checagem deve
  // barrar o publish (exit 1).
  assert.throws(() => gate('react@18.2.0'));

  // "vetor" está sem publicações no registry hoje (confirmado via `npm view
  // vetor version` -> E404 "Unpublished"), então a versão atual de
  // cli/package.json não existe — a checagem deve liberar o publish (exit 0).
  const { name, version } = require('../package.json');
  assert.doesNotThrow(() => gate(`${name}@${version}`));
});

test('workflow publica usando NPM_TOKEN como NODE_AUTH_TOKEN', () => {
  const content = fs.readFileSync(workflowPath, 'utf8');

  assert.match(content, /npm publish/);
  assert.match(content, /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
});

test('npm publish --dry-run funciona localmente a partir de cli/ (sem publicar)', () => {
  const { execSync } = require('node:child_process');
  const cliRoot = path.join(__dirname, '..');

  // npm publish escreve os "notice"/"warn" em stderr; combinamos os dois
  // fluxos (2>&1) para conseguir asserir o comportamento de dry-run.
  const output = execSync('npm publish --dry-run 2>&1', {
    cwd: cliRoot,
    encoding: 'utf8',
    shell: true,
  });

  assert.match(output, /\(dry-run\)/);
});
