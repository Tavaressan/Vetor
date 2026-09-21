'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Verifica se um comando existe em algum diretório do PATH, sem executá-lo — apenas
 * resolve candidatos no filesystem (evita spawn/child_process e efeitos colaterais).
 * No Windows, cruza cada diretório do PATH com as extensões de PATHEXT (`.cmd`, `.exe`, ...),
 * já que CLIs instaladas via npm (`claude`, `codex`, `opencode`) viram shims `.cmd`.
 *
 * `env` é injetável para testes determinísticos (ex.: PATH vazio → nenhum comando encontrado).
 */
function commandExists(command, env = process.env) {
  const pathEnv = env.PATH ?? env.Path ?? '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext);
      if (fs.existsSync(candidate)) return true;
    }
  }
  return false;
}

module.exports = { commandExists };
