'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  translateHooksForCursor,
  validateCursorHooksSchema,
} = require('../lib/installer/cursor-hooks.js');

// Fixture equivalente ao hooks/hooks.json real deste repositório (issue #284) — formato
// Claude Code (PascalCase, matcher/hooks[] aninhado).
const CLAUDE_HOOKS_FIXTURE = {
  hooks: {
    PreToolUse: [
      {
        matcher: 'Bash|Edit|Write',
        hooks: [
          {
            type: 'command',
            command: 'deno run -A "${CLAUDE_PLUGIN_ROOT}/scripts/safety-check.ts"',
            timeout: 300,
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: 'Edit|Write',
        hooks: [
          {
            type: 'command',
            command: 'deno run -A "${CLAUDE_PLUGIN_ROOT}/scripts/check-edit.ts"',
            timeout: 30,
          },
        ],
      },
    ],
    SubagentStop: [
      {
        matcher: 'vetor:issue-worker',
        hooks: [
          {
            type: 'command',
            command: 'deno run -A "${CLAUDE_PLUGIN_ROOT}/scripts/check-status.ts"',
            timeout: 30,
          },
        ],
      },
    ],
    SessionStart: [
      {
        hooks: [
          {
            type: 'command',
            command: 'bash "${CLAUDE_PLUGIN_ROOT}/scripts/session-check.sh"',
            timeout: 30,
          },
        ],
      },
    ],
    WorktreeCreate: [
      {
        hooks: [
          {
            type: 'command',
            command: 'deno run -A "${CLAUDE_PLUGIN_ROOT}/scripts/prepare-worktree.ts"',
            timeout: 600,
          },
        ],
      },
    ],
  },
};

test('translateHooksForCursor: traduz nomes de evento PascalCase -> camelCase (cursor.com/docs/hooks)', () => {
  const { hooks } = translateHooksForCursor(CLAUDE_HOOKS_FIXTURE);

  assert.equal(hooks.version, 1);
  assert.ok(hooks.hooks.preToolUse);
  assert.ok(hooks.hooks.postToolUse);
  assert.ok(hooks.hooks.subagentStop);
  assert.ok(hooks.hooks.sessionStart);
  assert.ok(!('PreToolUse' in hooks.hooks));
});

test('translateHooksForCursor: achata matcher/hooks[] aninhado em entradas planas {command,timeout,matcher}', () => {
  const { hooks } = translateHooksForCursor(CLAUDE_HOOKS_FIXTURE);

  assert.deepEqual(hooks.hooks.postToolUse, [
    {
      command: 'deno run -A "${CLAUDE_PLUGIN_ROOT}/scripts/check-edit.ts"',
      timeout: 30,
      matcher: 'Write',
    },
  ]);
});

test('translateHooksForCursor: traduz nomes de tool no matcher (Bash->Shell, Edit dedupe em Write)', () => {
  const { hooks } = translateHooksForCursor(CLAUDE_HOOKS_FIXTURE);

  // Fonte "Bash|Edit|Write" -> Cursor "Shell|Write" (Edit e Write mapeiam para o mesmo tool
  // Cursor "Write" — sem dedupe teríamos "Shell|Write|Write").
  assert.equal(hooks.hooks.preToolUse[0].matcher, 'Shell|Write');
});

test('translateHooksForCursor: evento sem equivalente no Cursor (WorktreeCreate) é descartado e reportado', () => {
  const { hooks, dropped } = translateHooksForCursor(CLAUDE_HOOKS_FIXTURE);

  assert.ok(!('workspaceOpen' in hooks.hooks));
  assert.ok(!('WorktreeCreate' in hooks.hooks));
  assert.ok(dropped.some((d) => d.event === 'WorktreeCreate' && d.reason === 'no-cursor-equivalent'));
});

test('translateHooksForCursor: matcher de SubagentStop não é traduzível (nome de subagente Claude != subagent_type do Cursor) — mantém o hook, remove o matcher, reporta o gap', () => {
  const { hooks, dropped } = translateHooksForCursor(CLAUDE_HOOKS_FIXTURE);

  assert.equal(hooks.hooks.subagentStop.length, 1);
  assert.equal(hooks.hooks.subagentStop[0].matcher, undefined);
  assert.ok(
    dropped.some((d) => d.event === 'SubagentStop' && d.reason === 'matcher-not-translatable'),
  );
});

test('translateHooksForCursor: entrada sem matcher (SessionStart) não ganha matcher artificial', () => {
  const { hooks } = translateHooksForCursor(CLAUDE_HOOKS_FIXTURE);

  assert.deepEqual(hooks.hooks.sessionStart, [
    {
      command: 'bash "${CLAUDE_PLUGIN_ROOT}/scripts/session-check.sh"',
      timeout: 30,
    },
  ]);
});

test('translateHooksForCursor: fonte vazia ({}) produz hooks.json válido e vazio, sem lançar', () => {
  const { hooks, dropped } = translateHooksForCursor({});

  assert.deepEqual(hooks, { version: 1, hooks: {} });
  assert.deepEqual(dropped, []);
});

test('validateCursorHooksSchema: aceita o hooks.json gerado pela tradução (contra o schema documentado em cursor.com/docs/hooks)', () => {
  const { hooks } = translateHooksForCursor(CLAUDE_HOOKS_FIXTURE);
  const result = validateCursorHooksSchema(hooks);

  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('validateCursorHooksSchema: rejeita nome de evento não documentado', () => {
  const result = validateCursorHooksSchema({
    version: 1,
    hooks: { naoExisteNaDoc: [{ command: 'echo 1' }] },
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('naoExisteNaDoc')));
});

test('validateCursorHooksSchema: rejeita entrada de hook sem "command" (campo obrigatório)', () => {
  const result = validateCursorHooksSchema({
    version: 1,
    hooks: { preToolUse: [{ matcher: 'Shell' }] },
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('command')));
});

test('validateCursorHooksSchema: rejeita "version" ausente ou não-numérico', () => {
  const result = validateCursorHooksSchema({ hooks: {} });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('version')));
});
