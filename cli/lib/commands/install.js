'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Comando `install`. Nesta fase (scaffold) faz apenas a detecção mais básica
 * de engine (Claude Code via `.claude/`) — a seleção interativa entre
 * múltiplas engines chega em issue futura (detecção completa de engines).
 */
function isDirectory(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function install(cwd = process.cwd()) {
  const claudeDetected = isDirectory(path.join(cwd, '.claude'));

  if (claudeDetected) {
    console.info('Engine detectada: Claude Code (.claude/ encontrado).');
  } else {
    console.info('Nenhuma engine detectada no diretório atual.');
  }

  console.info('Detecção completa de engines e instalação interativa chegam em issue futura.');
}

module.exports = { install };
