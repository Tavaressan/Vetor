'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { installFiles } = require('../lib/installer/writer.js');
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
function makeFakeSourceRoot() {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vetor-writer-source-'));
  fs.mkdirSync(path.join(sourceRoot, 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'skills', 'demo', 'SKILL.md'), 'conteúdo v1\n');
  fs.mkdirSync(path.join(sourceRoot, 'agents', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'agents', 'demo.md'), 'agente v1\n');
  fs.writeFileSync(path.join(sourceRoot, 'agents', 'demo', 'agent.json'), '{}\n');
  fs.writeFileSync(path.join(sourceRoot, 'agents', 'demo', 'codex.toml'), 'name = "demo"\n');
  fs.mkdirSync(path.join(sourceRoot, 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'hooks', 'hooks.json'), '{}\n');

  // Árvore nativa do OpenCode (issue #283): já no formato/path que a engine espera —
  // `agent/` (singular), não `agents/`.
  fs.mkdirSync(path.join(sourceRoot, 'opencode', 'agent'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'opencode', 'agent', 'demo.md'), 'opencode agent v1\n');
  fs.mkdirSync(path.join(sourceRoot, 'opencode', 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, 'opencode', 'skills', 'demo', 'SKILL.md'),
    'opencode skill v1\n',
  );

  return sourceRoot;
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
      assert.ok(copied.includes('.codex/skills/demo/SKILL.md'));
      assert.ok(fs.existsSync(path.join(projectRoot, '.claude', 'skills', 'demo', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(projectRoot, '.codex', 'skills', 'demo', 'SKILL.md')));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
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

      assert.deepEqual(copied.sort(), ['.cursor/agents/demo.md', '.cursor/skills/demo/SKILL.md']);
      assert.ok(fs.existsSync(path.join(projectRoot, '.cursor', 'skills', 'demo', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(projectRoot, '.cursor', 'agents', 'demo.md')));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Follow-up de code-review da PR #282 (issue #256): o Cursor só carrega hooks de projeto de
// `.cursor/hooks.json` (arquivo único), nunca `.cursor/hooks/hooks.json` (diretório, o que
// installFiles() produzia antes desta correção). Copiar e reportar como `copied` era
// enganoso — o arquivo copiado é inerte. hooks/ não deve ir para o destino do Cursor,
// mesmo existindo na fonte.
test('installFiles: NÃO copia hooks/ para ".cursor/" quando Cursor é selecionada (caminho inerte)', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const { copied, skipped } = installFiles({
        projectRoot,
        engines: [{ id: 'cursor', name: 'Cursor', detected: false }],
        sourceRoot,
      });

      assert.ok(!copied.includes('.cursor/hooks/hooks.json'));
      assert.ok(!skipped.some((s) => s.path === '.cursor/hooks/hooks.json'));
      assert.ok(!fs.existsSync(path.join(projectRoot, '.cursor', 'hooks')));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

// Confirma que a exclusão é específica do Cursor: outras engines continuam copiando
// hooks/ normalmente (ver ENGINE_EXCLUDED_SOURCE_DIRS em writer.js).
test('installFiles: outras engines continuam copiando hooks/ normalmente (exclusão é só do Cursor)', () => {
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

// Issue #283: OpenCode tem árvore-fonte própria (`opencode/`), já no formato nativo — não
// os SOURCE_DIRS agnósticos (`skills/`/`agents/`/`hooks/`, que produziriam skills inertes
// por referenciar `$CLAUDE_PLUGIN_ROOT`, e um `agents/` plural que o OpenCode não escaneia).
test('installFiles: copia a árvore opencode/ achatada para .opencode/ quando OpenCode é selecionada', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
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

// Issue #283: Antigravity não tem diretório-âncora de projeto confirmado (`.antigravity`
// era convenção assumida — ver ENGINE_DEST_DIR). Selecioná-la não deve copiar nada nem
// falhar silenciosamente: deve aparecer em `enginesSkipped` para o chamador reportar.
test('installFiles: engine sem destino de projeto confirmado (Antigravity) não copia nada e aparece em enginesSkipped', () => {
  withTempDir((projectRoot) => {
    const sourceRoot = makeFakeSourceRoot();
    try {
      const { copied, skipped, enginesSkipped } = installFiles({
        projectRoot,
        engines: [{ id: 'antigravity', name: 'Antigravity', detected: true }],
        sourceRoot,
      });

      assert.deepEqual(copied, []);
      assert.deepEqual(skipped, []);
      assert.deepEqual(enginesSkipped, [
        { id: 'antigravity', name: 'Antigravity', reason: 'no-verified-project-anchor' },
      ]);
      assert.ok(!fs.existsSync(path.join(projectRoot, '.antigravity')));
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});
