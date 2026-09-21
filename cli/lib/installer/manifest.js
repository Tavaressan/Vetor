'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// `.claude/vetor/` já é o diretório de metadados do Vetor usado por config.json e pelos
// status files (agnóstico de engine — consumido por todos os workers, inclusive Codex/
// OpenCode, ver skills/fix-loop-agent/SKILL.md e agents/issue-worker/codex.toml). O
// manifesto do instalador segue a mesma convenção.
const MANIFEST_RELATIVE_PATH = path.join('.claude', 'vetor', 'install-manifest.json');

function manifestPathFor(projectRoot) {
  return path.join(projectRoot, MANIFEST_RELATIVE_PATH);
}

function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Lê o manifesto de instalação do projeto-alvo. Ausência do arquivo (primeira instalação)
 * não é erro — retorna manifesto vazio.
 */
function readManifest(projectRoot) {
  const manifestPath = manifestPathFor(projectRoot);
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    return { version: 1, files: {}, ...parsed };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { version: 1, files: {} };
    }
    throw error;
  }
}

function writeManifest(projectRoot, manifest) {
  const manifestPath = manifestPathFor(projectRoot);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

module.exports = { MANIFEST_RELATIVE_PATH, manifestPathFor, hashFile, readManifest, writeManifest };
