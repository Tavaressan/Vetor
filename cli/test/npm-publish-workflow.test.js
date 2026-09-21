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

  // Usamos um nome de pacote sintético e aleatório (nunca publicado por
  // ninguém) em vez do nome+versão reais de cli/package.json: o pacote deste
  // projeto ("vetor") ainda não tinha sido publicado quando este teste foi
  // escrito, mas assim que o primeiro `npm publish` real acontecer este caso
  // passaria a falhar permanentemente contra o registry real. O gate não deve
  // depender do estado de publicação do próprio pacote.
  const { randomUUID } = require('node:crypto');
  const unpublishedPkg = `vetor-npm-publish-gate-probe-${randomUUID()}@0.0.0`;
  assert.doesNotThrow(() => gate(unpublishedPkg));
});

test('workflow publica usando NPM_TOKEN como NODE_AUTH_TOKEN', () => {
  const content = fs.readFileSync(workflowPath, 'utf8');

  assert.match(content, /npm publish/);
  assert.match(content, /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/);
});

test('npm publish --dry-run funciona localmente a partir de cli/ (sem publicar)', () => {
  const { execSync } = require('node:child_process');
  const cliRoot = path.join(__dirname, '..');

  // --ignore-scripts: este teste valida só o comportamento de dry-run do npm publish, não
  // o conteúdo de templates/ (isso é responsabilidade de pack.test.js, que roda o prepack
  // real). Pular o hook `prepack` (que sincroniza cli/templates/ a partir da raiz do
  // monorepo, #255 redespacho) evita que este arquivo de teste também mute o diretório
  // real em paralelo com pack.test.js — o test runner do Node roda arquivos de teste em
  // paralelo por padrão, e dois processos rodando o sync ao mesmo tempo sobre o mesmo
  // diretório correriam risco de corrida.
  const output = execSync('npm publish --dry-run --ignore-scripts 2>&1', {
    cwd: cliRoot,
    encoding: 'utf8',
    shell: true,
  });

  assert.match(output, /\(dry-run\)/);
});
