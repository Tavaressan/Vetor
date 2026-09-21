'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Correção pós-code-review da PR #282 (issue #256): o manifesto vivia em
// `.claude/vetor/install-manifest.json`, mas `writeManifest`/`readManifest` fazem
// `mkdirSync(dirname(manifestPath), { recursive: true })` — criar `.claude/` como efeito
// colateral de QUALQUER instalação (mesmo uma "Cursor-exclusiva", sem Claude Code
// envolvido) polui `detectEngines()`: uma segunda execução de `vetor install` passaria a
// reportar `claude-code: detected: true` falsamente, só por causa do diretório-âncora que
// o próprio manifesto criou. `.vetor/` na raiz do projeto-alvo (fora de `.claude/`) não é
// âncora de detecção de nenhuma engine hoje (ver `detector.js`) nem previsivelmente no
// futuro, então não contamina a detecção de nenhuma delas.
//
// Decisão de migração (issue #285): este já é o segundo path usado por
// MANIFEST_RELATIVE_PATH nesta mesma feature (o primeiro, `.claude/vetor/...` acima, durou
// só até a PR #282) — sem nenhuma lógica de migração implementada para quem tivesse
// instalado com o path antigo. Avaliado e decidido não implementar migração automática
// (opção b, não a): até a data desta issue, `vetor install`/`installFiles` nunca foi
// publicado em nenhum release/pacote npm — não existe usuário real com manifesto gravado
// no path antigo para migrar. A primeira versão publicada já nasce com este path como
// definitivo. Se `MANIFEST_RELATIVE_PATH` precisar mudar de novo DEPOIS de uma versão
// publicada, essa migração (ler o path antigo se o novo não existir, ou equivalente) passa
// a ser obrigatória — o que não se aplicou nas duas mudanças anteriores continua não se
// aplicando por acidente.
const MANIFEST_RELATIVE_PATH = path.join('.vetor', 'install-manifest.json');

function manifestPathFor(projectRoot) {
  return path.join(projectRoot, MANIFEST_RELATIVE_PATH);
}

function hashFile(filePath) {
  return hashContent(fs.readFileSync(filePath));
}

/** Hash de conteúdo já em memória (ex.: bytes traduzidos, nunca lidos de volta do disco antes
 * de gravar) — usado quando o arquivo gravado no destino não é uma cópia byte-a-byte da fonte
 * (ex.: `.cursor/hooks.json` traduzido, ver `writer.js`/`cursor-hooks.js`, issue #284). */
function hashContent(content) {
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

module.exports = {
  MANIFEST_RELATIVE_PATH,
  manifestPathFor,
  hashFile,
  hashContent,
  readManifest,
  writeManifest,
};
