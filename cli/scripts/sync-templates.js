#!/usr/bin/env node
'use strict';

// Popula cli/templates/ a partir de skills/, agents/, hooks/, opencode/ na raiz do
// monorepo.
//
// cli/templates/ é o que o pacote npm publicado embarca de fato (cli/package.json
// declara "files": ["bin/", "lib/", "templates/"] — skills/, agents/, hooks/, opencode/ da
// raiz do monorepo NÃO fazem parte do tarball). Sem este sync, um usuário real rodando
// `vetor install` a partir do pacote instalado via npm não copiaria nada, pois
// `defaultSourceRoot()` (cli/lib/installer/writer.js) recai sobre `templates/` quando
// não encontra skills/agents/hooks/opencode ao lado do pacote (ver comentário lá).
//
// cli/templates/ é gerado, nunca editado manualmente — este script é a única fonte de
// verdade para o conteúdo do diretório, chamado automaticamente pelo hook de lifecycle
// `prepack` do npm (cli/package.json) antes de `npm pack`/`npm publish`, e está no
// .gitignore da raiz do monorepo.
//
// `opencode` adicionada na issue #283: `ENGINE_NATIVE_SOURCE_DIR.opencode` em writer.js
// resolve `sourceRoot/opencode`, que precisa existir em `templates/` no pacote publicado
// pelo mesmo motivo que skills/agents/hooks precisam — sem isso, `vetor install` com
// OpenCode selecionado, rodando a partir do pacote npm, não copiaria nada (o guard
// `fs.existsSync` de `installFiles()` tornaria isso um no-op silencioso).
//
// Escopo deliberadamente restrito (issue #255, redespacho): copia as pastas inteiras e
// (para skills/agents/hooks) agnósticas de engine, sem nenhuma adaptação de formato por
// destino (isso é um gap conhecido e documentado em writer.js, fora do escopo deste
// script).

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_DIRS = ['skills', 'agents', 'hooks', 'opencode'];

// cli/scripts/sync-templates.js -> cli/scripts -> cli -> raiz do monorepo.
const MONOREPO_ROOT = path.join(__dirname, '..', '..');
const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

// `monorepoRoot`/`templatesDir` são injetáveis só para teste, para rodar contra
// diretórios temporários em vez do `cli/templates/` real — outros arquivos de teste
// também disparam este script via prepack (npm pack/publish --dry-run), e mutar o
// diretório real a partir de mais de um arquivo de teste correndo em paralelo (o
// runner do Node roda arquivos de teste em paralelo por padrão) causaria corrida.
function syncTemplates({ monorepoRoot = MONOREPO_ROOT, templatesDir = TEMPLATES_DIR } = {}) {
  const synced = [];

  for (const dirName of SOURCE_DIRS) {
    const source = path.join(monorepoRoot, dirName);
    const dest = path.join(templatesDir, dirName);

    // Recria o subdiretório de destino do zero a cada execução: evita arquivo órfão
    // deixado por uma versão anterior da fonte que não existe mais.
    fs.rmSync(dest, { recursive: true, force: true });

    if (!fs.existsSync(source)) continue;

    fs.cpSync(source, dest, { recursive: true });
    synced.push(dirName);
  }

  return synced;
}

if (require.main === module) {
  const synced = syncTemplates();
  // stderr, não stdout: este script roda como hook `prepack`, e `npm pack --json`/
  // `npm publish --json` capturam o stdout do processo pai para emitir JSON estruturado —
  // stdout dos lifecycle scripts é herdado pelo mesmo descritor e poluiria esse JSON.
  console.error(`[sync-templates] sincronizado: ${synced.join(', ') || '(nada encontrado)'}`);
}

module.exports = { syncTemplates, SOURCE_DIRS, MONOREPO_ROOT, TEMPLATES_DIR };
