'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Issue #255 (redespacho): cli/templates/ estava vazio no publish real — o pacote npm só
// embarca bin/lib/templates (não skills/agents/hooks da raiz do monorepo), então
// `vetor install` a partir do pacote publicado não copiava nada.
//
// Estes testes rodam inteiramente contra diretórios temporários (via os parâmetros
// injetáveis de syncTemplates()/defaultSourceRoot()), nunca contra o cli/templates/ real —
// pack.test.js já cobre a sincronização real via prepack (npm pack/publish --dry-run) e é
// o único arquivo de teste que muta esse diretório, evitando corrida entre arquivos de
// teste rodando em paralelo (comportamento padrão do test runner do Node).
const { syncTemplates, SOURCE_DIRS } = require('../scripts/sync-templates.js');
const { defaultSourceRoot } = require('../lib/installer/writer.js');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-sync-templates-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Cria uma fonte fake com skills/agents/hooks/opencode, no mesmo formato esperado pelo
// sync (`monorepoRoot/{skills,agents,hooks,opencode}/**`), sem depender da árvore real do
// repo.
function makeFakeMonorepoRoot(dir) {
  fs.mkdirSync(path.join(dir, 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills', 'demo', 'SKILL.md'), 'conteúdo v1\n');
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'agents', 'demo.md'), 'agente v1\n');
  fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'hooks', 'hooks.json'), '{}\n');
  // opencode/ (issue #283): árvore-fonte própria do OpenCode, também precisa chegar em
  // templates/ para o pacote publicado — ver ENGINE_NATIVE_SOURCE_DIR em writer.js.
  fs.mkdirSync(path.join(dir, 'opencode', 'agent'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'opencode', 'agent', 'demo.md'), 'opencode agent v1\n');
}

test('syncTemplates: popula templatesDir com skills/, agents/, hooks/, opencode/ de monorepoRoot', () => {
  withTempDir((monorepoRoot) => {
    withTempDir((templatesDir) => {
      makeFakeMonorepoRoot(monorepoRoot);

      const synced = syncTemplates({ monorepoRoot, templatesDir });

      assert.deepEqual(synced.sort(), [...SOURCE_DIRS].sort());
      assert.equal(
        fs.readFileSync(path.join(templatesDir, 'skills', 'demo', 'SKILL.md'), 'utf8'),
        'conteúdo v1\n',
      );
      assert.ok(fs.existsSync(path.join(templatesDir, 'agents', 'demo.md')));
      assert.ok(fs.existsSync(path.join(templatesDir, 'hooks', 'hooks.json')));
      assert.ok(fs.existsSync(path.join(templatesDir, 'opencode', 'agent', 'demo.md')));
    });
  });
});

test('syncTemplates: recria o destino do zero — não deixa arquivo órfão de uma versão anterior', () => {
  withTempDir((monorepoRoot) => {
    withTempDir((templatesDir) => {
      makeFakeMonorepoRoot(monorepoRoot);

      const orphan = path.join(templatesDir, 'skills', 'inexistente-orfao.md');
      fs.mkdirSync(path.dirname(orphan), { recursive: true });
      fs.writeFileSync(orphan, 'arquivo de uma versão anterior da fonte\n');

      syncTemplates({ monorepoRoot, templatesDir });

      assert.ok(!fs.existsSync(orphan), 'arquivo órfão não foi removido pelo sync');
    });
  });
});

test('syncTemplates: preserva templatesDir/.gitkeep (placeholder do diretório versionado)', () => {
  withTempDir((monorepoRoot) => {
    withTempDir((templatesDir) => {
      makeFakeMonorepoRoot(monorepoRoot);
      fs.writeFileSync(path.join(templatesDir, '.gitkeep'), '');

      syncTemplates({ monorepoRoot, templatesDir });

      assert.ok(
        fs.existsSync(path.join(templatesDir, '.gitkeep')),
        '.gitkeep não deveria ser removido pelo sync',
      );
    });
  });
});

test('syncTemplates: pasta ausente na fonte (ex.: hooks/ não existe) não gera erro, só não sincroniza', () => {
  withTempDir((monorepoRoot) => {
    withTempDir((templatesDir) => {
      fs.mkdirSync(path.join(monorepoRoot, 'skills'), { recursive: true });
      fs.writeFileSync(path.join(monorepoRoot, 'skills', 'x.md'), 'x\n');
      // agents/ e hooks/ deliberadamente ausentes de monorepoRoot.

      const synced = syncTemplates({ monorepoRoot, templatesDir });

      assert.deepEqual(synced, ['skills']);
      assert.ok(!fs.existsSync(path.join(templatesDir, 'agents')));
      assert.ok(!fs.existsSync(path.join(templatesDir, 'hooks')));
    });
  });
});

// defaultSourceRoot() (writer.js) decide, em runtime, entre a raiz do monorepo (dev,
// sempre viva) e templates/ (pacote publicado) usando `plugin.json` como marcador —
// ver comentário em writer.js. Testado aqui, hermeticamente, via `packageRoot` injetável.
test('defaultSourceRoot: monorepo checkout (plugin.json presente) usa a raiz do monorepo, não templates/', () => {
  withTempDir((fakeMonorepoRoot) => {
    fs.writeFileSync(path.join(fakeMonorepoRoot, 'plugin.json'), '{}\n');
    const packageRoot = path.join(fakeMonorepoRoot, 'cli');
    fs.mkdirSync(packageRoot, { recursive: true });

    assert.equal(defaultSourceRoot({ packageRoot }), fakeMonorepoRoot);
  });
});

test('defaultSourceRoot: pacote publicado (sem plugin.json) usa templates/ dentro do pacote', () => {
  withTempDir((fakeParent) => {
    // fakeParent simula node_modules/ (ou qualquer diretório-pai sem plugin.json).
    const packageRoot = path.join(fakeParent, 'vetor');
    fs.mkdirSync(packageRoot, { recursive: true });

    assert.equal(defaultSourceRoot({ packageRoot }), path.join(packageRoot, 'templates'));
  });
});
