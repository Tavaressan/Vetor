'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { installFiles, defaultSourceRoot } = require('../lib/installer/writer.js');
const { manifestPathFor, readManifest } = require('../lib/installer/manifest.js');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-writer-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

// Cria uma fonte fake com skills/agents/hooks, no mesmo formato esperado pelo writer
// (`sourceRoot/{skills,agents,hooks}/**`), sem depender da árvore real do repo.
//
// `agents/` inclui os 3 formatos que coexistem na fonte real (issue #283):
// `demo.md` (Claude Code/Cursor), `demo/agent.json` (Antigravity) e `demo/codex.toml`
// (Codex) — para provar que cada engine só recebe o seu, não os três.
//
// `opencodeShared: true` acrescenta o que o OpenCode recebe do canônico (scripts e skill do
// coordinator, ver `addFakeOpencodeShared`) — fica fora do padrão para não aparecer na lista de
// arquivos copiados das demais engines.
function makeFakeSourceRoot({ opencodeShared = false } = {}) {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-writer-source-'));
  fs.mkdirSync(path.join(sourceRoot, 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'skills', 'demo', 'SKILL.md'), 'conteúdo v1\n');
  fs.mkdirSync(path.join(sourceRoot, 'agents', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'agents', 'demo.md'), 'agente v1\n');
  fs.writeFileSync(path.join(sourceRoot, 'agents', 'demo', 'agent.json'), '{}\n');
  fs.writeFileSync(path.join(sourceRoot, 'agents', 'demo', 'codex.toml'), 'name = "demo"\n');
  fs.mkdirSync(path.join(sourceRoot, 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash|Edit|Write', hooks: [{ type: 'command', command: 'safety-check' }] },
        ],
      },
    }) + '\n',
  );

  // Árvore nativa do OpenCode (issue #283): já no formato/path que a engine espera —
  // `agent/` (singular), não `agents/`.
  fs.mkdirSync(path.join(sourceRoot, 'opencode', 'agent'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'opencode', 'agent', 'demo.md'), 'opencode agent v1\n');
  fs.mkdirSync(path.join(sourceRoot, 'opencode', 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, 'opencode', 'skills', 'demo', 'SKILL.md'),
    'opencode skill v1\n',
  );

  if (opencodeShared) addFakeOpencodeShared(sourceRoot);

  return sourceRoot;
}

// Issue #477: `.opencode/scripts/` é gerado do canônico em `scripts/` (as quatro entradas
// explícitas mais as dependências locais) e dos módulos exclusivos de `opencode/scripts/`, que
// importam o canônico por caminho real e são reescritos para o layout instalado.
function addFakeOpencodeShared(root, { prefix = '' } = {}) {
  const write = (relPath, content) => {
    const file = path.join(root, prefix, ...relPath.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  write('scripts/check-edit.ts', 'import { isWithin } from "./lib/guard.ts";\n');
  write('scripts/safety-check.ts', 'import { evaluate } from "./lib/safety-policy.ts";\n');
  write('scripts/vetor-checks.sh', '#!/usr/bin/env bash\n');
  write('scripts/vetor-status.sh', '#!/usr/bin/env bash\n');
  write('scripts/lib/guard.ts', 'export const isWithin = 1;\n');
  write('scripts/lib/safety-policy.ts', 'import { status } from "./status.ts";\nexport const evaluate = status;\n');
  write('scripts/lib/status.ts', 'export const status = 1;\n');
  // Issue #478: o agent do OpenCode carrega a skill `coordinator` pela ferramenta `skill`.
  write('skills/coordinator/SKILL.md', 'Leia `../shared/references/ref.md`.\n');
  write('skills/shared/references/ref.md', 'referência v1\n');
  write('skills/shared/references/nao-citada.md', 'ninguém cita\n');
  write(
    'opencode/scripts/resolve-model.ts',
    'import { status } from "../../scripts/lib/status.ts";\nimport { cwd } from "./lib/cwd.ts";\n',
  );
  write('opencode/scripts/lib/cwd.ts', 'export const cwd = 1;\n');
}

const CLAUDE_ENGINE = { id: 'claude-code', name: 'Claude Code', detected: true };

test('installFiles: copia skills/agents/hooks para o destino da engine e grava manifesto com sha256', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const { copied, skipped } = installFiles({
        projectRoot,
        engines: [CLAUDE_ENGINE],
        sourceRoot,
      });

      assert.equal(skipped.length, 0);
      assert.deepEqual(copied.sort(), [
        '.claude/agents/demo.md',
        '.claude/hooks/hooks.json',
        '.claude/skills/demo/SKILL.md',
      ]);

      const skillDest = path.join(projectRoot, '.claude', 'skills', 'demo', 'SKILL.md');
      assert.equal(fs.readFileSync(skillDest, 'utf8'), 'conteúdo v1\n');

      const manifest = readManifest(projectRoot);
      assert.equal(manifest.packageVersion, require('../package.json').version);
      assert.equal(
        manifest.files['.claude/skills/demo/SKILL.md'].sha256,
        sha256(fs.readFileSync(skillDest)),
      );
      assert.equal(manifest.files['.claude/skills/demo/SKILL.md'].engine, 'claude-code');
      assert.ok(fs.existsSync(manifestPathFor(projectRoot)));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: idempotente — rodar duas vezes seguidas não duplica nem corrompe arquivos', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, engines: [CLAUDE_ENGINE], sourceRoot });
      const secondRun = installFiles({ projectRoot, engines: [CLAUDE_ENGINE], sourceRoot });

      assert.equal(secondRun.skipped.length, 0);
      assert.deepEqual(secondRun.copied.sort(), [
        '.claude/agents/demo.md',
        '.claude/hooks/hooks.json',
        '.claude/skills/demo/SKILL.md',
      ]);

      const skillDest = path.join(projectRoot, '.claude', 'skills', 'demo', 'SKILL.md');
      assert.equal(fs.readFileSync(skillDest, 'utf8'), 'conteúdo v1\n');

      // Não duplica: continua exatamente 1 arquivo no diretório de destino.
      const entries = fs.readdirSync(path.join(projectRoot, '.claude', 'skills', 'demo'));
      assert.deepEqual(entries, ['SKILL.md']);

      const manifest = readManifest(projectRoot);
      assert.equal(Object.keys(manifest.files).length, 3);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: atualiza arquivo não editado pelo usuário quando a fonte muda (update seguro)', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, engines: [CLAUDE_ENGINE], sourceRoot });

      fs.writeFileSync(path.join(sourceRoot, 'skills', 'demo', 'SKILL.md'), 'conteúdo v2\n');
      const { copied, skipped } = installFiles({ projectRoot, engines: [CLAUDE_ENGINE], sourceRoot });

      assert.equal(skipped.length, 0);
      assert.ok(copied.includes('.claude/skills/demo/SKILL.md'));

      const skillDest = path.join(projectRoot, '.claude', 'skills', 'demo', 'SKILL.md');
      assert.equal(fs.readFileSync(skillDest, 'utf8'), 'conteúdo v2\n');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: nunca sobrescreve arquivo editado pelo usuário desde a última instalação', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, engines: [CLAUDE_ENGINE], sourceRoot });

      const skillDest = path.join(projectRoot, '.claude', 'skills', 'demo', 'SKILL.md');
      fs.writeFileSync(skillDest, 'edição do usuário\n');

      fs.writeFileSync(path.join(sourceRoot, 'skills', 'demo', 'SKILL.md'), 'conteúdo v2\n');
      const { copied, skipped } = installFiles({ projectRoot, engines: [CLAUDE_ENGINE], sourceRoot });

      assert.deepEqual(copied.sort(), ['.claude/agents/demo.md', '.claude/hooks/hooks.json']);
      assert.equal(skipped.length, 1);
      assert.equal(skipped[0].path, '.claude/skills/demo/SKILL.md');
      assert.equal(skipped[0].reason, 'user-modified');

      assert.equal(fs.readFileSync(skillDest, 'utf8'), 'edição do usuário\n');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: nunca sobrescreve arquivo pré-existente no destino que não consta no manifesto', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const skillDestDir = path.join(projectRoot, '.claude', 'skills', 'demo');
      fs.mkdirSync(skillDestDir, { recursive: true });
      fs.writeFileSync(path.join(skillDestDir, 'SKILL.md'), 'arquivo do próprio usuário\n');

      const { copied, skipped } = installFiles({ projectRoot, engines: [CLAUDE_ENGINE], sourceRoot });

      assert.ok(!copied.includes('.claude/skills/demo/SKILL.md'));
      const skippedEntry = skipped.find((s) => s.path === '.claude/skills/demo/SKILL.md');
      assert.ok(skippedEntry);
      assert.equal(skippedEntry.reason, 'unmanaged');

      assert.equal(
        fs.readFileSync(path.join(skillDestDir, 'SKILL.md'), 'utf8'),
        'arquivo do próprio usuário\n',
      );
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: copia para múltiplas engines selecionadas, cada uma no seu destino nativo', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const engines = [CLAUDE_ENGINE, { id: 'codex', name: 'Codex', detected: false }];
      const { copied } = installFiles({ projectRoot, engines, sourceRoot });

      assert.ok(copied.includes('.claude/skills/demo/SKILL.md'));
      assert.ok(copied.includes('.agents/skills/demo/SKILL.md'));
      assert.ok(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 'demo', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'demo', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(projectRoot, '.codex', 'agents', 'demo.toml')));
      assert.ok(fs.existsSync(path.join(projectRoot, '.codex', 'hooks', 'hooks.json')));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: Codex e Antigravity compartilham uma entrada de skills em .agents', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const { copied } = installFiles({ projectRoot, sourceRoot, engines: [
        { id: 'codex', name: 'Codex' }, { id: 'antigravity', name: 'Antigravity' },
      ] });
      const skillPath = '.agents/skills/demo/SKILL.md';
      assert.equal(copied.filter((key) => key === skillPath).length, 1);
      assert.deepEqual(readManifest(projectRoot).files[skillPath].engines.sort(), ['antigravity', 'codex']);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: preserva skill Codex editada e avisa, sem duplicar em .agents/skills', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const oldFile = path.join(projectRoot, '.codex', 'skills', 'demo', 'SKILL.md');
      fs.mkdirSync(path.dirname(oldFile), { recursive: true });
      fs.writeFileSync(oldFile, 'editada pelo usuário\n');
      const { writeManifest } = require('../lib/installer/manifest.js');
      writeManifest(projectRoot, { version: 1, files: { '.codex/skills/demo/SKILL.md': { sha256: sha256('original\n'), engine: 'codex' } } });
      const { warnings } = installFiles({ projectRoot, engines: [{ id: 'codex', name: 'Codex' }], sourceRoot });
      assert.match(warnings.join('\n'), /editado pelo usuário/);
      assert.equal(fs.readFileSync(oldFile, 'utf8'), 'editada pelo usuário\n');
      assert.equal(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'demo', 'SKILL.md')), false);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: migra skill Codex manifestada de .codex/skills para .agents/skills', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const oldFile = path.join(projectRoot, '.codex', 'skills', 'demo', 'SKILL.md');
      fs.mkdirSync(path.dirname(oldFile), { recursive: true });
      fs.writeFileSync(oldFile, 'conteúdo v1\n');
      const { writeManifest } = require('../lib/installer/manifest.js');
      writeManifest(projectRoot, { version: 1, files: {
        '.codex/skills/demo/SKILL.md': { sha256: sha256('conteúdo v1\n'), engine: 'codex' },
      } });

      installFiles({ projectRoot, engines: [{ id: 'codex', name: 'Codex' }], sourceRoot });
      const manifest = readManifest(projectRoot);
      assert.equal(fs.existsSync(oldFile), false);
      assert.equal(fs.readFileSync(path.join(projectRoot, '.agents', 'skills', 'demo', 'SKILL.md'), 'utf8'), 'conteúdo v1\n');
      assert.ok(fs.existsSync(path.join(projectRoot, '.codex', 'agents', 'demo.toml')));
      assert.ok(fs.existsSync(path.join(projectRoot, '.codex', 'hooks', 'hooks.json')));
      assert.ok(manifest.files['.agents/skills/demo/SKILL.md']);
      assert.ok(!manifest.files['.codex/skills/demo/SKILL.md']);
      assert.equal(fs.existsSync(path.join(projectRoot, '.codex', 'skills')), false);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: não sobrescreve destino existente ao migrar skill Codex e avisa', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const oldFile = path.join(projectRoot, '.codex', 'skills', 'demo', 'SKILL.md');
      const newFile = path.join(projectRoot, '.agents', 'skills', 'demo', 'SKILL.md');
      fs.mkdirSync(path.dirname(oldFile), { recursive: true });
      fs.mkdirSync(path.dirname(newFile), { recursive: true });
      fs.writeFileSync(oldFile, 'gerenciado v1\n');
      fs.writeFileSync(newFile, 'arquivo local\n');
      const { writeManifest } = require('../lib/installer/manifest.js');
      writeManifest(projectRoot, { version: 1, files: { '.codex/skills/demo/SKILL.md': {
        sha256: sha256('gerenciado v1\n'), engine: 'codex',
      } } });
      const { warnings } = installFiles({ projectRoot, engines: [{ id: 'codex', name: 'Codex' }], sourceRoot });
      assert.match(warnings.join('\n'), /destino existente/);
      assert.equal(fs.readFileSync(oldFile, 'utf8'), 'gerenciado v1\n');
      assert.equal(fs.readFileSync(newFile, 'utf8'), 'arquivo local\n');
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: migração bloqueada no Codex não bloqueia Antigravity e é reportada', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const old = path.join(projectRoot, '.codex/skills/demo/SKILL.md');
      fs.mkdirSync(path.dirname(old), { recursive: true }); fs.writeFileSync(old, 'editada\n');
      require('../lib/installer/manifest.js').writeManifest(projectRoot, { version: 1, files: {
        '.codex/skills/demo/SKILL.md': { sha256: sha256('original\n'), engine: 'codex' },
      } });
      const result = installFiles({ projectRoot, sourceRoot, engines: [{ id: 'codex' }, { id: 'antigravity' }] });
      assert.equal(fs.readFileSync(path.join(projectRoot, '.agents/skills/demo/SKILL.md'), 'utf8'), 'conteúdo v1\n');
      assert.ok(result.skipped.some((entry) => entry.path === '.agents/skills/demo/SKILL.md' && /migration/.test(entry.reason)));
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: destino gerenciado idêntico substitui cópia legada e compartilha ownership', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const content = 'conteúdo v1\n';
      for (const key of ['.codex/skills/demo/SKILL.md', '.agents/skills/demo/SKILL.md']) {
        const file = path.join(projectRoot, ...key.split('/')); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
      }
      require('../lib/installer/manifest.js').writeManifest(projectRoot, { version: 1, files: {
        '.codex/skills/demo/SKILL.md': { sha256: sha256(content), engine: 'codex' },
        '.agents/skills/demo/SKILL.md': { sha256: sha256(content), engine: 'antigravity', engines: ['antigravity'] },
      } });
      const result = installFiles({ projectRoot, sourceRoot, engines: [{ id: 'codex' }, { id: 'antigravity' }] });
      assert.equal(fs.existsSync(path.join(projectRoot, '.codex/skills/demo/SKILL.md')), false);
      assert.deepEqual(readManifest(projectRoot).files['.agents/skills/demo/SKILL.md'].engines.sort(), ['antigravity', 'codex']);
      assert.equal(result.warnings.length, 0);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: ignora chaves de migração com traversal ou caminho absoluto', () => {
  withTempDir((projectRoot) => {
    require('../lib/installer/manifest.js').writeManifest(projectRoot, { version: 1, files: {
      '../outside': { sha256: 'x', engine: 'codex' }, '/tmp/outside': { sha256: 'x', engine: 'codex' },
    } });
    installFiles({ projectRoot, engines: [{ id: 'codex' }], sourceRoot: makeFakeSourceRoot() });
    assert.equal(fs.existsSync(path.join(projectRoot, 'outside')), false);
  });
});

test('installFiles: engine sem destino conhecido é ignorada sem erro', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const { copied, skipped } = installFiles({
        projectRoot,
        engines: [{ id: 'unknown-engine', name: 'Unknown', detected: false }],
        sourceRoot,
      });

      assert.deepEqual(copied, []);
      assert.deepEqual(skipped, []);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Issue #256: skills/ e agents/ são descobertos nativamente pelo Cursor em `.cursor/skills/`
// e `.cursor/agents/` sem tradução de formato (ver wiki/Compatibilidade-Cursor.md).
test('installFiles: copia skills/agents para ".cursor/" quando Cursor é selecionada', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const { copied } = installFiles({
        projectRoot,
        engines: [{ id: 'cursor', name: 'Cursor', detected: false }],
        sourceRoot,
      });

      assert.deepEqual(copied.sort(), [
        '.cursor/agents/demo.md',
        '.cursor/hooks.json',
        '.cursor/skills/demo/SKILL.md',
      ]);
      assert.ok(fs.existsSync(path.join(projectRoot, '.cursor', 'skills', 'demo', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(projectRoot, '.cursor', 'agents', 'demo.md')));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Issue #284: o Cursor só carrega hooks de projeto de `.cursor/hooks.json` (arquivo único),
// nunca `.cursor/hooks/hooks.json` (diretório, o formato bruto que installFiles() produzia
// antes desta tradução — copiar e reportar como `copied` era enganoso, pois o arquivo copiado
// era inerte). `hooks/hooks.json` agora é traduzido para o schema nativo do Cursor
// (`cursor-hooks.js`) e gravado como arquivo único em `.cursor/hooks.json`.
test('installFiles: traduz hooks/hooks.json para ".cursor/hooks.json" (schema nativo, arquivo único) quando Cursor é selecionada', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const { copied, skipped } = installFiles({
        projectRoot,
        engines: [{ id: 'cursor', name: 'Cursor', detected: false }],
        sourceRoot,
      });

      // Nunca o caminho de diretório inerte, que o Cursor não descobre.
      assert.ok(!copied.includes('.cursor/hooks/hooks.json'));
      assert.ok(!skipped.some((s) => s.path === '.cursor/hooks/hooks.json'));
      assert.ok(!fs.existsSync(path.join(projectRoot, '.cursor', 'hooks')));

      // Arquivo único na raiz de `.cursor/`, já traduzido.
      assert.ok(copied.includes('.cursor/hooks.json'));
      const hooksDest = path.join(projectRoot, '.cursor', 'hooks.json');
      const translated = JSON.parse(fs.readFileSync(hooksDest, 'utf8'));
      assert.equal(translated.version, 1);
      assert.deepEqual(translated.hooks.preToolUse, [
        { command: 'safety-check', matcher: 'Shell|Write' },
      ]);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Confirma que o tratamento é específico do Cursor: outras engines continuam copiando
// hooks/hooks.json bruto normalmente (writer.js só traduz para o Cursor).
test('installFiles: outras engines continuam copiando hooks/ bruto normalmente (tradução é só do Cursor)', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const { copied } = installFiles({
        projectRoot,
        engines: [
          CLAUDE_ENGINE,
          { id: 'cursor', name: 'Cursor', detected: false },
        ],
        sourceRoot,
      });

      assert.ok(copied.includes('.claude/hooks/hooks.json'));
      assert.ok(!copied.includes('.cursor/hooks/hooks.json'));
      assert.ok(copied.includes('.cursor/hooks.json'));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Issue #284, achado do advisor: o conteúdo gravado em `.cursor/hooks.json` é uma TRADUÇÃO,
// não uma cópia byte-a-byte da fonte — se o manifesto guardasse o hash da fonte em vez do hash
// do que foi gravado, a segunda instalação nunca bateria o hash e reportaria
// `user-modified` para sempre. Este teste prova que a segunda execução permanece idempotente.
test('installFiles: hooks.json traduzido do Cursor é idempotente entre execuções (hash do conteúdo gravado, não da fonte)', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, engines: [{ id: 'cursor', name: 'Cursor', detected: false }], sourceRoot });
      const secondRun = installFiles({
        projectRoot,
        engines: [{ id: 'cursor', name: 'Cursor', detected: false }],
        sourceRoot,
      });

      assert.equal(secondRun.skipped.length, 0);
      assert.ok(secondRun.copied.includes('.cursor/hooks.json'));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Follow-up de code-review da PR #282 (issue #256), achado #1: o manifesto vivia em
// .claude/vetor/install-manifest.json — writeManifest fazia mkdirSync(dirname(...),
// {recursive:true}) e criava .claude/ como efeito colateral de QUALQUER instalação,
// poluindo detectEngines() (uma instalação "Cursor-exclusiva" passaria a reportar
// claude-code: detected: true na próxima execução, só por causa do manifesto). Este teste
// prova que uma instalação só-Cursor não cria .claude/ no projeto-alvo.
test('installFiles: instalação Cursor-exclusiva não cria .claude/ (manifesto vive em .vetor/, não em .claude/vetor/)', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({
        projectRoot,
        engines: [{ id: 'cursor', name: 'Cursor', detected: false }],
        sourceRoot,
      });

      assert.ok(
        !fs.existsSync(path.join(projectRoot, '.claude')),
        'instalação Cursor-exclusiva não deveria criar .claude/ — isso poluiria detectEngines() ' +
          'na próxima execução, reportando claude-code: detected: true falsamente',
      );
      assert.ok(fs.existsSync(manifestPathFor(projectRoot)));
      assert.ok(manifestPathFor(projectRoot).split(path.sep).includes('.vetor'));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Issue #284, achado do advisor: translateHooksForCursor descarta eventos/matchers sem
// equivalente fiel (WorktreeCreate, matcher de SubagentStop) e installCursorHooks calculava
// isso mas jogava fora — a instalação nunca avisava o usuário que uma fração dos hooks não
// tinha tradução, mesmo essa informação já existindo em memória. Este teste prova que o
// resultado de installFiles agora carrega esses avisos.
test('installFiles: reporta em "warnings" os eventos/matchers descartados na tradução de hooks para o Cursor', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-writer-source-'));
    try {
      fs.mkdirSync(path.join(sourceRoot, 'hooks'), { recursive: true });
      fs.writeFileSync(
        path.join(sourceRoot, 'hooks', 'hooks.json'),
        JSON.stringify({
          hooks: {
            SubagentStop: [
              { matcher: 'vetor:issue-worker', hooks: [{ type: 'command', command: 'check-status' }] },
            ],
            WorktreeCreate: [{ hooks: [{ type: 'command', command: 'prepare-worktree' }] }],
          },
        }),
      );

      const { warnings } = installFiles({
        projectRoot,
        engines: [{ id: 'cursor', name: 'Cursor', detected: false }],
        sourceRoot,
      });

      assert.ok(warnings.some((w) => w.includes('WorktreeCreate')));
      assert.ok(warnings.some((w) => w.includes('SubagentStop')));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Issue #283: Codex exige subagentes em `.codex/agents/*.toml` (formato TOML, path
// achatado), não `agents/*.md` (Claude Code) nem `agents/*/agent.json` (Antigravity) — ver
// wiki/Compatibilidade-Codex.md (".codex/agents/ (projeto)").
test('installFiles: traduz agents/<nome>/codex.toml para .codex/agents/<nome>.toml quando Codex é selecionada', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const { copied } = installFiles({
        projectRoot,
        engines: [{ id: 'codex', name: 'Codex', detected: false }],
        sourceRoot,
      });

      assert.ok(copied.includes('.codex/agents/demo.toml'));
      assert.ok(
        fs.readFileSync(path.join(projectRoot, '.codex', 'agents', 'demo.toml'), 'utf8').includes(
          'name = "demo"',
        ),
      );

      // Formatos de outra engine não são copiados para o destino do Codex — arquivo
      // inerte, mesma classe de problema já corrigida para hooks/Cursor.
      assert.ok(!copied.includes('.codex/agents/demo.md'));
      assert.ok(!copied.includes('.codex/agents/demo/agent.json'));
      assert.ok(!fs.existsSync(path.join(projectRoot, '.codex', 'agents', 'demo.md')));
      assert.ok(!fs.existsSync(path.join(projectRoot, '.codex', 'agents', 'demo', 'agent.json')));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: sem eventos descartados, "warnings" vem vazio', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const { warnings } = installFiles({
        projectRoot,
        engines: [{ id: 'cursor', name: 'Cursor', detected: false }],
        sourceRoot,
      });

      assert.deepEqual(warnings, []);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Issue #283: OpenCode tem árvore-fonte própria (`opencode/`), já no formato nativo — não
// os SOURCE_DIRS agnósticos (`skills/`/`agents/`/`hooks/`, que produziriam skills inertes
// por referenciar `$CLAUDE_PLUGIN_ROOT`, e um `agents/` plural que o OpenCode não escaneia).
test('installFiles: copia a árvore opencode/ achatada para .opencode/ quando OpenCode é selecionada', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot({ opencodeShared: true });
    try {
      const { copied } = installFiles({
        projectRoot,
        engines: [{ id: 'opencode', name: 'OpenCode', detected: false }],
        sourceRoot,
      });

      assert.ok(copied.includes('.opencode/agent/demo.md'));
      assert.ok(copied.includes('.opencode/skills/demo/SKILL.md'));
      assert.ok(
        fs.readFileSync(path.join(projectRoot, '.opencode', 'agent', 'demo.md'), 'utf8') ===
          'opencode agent v1\n',
      );

      // SOURCE_DIRS agnósticos (raiz skills/agents/hooks) não são copiados para o
      // OpenCode — só a árvore nativa acima.
      assert.ok(!copied.some((p) => p.startsWith('.opencode/agents/')));
      assert.ok(!copied.some((p) => p.startsWith('.opencode/hooks/')));
      assert.ok(!fs.existsSync(path.join(projectRoot, '.opencode', 'opencode')));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Issue #284, achado do advisor: hooks/hooks.json malformado não pode derrubar a instalação
// inteira (skills/agents de outras engines já processadas no mesmo loop, ou até deste mesmo
// engine se hooks/ não fosse o primeiro de SOURCE_DIRS) sem sequer chegar em writeManifest —
// os arquivos já copiados ficariam em disco sem entrada no manifesto (permanentemente
// "unmanaged"). JSON inválido em hooks.json vira "skipped", não uma exceção.
test('installFiles: hooks/hooks.json malformado não derruba a instalação — reporta skipped e não impede o resto', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      fs.writeFileSync(path.join(sourceRoot, 'hooks', 'hooks.json'), '{ isto não é JSON válido');

      const { copied, skipped } = installFiles({
        projectRoot,
        engines: [{ id: 'cursor', name: 'Cursor', detected: false }],
        sourceRoot,
      });

      assert.ok(copied.includes('.cursor/skills/demo/SKILL.md'));
      assert.ok(copied.includes('.cursor/agents/demo.md'));
      assert.ok(!copied.includes('.cursor/hooks.json'));
      assert.ok(skipped.some((s) => s.path === '.cursor/hooks.json' && s.reason === 'invalid-source'));
      assert.ok(fs.existsSync(manifestPathFor(projectRoot)));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Issue #283 (achado do advisor pós-implementação): defaultSourceRoot() recai sobre
// `<packageRoot>/templates/` no pacote publicado (sem plugin.json ao lado) — o mesmo
// arranjo que cli/scripts/sync-templates.js precisa popular com `opencode/` (não só
// skills/agents/hooks) para o pacote npm real. Este teste prova a integração completa
// (defaultSourceRoot + installFiles) nesse layout, não só o script de sync isoladamente.
test('installFiles: OpenCode resolve via defaultSourceRoot() mesmo no layout de pacote publicado (sem plugin.json, conteúdo em templates/)', () => {
  withTempDir((projectRoot) => {
    const fakeParent = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-writer-pkg-'));
    try {
      // fakeParent simula node_modules/ (sem plugin.json) — packageRoot é o pacote em si.
      const packageRoot = path.join(fakeParent, 'vetor');
      fs.mkdirSync(path.join(packageRoot, 'templates', 'opencode', 'agent'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(packageRoot, 'templates', 'opencode', 'agent', 'demo.md'),
        'opencode agent v1\n',
      );
      addFakeOpencodeShared(packageRoot, { prefix: 'templates' });

      const sourceRoot = defaultSourceRoot({ packageRoot });
      assert.equal(sourceRoot, path.join(packageRoot, 'templates'));

      const { copied } = installFiles({
        projectRoot,
        engines: [{ id: 'opencode', name: 'OpenCode', detected: false }],
        sourceRoot,
      });

      assert.ok(copied.includes('.opencode/agent/demo.md'));
      assert.ok(fs.existsSync(path.join(projectRoot, '.opencode', 'agent', 'demo.md')));
      assert.ok(fs.existsSync(path.join(projectRoot, '.opencode', 'scripts', 'lib', 'safety-policy.ts')));
    } finally {
      fs.rmSync(fakeParent, { recursive: true, force: true });
    }
  });
});

const OPENCODE_SELECTED = [{ id: 'opencode', name: 'OpenCode', detected: false }];

// Issue #477: nenhum dos oito espelhos é versionado em opencode/scripts/; o instalador gera
// `.opencode/scripts/` a partir de `scripts/` — inclusive a dependência nova da #476 — e o plugin
// (`SCRIPTS_DIR = ../scripts`) encontra tudo no destino.
test('installFiles: OpenCode gera .opencode/scripts/ a partir do canônico, com as dependências locais', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot({ opencodeShared: true });
    try {
      const { copied, skipped } = installFiles({
        projectRoot,
        engines: OPENCODE_SELECTED,
        sourceRoot,
      });

      assert.deepEqual(skipped, []);
      for (
        const generated of [
          '.opencode/scripts/check-edit.ts',
          '.opencode/scripts/safety-check.ts',
          '.opencode/scripts/vetor-checks.sh',
          '.opencode/scripts/vetor-status.sh',
          '.opencode/scripts/lib/guard.ts',
          '.opencode/scripts/lib/safety-policy.ts',
          '.opencode/scripts/lib/status.ts',
        ]
      ) {
        assert.ok(copied.includes(generated), `${generated} não foi gerado`);
      }

      const installed = path.join(projectRoot, '.opencode', 'scripts', 'lib', 'safety-policy.ts');
      assert.equal(
        fs.readFileSync(installed, 'utf8'),
        fs.readFileSync(path.join(sourceRoot, 'scripts', 'lib', 'safety-policy.ts'), 'utf8'),
      );
      assert.equal(
        readManifest(projectRoot).files['.opencode/scripts/lib/safety-policy.ts'].engine,
        'opencode',
      );
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: OpenCode reescreve o import do canônico nos módulos exclusivos e preserva o resto', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot({ opencodeShared: true });
    try {
      installFiles({ projectRoot, engines: OPENCODE_SELECTED, sourceRoot });

      const exclusive = fs.readFileSync(
        path.join(projectRoot, '.opencode', 'scripts', 'resolve-model.ts'),
        'utf8',
      );
      assert.equal(
        exclusive,
        'import { status } from "./lib/status.ts";\nimport { cwd } from "./lib/cwd.ts";\n',
      );
      assert.ok(fs.existsSync(path.join(projectRoot, '.opencode', 'scripts', 'lib', 'cwd.ts')));
      // O manifesto guarda o hash do conteúdo reescrito, o que o update seguro compara depois.
      assert.equal(
        readManifest(projectRoot).files['.opencode/scripts/resolve-model.ts'].sha256,
        sha256(exclusive),
      );
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: OpenCode é idempotente com os scripts gerados', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot({ opencodeShared: true });
    try {
      installFiles({ projectRoot, engines: OPENCODE_SELECTED, sourceRoot });
      const second = installFiles({ projectRoot, engines: OPENCODE_SELECTED, sourceRoot });

      assert.deepEqual(second.skipped, []);
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Issue #478: o agent carrega a skill pela ferramenta `skill`; o OpenCode a descobre em
// `.opencode/skills/<nome>/SKILL.md`. Só o coordinator e as referências dele, mantendo o caminho
// relativo `../shared/references/` — não as demais skills do plugin.
test('installFiles: OpenCode instala a skill coordinator e as referências citadas em .opencode/skills/', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot({ opencodeShared: true });
    try {
      const { copied, skipped } = installFiles({
        projectRoot,
        engines: OPENCODE_SELECTED,
        sourceRoot,
      });

      assert.deepEqual(skipped, []);
      assert.ok(copied.includes('.opencode/skills/coordinator/SKILL.md'));
      assert.ok(copied.includes('.opencode/skills/shared/references/ref.md'));
      assert.ok(!copied.includes('.opencode/skills/shared/references/nao-citada.md'));
      // `skills/demo/` é uma skill do plugin que o OpenCode não recebe; a de
      // `opencode/skills/demo/` (árvore nativa) continua sendo copiada como antes.
      assert.equal(
        fs.readFileSync(path.join(projectRoot, '.opencode', 'skills', 'demo', 'SKILL.md'), 'utf8'),
        'opencode skill v1\n',
      );

      // A skill resolve a referência pelo caminho relativo que ela mesma usa.
      const skillDir = path.join(projectRoot, '.opencode', 'skills', 'coordinator');
      assert.ok(fs.existsSync(path.join(skillDir, '..', 'shared', 'references', 'ref.md')));
      assert.equal(readManifest(projectRoot).files['.opencode/skills/coordinator/SKILL.md'].engine, 'opencode');
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: OpenCode falha indicando o path quando a skill coordinator some da fonte', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot({ opencodeShared: true });
    try {
      fs.rmSync(path.join(sourceRoot, 'skills', 'coordinator'), { recursive: true });

      assert.throws(
        () => installFiles({ projectRoot, engines: OPENCODE_SELECTED, sourceRoot }),
        /skills\/coordinator\/SKILL\.md/,
      );
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: OpenCode falha indicando o path quando uma dependência canônica some', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot({ opencodeShared: true });
    try {
      fs.rmSync(path.join(sourceRoot, 'scripts', 'lib', 'safety-policy.ts'));

      assert.throws(
        () => installFiles({ projectRoot, engines: OPENCODE_SELECTED, sourceRoot }),
        /lib\/safety-policy\.ts/,
      );
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

test('installFiles: OpenCode recusa um espelho de script canônico versionado em opencode/scripts/', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot({ opencodeShared: true });
    try {
      fs.writeFileSync(path.join(sourceRoot, 'opencode', 'scripts', 'lib', 'status.ts'), 'export const status = 2;\n');

      assert.throws(
        () => installFiles({ projectRoot, engines: OPENCODE_SELECTED, sourceRoot }),
        /opencode\/scripts\/lib\/status\.ts/,
      );
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Issue #397 (decisão da #337): a doc oficial do Antigravity (antigravity.google/docs/subagents,
// consultada em 2026-10-15 e reconfirmada em 2026-10-19) define `.agents/agents/<name>.md` como
// caminho de descoberta de subagentes no workspace (e `.agents/skills/<name>/SKILL.md` para
// skills). Selecionar Antigravity instala `skills/` e `agents/*.md` em `.agents/`, excluindo
// formatos de outras engines (`codex.toml`, `agent.json` legado) e `hooks/` (que no Antigravity
// usa schema próprio e arquivo único `.agents/hooks.json`, não diretório `.agents/hooks/`).
test('installFiles: copia skills/ e agents/*.md para ".agents/" quando Antigravity é selecionada, excluindo codex.toml/agent.json/hooks', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const { copied, skipped, enginesSkipped } = installFiles({
        projectRoot,
        engines: [{ id: 'antigravity', name: 'Antigravity', detected: true }],
        sourceRoot,
      });

      assert.equal(skipped.length, 0);
      assert.deepEqual(enginesSkipped, []);
      assert.deepEqual(copied.sort(), [
        '.agents/agents/demo.md',
        '.agents/skills/demo/SKILL.md',
      ]);
      assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'agents', 'demo.md')));
      assert.ok(fs.existsSync(path.join(projectRoot, '.agents', 'skills', 'demo', 'SKILL.md')));
      assert.ok(!fs.existsSync(path.join(projectRoot, '.agents', 'agents', 'demo', 'agent.json')));
      assert.ok(!fs.existsSync(path.join(projectRoot, '.agents', 'agents', 'demo', 'codex.toml')));
      assert.ok(!fs.existsSync(path.join(projectRoot, '.agents', 'hooks')));
      assert.ok(!fs.existsSync(path.join(projectRoot, '.antigravity')));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Issue #397: os agentes reais em `agents/*.md` usam `model: inherit` e listas YAML em `tools`
// (e `skills` em issue-worker.md) para passar no `agy plugin validate .` sem erros nem skipped,
// e os antigos `agents/*/agent.json` (ignorados por builds externas do Antigravity) foram aposentados.
test('agents/*.md reais: usam model: inherit e listas YAML compatíveis com agy plugin validate, sem agent.json legado', () => {
  const repoRoot = path.join(__dirname, '..', '..');
  const workerPath = path.join(repoRoot, 'agents', 'issue-worker.md');
  const reviewPath = path.join(repoRoot, 'agents', 'code-review.md');

  const workerContent = fs.readFileSync(workerPath, 'utf8');
  const reviewContent = fs.readFileSync(reviewPath, 'utf8');

  assert.match(workerContent, /^model:\s*inherit\r?$/m);
  assert.match(reviewContent, /^model:\s*inherit\r?$/m);
  assert.match(workerContent, /^tools:\s*\[.+\]\r?$/m);
  assert.match(workerContent, /^skills:\s*\[.+\]\r?$/m);
  assert.match(reviewContent, /^tools:\s*\[.+\]\r?$/m);

  assert.ok(!fs.existsSync(path.join(repoRoot, 'agents', 'issue-worker', 'agent.json')));
  assert.ok(!fs.existsSync(path.join(repoRoot, 'agents', 'code-review', 'agent.json')));
});

// Issue #396: Cursor aceita "inherit" ou um ID específico em `model` no frontmatter de
// `.cursor/agents/*.md`, enquanto os `agents/*.md` da fonte usam os aliases do Claude Code
// (`haiku`/`sonnet`). Na cópia para `.cursor/agents/`, o instalador grava `model: inherit`
// (com hash do conteúdo transformado no manifesto para manter a reinstalação idempotente),
// preservando `model: haiku`/`sonnet` nas cópias do Claude Code.
test('installFiles: grava "model: inherit" em .cursor/agents/*.md no lugar de haiku|sonnet, preservando Claude Code e idempotência', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot({ opencodeShared: true });
    try {
      fs.writeFileSync(
        path.join(sourceRoot, 'agents', 'issue-worker.md'),
        '---\nname: issue-worker\nmodel: haiku\nisolation: worktree\n---\n\nCorpo do worker.\n',
      );
      fs.writeFileSync(
        path.join(sourceRoot, 'agents', 'code-review.md'),
        '---\nname: code-review\nmodel: sonnet\n---\n\nCorpo do revisor.\n',
      );

      const cursorEngine = { id: 'cursor', name: 'Cursor', detected: false };
      const firstRun = installFiles({
        projectRoot,
        engines: [CLAUDE_ENGINE, cursorEngine],
        sourceRoot,
      });

      assert.equal(firstRun.skipped.length, 0);

      const cursorWorkerDest = path.join(projectRoot, '.cursor', 'agents', 'issue-worker.md');
      const cursorReviewDest = path.join(projectRoot, '.cursor', 'agents', 'code-review.md');
      const claudeWorkerDest = path.join(projectRoot, '.claude', 'agents', 'issue-worker.md');
      const claudeReviewDest = path.join(projectRoot, '.claude', 'agents', 'code-review.md');

      assert.match(fs.readFileSync(cursorWorkerDest, 'utf8'), /^model: inherit$/m);
      assert.doesNotMatch(fs.readFileSync(cursorWorkerDest, 'utf8'), /^model: haiku$/m);
      assert.match(fs.readFileSync(cursorReviewDest, 'utf8'), /^model: inherit$/m);
      assert.doesNotMatch(fs.readFileSync(cursorReviewDest, 'utf8'), /^model: sonnet$/m);

      // As cópias do Claude Code ficam como estão.
      assert.match(fs.readFileSync(claudeWorkerDest, 'utf8'), /^model: haiku$/m);
      assert.match(fs.readFileSync(claudeReviewDest, 'utf8'), /^model: sonnet$/m);

      // O manifesto guarda o hash do conteúdo efetivamente gravado, mantendo a 2ª execução idempotente.
      const manifest = readManifest(projectRoot);
      assert.equal(
        manifest.files['.cursor/agents/issue-worker.md'].sha256,
        sha256(fs.readFileSync(cursorWorkerDest)),
      );

      const secondRun = installFiles({
        projectRoot,
        engines: [cursorEngine],
        sourceRoot,
      });
      assert.equal(secondRun.skipped.length, 0);
      assert.ok(secondRun.copied.includes('.cursor/agents/issue-worker.md'));
      assert.ok(secondRun.copied.includes('.cursor/agents/code-review.md'));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Issue #479: Cursor lê skills de `.agents/skills/`, `.claude/skills/` e `.cursor/skills/`
// (cursor.com/docs/skills, consultada em 2026-10-23). Quando outra engine selecionada já grava
// skills numa dessas raízes, o Cursor passa a ser atendido por ela em vez de ganhar uma terceira
// cópia; agents e hooks do Cursor continuam em `.cursor/`.
const CURSOR_ENGINE = { id: 'cursor', name: 'Cursor' };
const ANTIGRAVITY_ENGINE = { id: 'antigravity', name: 'Antigravity' };
const CODEX_ENGINE = { id: 'codex', name: 'Codex' };
const OPENCODE_ENGINE = { id: 'opencode', name: 'OpenCode' };

function skillOwners(projectRoot, root) {
  return readManifest(projectRoot).files[`${root}/skills/demo/SKILL.md`]?.engines.slice().sort();
}

function skillExists(projectRoot, root) {
  return fs.existsSync(path.join(projectRoot, root, 'skills', 'demo', 'SKILL.md'));
}

// Grava uma skill como se um `install` anterior a tivesse gerenciado: arquivo em disco mais a
// entrada no manifesto. `manifestContent` diferente de `content` simula edição do usuário.
function writeManagedSkill(projectRoot, root, content, owners, { manifestContent = content } = {}) {
  const { writeManifest } = require('../lib/installer/manifest.js');
  const file = path.join(projectRoot, root, 'skills', 'demo', 'SKILL.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  const manifest = readManifest(projectRoot);
  manifest.files[`${root}/skills/demo/SKILL.md`] = { sha256: sha256(manifestContent), engine: owners[0], engines: owners };
  writeManifest(projectRoot, manifest);
  return file;
}

test('installFiles: Cursor + Antigravity compartilham .agents/skills e não gravam .cursor/skills', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, sourceRoot, engines: [CURSOR_ENGINE, ANTIGRAVITY_ENGINE] });

      assert.deepEqual(skillOwners(projectRoot, '.agents'), ['antigravity', 'cursor']);
      assert.equal(fs.existsSync(path.join(projectRoot, '.cursor', 'skills')), false);
      // Só as skills são compartilhadas: agents e hooks do Cursor continuam em `.cursor/`.
      assert.ok(fs.existsSync(path.join(projectRoot, '.cursor', 'agents', 'demo.md')));
      assert.ok(fs.existsSync(path.join(projectRoot, '.cursor', 'hooks.json')));
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: Cursor + Codex compartilham .agents/skills', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, sourceRoot, engines: [CODEX_ENGINE, CURSOR_ENGINE] });

      assert.deepEqual(skillOwners(projectRoot, '.agents'), ['codex', 'cursor']);
      assert.equal(skillExists(projectRoot, '.cursor'), false);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: Cursor + Claude Code sem Codex nem Antigravity compartilham .claude/skills', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot({ opencodeShared: true });
    try {
      installFiles({ projectRoot, sourceRoot, engines: [CURSOR_ENGINE, CLAUDE_ENGINE, OPENCODE_ENGINE] });

      assert.deepEqual(skillOwners(projectRoot, '.claude'), ['claude-code', 'cursor']);
      assert.equal(skillExists(projectRoot, '.cursor'), false);
      assert.equal(skillExists(projectRoot, '.agents'), false);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: Cursor + OpenCode (que não grava skills genéricas) continua em .cursor/skills', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot({ opencodeShared: true });
    try {
      installFiles({ projectRoot, sourceRoot, engines: [CURSOR_ENGINE, OPENCODE_ENGINE] });

      assert.deepEqual(skillOwners(projectRoot, '.cursor'), ['cursor']);
      assert.equal(skillExists(projectRoot, '.agents'), false);
      assert.equal(skillExists(projectRoot, '.claude'), false);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: com as cinco engines as skills ficam em no máximo duas raízes e .claude/skills é só do Claude Code', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot({ opencodeShared: true });
    try {
      installFiles({
        projectRoot,
        sourceRoot,
        engines: [CLAUDE_ENGINE, ANTIGRAVITY_ENGINE, CURSOR_ENGINE, CODEX_ENGINE, OPENCODE_ENGINE],
      });

      const roots = ['.claude', '.agents', '.cursor'].filter((root) => skillExists(projectRoot, root));
      assert.deepEqual(roots, ['.claude', '.agents']);
      assert.deepEqual(skillOwners(projectRoot, '.claude'), ['claude-code']);
      assert.deepEqual(skillOwners(projectRoot, '.agents'), ['antigravity', 'codex', 'cursor']);
      assert.equal(fs.existsSync(path.join(projectRoot, '.cursor', 'skills')), false);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: o destino do Cursor considera as engines já instaladas no manifesto, não só a seleção', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, sourceRoot, engines: [CLAUDE_ENGINE] });
      installFiles({ projectRoot, sourceRoot, engines: [CURSOR_ENGINE] });

      assert.deepEqual(skillOwners(projectRoot, '.claude'), ['claude-code', 'cursor']);
      assert.equal(fs.existsSync(path.join(projectRoot, '.cursor', 'skills')), false);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: skill compartilhada editada pelo usuário não é sobrescrita nem ganha o Cursor como dono', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, sourceRoot, engines: [ANTIGRAVITY_ENGINE] });
      const shared = path.join(projectRoot, '.agents', 'skills', 'demo', 'SKILL.md');
      fs.writeFileSync(shared, 'editada\n');

      const { skipped } = installFiles({ projectRoot, sourceRoot, engines: [CURSOR_ENGINE, ANTIGRAVITY_ENGINE] });

      assert.equal(fs.readFileSync(shared, 'utf8'), 'editada\n');
      assert.deepEqual(skillOwners(projectRoot, '.agents'), ['antigravity']);
      // Arquivo compartilhado é tentado uma vez por dono, mas reportado uma vez só.
      assert.deepEqual(
        skipped.filter((entry) => entry.path === '.agents/skills/demo/SKILL.md'),
        [{ path: '.agents/skills/demo/SKILL.md', reason: 'user-modified' }],
      );
      assert.equal(fs.existsSync(path.join(projectRoot, '.cursor', 'skills')), false);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: migra skill do Cursor íntegra de .cursor/skills para a raiz compartilhada e retira a entrada antiga', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const legacy = writeManagedSkill(projectRoot, '.cursor', 'conteúdo antigo\n', ['cursor']);

      const { migrated, warnings } = installFiles({
        projectRoot, sourceRoot, engines: [CURSOR_ENGINE, ANTIGRAVITY_ENGINE],
      });

      const manifest = readManifest(projectRoot);
      assert.equal(fs.existsSync(legacy), false);
      assert.equal(fs.existsSync(path.join(projectRoot, '.cursor', 'skills')), false);
      assert.ok(fs.existsSync(path.join(projectRoot, '.cursor', 'agents', 'demo.md')), '.cursor/ em si não é removido');
      assert.equal(manifest.files['.cursor/skills/demo/SKILL.md'], undefined);
      assert.deepEqual(skillOwners(projectRoot, '.agents'), ['antigravity', 'cursor']);
      assert.equal(fs.readFileSync(path.join(projectRoot, '.agents', 'skills', 'demo', 'SKILL.md'), 'utf8'), 'conteúdo v1\n');
      assert.deepEqual(migrated, [{ from: '.cursor/skills/demo/SKILL.md', to: '.agents/skills/demo/SKILL.md' }]);
      assert.deepEqual(warnings, []);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: migração descarta a cópia antiga do Cursor quando o destino compartilhado já está gerenciado', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, sourceRoot, engines: [CLAUDE_ENGINE] });
      const legacy = writeManagedSkill(projectRoot, '.cursor', 'conteúdo v1\n', ['cursor']);

      const { migrated } = installFiles({ projectRoot, sourceRoot, engines: [CURSOR_ENGINE, CLAUDE_ENGINE] });

      assert.equal(fs.existsSync(legacy), false);
      assert.equal(migrated.length, 1);
      assert.deepEqual(skillOwners(projectRoot, '.claude'), ['claude-code', 'cursor']);
      assert.equal(readManifest(projectRoot).files['.cursor/skills/demo/SKILL.md'], undefined);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: migrações legadas do Codex e do Cursor para a mesma skill convergem em .agents/skills com os dois donos', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const codexLegacy = writeManagedSkill(projectRoot, '.codex', 'conteúdo antigo\n', ['codex']);
      const cursorLegacy = writeManagedSkill(projectRoot, '.cursor', 'conteúdo antigo\n', ['cursor']);

      const { migrated, warnings } = installFiles({ projectRoot, sourceRoot, engines: [CODEX_ENGINE, CURSOR_ENGINE] });

      assert.equal(fs.existsSync(codexLegacy), false);
      assert.equal(fs.existsSync(cursorLegacy), false);
      assert.deepEqual(skillOwners(projectRoot, '.agents'), ['codex', 'cursor']);
      assert.deepEqual(migrated, [{ from: '.cursor/skills/demo/SKILL.md', to: '.agents/skills/demo/SKILL.md' }]);
      assert.deepEqual(warnings, []);
      const keys = Object.keys(readManifest(projectRoot).files).filter((key) => key.includes('/skills/'));
      assert.deepEqual(keys, ['.agents/skills/demo/SKILL.md']);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: migração preserva skill do Cursor editada, avisa e mantém a entrada antiga', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const legacy = writeManagedSkill(projectRoot, '.cursor', 'editada pelo usuário\n', ['cursor'], {
        manifestContent: 'original\n',
      });

      const { migrated, warnings, skipped } = installFiles({
        projectRoot, sourceRoot, engines: [CURSOR_ENGINE, ANTIGRAVITY_ENGINE],
      });

      assert.equal(fs.readFileSync(legacy, 'utf8'), 'editada pelo usuário\n');
      assert.deepEqual(migrated, []);
      assert.match(warnings.join('\n'), /\.cursor\/skills\/demo\/SKILL\.md: arquivo editado pelo usuário/);
      assert.ok(skipped.some((entry) => entry.path === '.cursor/skills/demo/SKILL.md' && entry.reason === 'user-modified'));
      assert.equal(readManifest(projectRoot).files['.cursor/skills/demo/SKILL.md'].sha256, sha256('original\n'));
      // A cópia compartilhada, íntegra, continua sendo gravada e atende o Cursor.
      assert.deepEqual(skillOwners(projectRoot, '.agents'), ['antigravity', 'cursor']);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: migração não sobrescreve destino compartilhado editado e não registra o Cursor como dono', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, sourceRoot, engines: [ANTIGRAVITY_ENGINE] });
      const shared = path.join(projectRoot, '.agents', 'skills', 'demo', 'SKILL.md');
      fs.writeFileSync(shared, 'editada no destino\n');
      const legacy = writeManagedSkill(projectRoot, '.cursor', 'conteúdo antigo\n', ['cursor']);

      const { migrated, warnings } = installFiles({
        projectRoot, sourceRoot, engines: [CURSOR_ENGINE, ANTIGRAVITY_ENGINE],
      });

      assert.equal(fs.readFileSync(shared, 'utf8'), 'editada no destino\n');
      assert.equal(fs.readFileSync(legacy, 'utf8'), 'conteúdo antigo\n');
      assert.deepEqual(migrated, []);
      assert.match(warnings.join('\n'), /migração de \.cursor\/skills\/demo\/SKILL\.md ignorada/);
      assert.deepEqual(skillOwners(projectRoot, '.agents'), ['antigravity']);
      assert.ok(readManifest(projectRoot).files['.cursor/skills/demo/SKILL.md']);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: .cursor/skills fora do manifesto é preservado e não recebe novas skills do Vetor', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const own = path.join(projectRoot, '.cursor', 'skills', 'minha', 'SKILL.md');
      fs.mkdirSync(path.dirname(own), { recursive: true });
      fs.writeFileSync(own, 'skill do usuário\n');

      installFiles({ projectRoot, sourceRoot, engines: [CURSOR_ENGINE, ANTIGRAVITY_ENGINE] });

      assert.equal(fs.readFileSync(own, 'utf8'), 'skill do usuário\n');
      assert.equal(skillExists(projectRoot, '.cursor'), false);
      assert.deepEqual(skillOwners(projectRoot, '.agents'), ['antigravity', 'cursor']);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: Cursor que passa a ficar sozinho recebe de volta em .cursor/skills a skill que só ele usa', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      // Estado deixado por `uninstall --engines claude-code`: o Cursor é o único dono restante.
      writeManagedSkill(projectRoot, '.claude', 'conteúdo v1\n', ['cursor']);

      const { migrated } = installFiles({ projectRoot, sourceRoot, engines: [CURSOR_ENGINE] });

      assert.deepEqual(migrated, [{ from: '.claude/skills/demo/SKILL.md', to: '.cursor/skills/demo/SKILL.md' }]);
      assert.equal(skillExists(projectRoot, '.claude'), false);
      assert.deepEqual(skillOwners(projectRoot, '.cursor'), ['cursor']);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

// Revisão da PR #491, achado 2: a raiz de skills do Cursor converge na mesma chamada em que o
// conjunto de engines muda, mesmo quando o Cursor não está entre as engines da chamada.
test('installFiles: adicionar Claude Code a um projeto só com Cursor move as skills do Cursor para .claude/skills na mesma chamada', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, sourceRoot, engines: [CURSOR_ENGINE] });
      assert.deepEqual(skillOwners(projectRoot, '.cursor'), ['cursor']);

      const { migrated } = installFiles({ projectRoot, sourceRoot, engines: [CLAUDE_ENGINE] });

      assert.equal(fs.existsSync(path.join(projectRoot, '.cursor', 'skills')), false);
      assert.deepEqual(skillOwners(projectRoot, '.claude'), ['claude-code', 'cursor']);
      assert.deepEqual(migrated, [{ from: '.cursor/skills/demo/SKILL.md', to: '.claude/skills/demo/SKILL.md' }]);
      assert.equal(readManifest(projectRoot).files['.cursor/skills/demo/SKILL.md'], undefined);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

test('installFiles: adicionar Codex a Claude Code + Cursor tira o Cursor de .claude/skills e o registra em .agents/skills', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      installFiles({ projectRoot, sourceRoot, engines: [CLAUDE_ENGINE, CURSOR_ENGINE] });
      assert.deepEqual(skillOwners(projectRoot, '.claude'), ['claude-code', 'cursor']);

      installFiles({ projectRoot, sourceRoot, engines: [CODEX_ENGINE] });

      assert.deepEqual(skillOwners(projectRoot, '.claude'), ['claude-code']);
      assert.deepEqual(skillOwners(projectRoot, '.agents'), ['codex', 'cursor']);
      assert.equal(fs.existsSync(path.join(projectRoot, '.cursor', 'skills')), false);
      // O que não é skill do Cursor não é reinstalado pela chamada que só trouxe o Codex.
      assert.ok(readManifest(projectRoot).files['.cursor/agents/demo.md']);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

// Revisão da PR #491, achado 3: a trava de migração do Codex vale também para o Cursor.
test('installFiles: skill legada do Codex editada bloqueia a cópia gerenciada em .agents/skills também para o Cursor', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const legacy = writeManagedSkill(projectRoot, '.codex', 'editada pelo usuário\n', ['codex'], {
        manifestContent: 'original\n',
      });

      const { skipped, warnings } = installFiles({ projectRoot, sourceRoot, engines: [CODEX_ENGINE, CURSOR_ENGINE] });

      assert.equal(fs.readFileSync(legacy, 'utf8'), 'editada pelo usuário\n');
      assert.equal(skillExists(projectRoot, '.agents'), false);
      assert.equal(skillExists(projectRoot, '.cursor'), false);
      assert.equal(readManifest(projectRoot).files['.agents/skills/demo/SKILL.md'], undefined);
      assert.deepEqual(
        skipped.filter((entry) => entry.path === '.agents/skills/demo/SKILL.md'),
        [{ path: '.agents/skills/demo/SKILL.md', reason: 'migration-blocked' }],
      );
      assert.match(warnings.join('\n'), /\.codex\/skills\/demo\/SKILL\.md: arquivo editado pelo usuário/);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

// Revisão da PR #491, achado 1: dono marcado como desinstalado não conta para a escolha da raiz.
test('installFiles: engine desinstalada com arquivo editado preservado não fixa a raiz de skills do Cursor', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const { writeManifest } = require('../lib/installer/manifest.js');
      const edited = path.join(projectRoot, '.claude', 'agents', 'demo.md');
      fs.mkdirSync(path.dirname(edited), { recursive: true });
      fs.writeFileSync(edited, 'editado\n');
      writeManifest(projectRoot, { version: 1, files: {
        '.claude/agents/demo.md': { sha256: sha256('original\n'), engine: 'claude-code', engines: ['claude-code'], uninstalled: true },
      } });

      installFiles({ projectRoot, sourceRoot, engines: [CURSOR_ENGINE] });

      assert.deepEqual(skillOwners(projectRoot, '.cursor'), ['cursor']);
      assert.equal(skillExists(projectRoot, '.claude'), false);
      assert.equal(fs.readFileSync(edited, 'utf8'), 'editado\n');
      assert.equal(readManifest(projectRoot).files['.claude/agents/demo.md'].uninstalled, true);
    } finally { fs.rmSync(sourceRoot, { recursive: true, force: true }); }
  });
});

