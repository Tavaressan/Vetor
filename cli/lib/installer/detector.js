'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { commandExists } = require('./command-exists.js');

function isDirectory(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(targetPath) {
  try {
    return fs.statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

// Escopo da issue #254: só as 4 engines já suportadas pelo Vetor hoje (ver wiki/Compatibilidade-*.md
// para os arquivos-âncora de cada uma). Cursor foi investigado e adicionado na issue #256.
//
// Premissa declarada: não há convenção de arquivo-âncora de projeto documentada para Antigravity
// neste repositório (sem equivalente a `.claude/`, `AGENTS.md` ou `.opencode/` encontrado em
// wiki/Compatibilidade-Antigravity.md nem na estrutura do repo) — a detecção de Antigravity usa
// somente o comando `agy` no PATH (nome confirmado em scripts/lib/delegation-runtime.ts).
const ENGINES = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    detect: (root, env) => isDirectory(path.join(root, '.claude')) || commandExists('claude', env),
  },
  {
    id: 'codex',
    name: 'Codex',
    detect: (root, env) => isFile(path.join(root, 'AGENTS.md')) || commandExists('codex', env),
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    detect: (root, env) =>
      isDirectory(path.join(root, '.opencode')) || commandExists('opencode', env),
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    detect: (_root, env) => commandExists('agy', env),
  },
  // Issue #256 (ver wiki/Compatibilidade-Cursor.md): `.cursor/` é a âncora de projeto
  // confirmada contra a doc oficial (rules/skills/agents/hooks vivem todos ali). O comando
  // de PATH usado é `cursor-agent`, não `agent` — `agent` é o nome "primary" hoje na doc do
  // CLI, mas é genérico demais e colide com facilidade com binários não relacionados ao
  // Cursor; `cursor-agent` é mantido como symlink "legacy" pelo próprio script oficial de
  // instalação (`cursor.com/install`, verificado nesta investigação) e carrega o mesmo sinal
  // com risco de falso positivo muito menor.
  {
    id: 'cursor',
    name: 'Cursor',
    detect: (root, env) =>
      isDirectory(path.join(root, '.cursor')) || commandExists('cursor-agent', env),
  },
];

/**
 * Detecta engines suportadas no projeto-alvo: arquivo/diretório-âncora já existente,
 * ou comando disponível no PATH. Nunca lança erro — ausência total de sinal apenas
 * resulta em `detected: false` para todas as entradas.
 *
 * `env` é injetável para testes determinísticos (ex.: PATH vazio).
 */
function detectEngines(root = process.cwd(), env = process.env) {
  return ENGINES.map(({ id, name, detect }) => ({ id, name, detected: detect(root, env) }));
}

module.exports = { detectEngines, ENGINES };
