'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Issue #478: o agent `issue-coordinator` do OpenCode deixa de duplicar o fluxo do coordinator e
// carrega a skill canônica `skills/coordinator/` pela ferramenta nativa `skill`. O OpenCode
// descobre skills de projeto em `.opencode/skills/<nome>/SKILL.md`
// (https://opencode.ai/docs/skills/, consultada em 2026-10-23), então o instalador grava ali só
// essa skill — não as demais skills do plugin, que referenciam `$CLAUDE_PLUGIN_ROOT` (#283) — e as
// referências de que ela depende em `.opencode/skills/shared/references/`, preservando o caminho
// relativo `../shared/references/` que a skill usa.
const OPENCODE_SKILL_NAMES = ['coordinator'];

const REFERENCES_DIR = 'skills/shared/references';

// Nome de arquivo Markdown citado em texto, com ou sem o prefixo `../shared/references/`.
const MARKDOWN_NAME_PATTERN = /[A-Za-z0-9][A-Za-z0-9._-]*\.md/g;

function listFilesRecursive(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...listFilesRecursive(fullPath));
    else if (entry.isFile()) result.push(fullPath);
  }
  return result;
}

function toPosix(relPath) {
  return relPath.split(path.sep).join('/');
}

/**
 * Lista os arquivos que o OpenCode precisa para carregar a skill do coordinator, como pares
 * `{ source, dest }`: `source` é o path absoluto na fonte e `dest` o path relativo a `.opencode/`.
 *
 * As referências entram por fecho transitivo: toda referência de `skills/shared/references/` que
 * a skill (ou outra referência já incluída) cita pelo nome. Skill ausente faz a instalação falhar
 * com o path, nunca um agent sem a skill que ele manda carregar.
 */
function resolveOpencodeSkillFiles(sourceRoot) {
  const files = [];
  const pendingTexts = [];

  for (const name of OPENCODE_SKILL_NAMES) {
    const skillDir = path.join(sourceRoot, 'skills', name);
    if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
      throw new Error(`OpenCode: skill ausente: skills/${name}/SKILL.md`);
    }
    for (const source of listFilesRecursive(skillDir)) {
      files.push({ source, dest: `skills/${name}/${toPosix(path.relative(skillDir, source))}` });
      if (source.endsWith('.md')) pendingTexts.push(source);
    }
  }

  const referencesDir = path.join(sourceRoot, ...REFERENCES_DIR.split('/'));
  const available = fs.existsSync(referencesDir)
    ? new Set(fs.readdirSync(referencesDir).filter((name) => name.endsWith('.md')))
    : new Set();
  const included = new Set();

  while (pendingTexts.length > 0) {
    const text = fs.readFileSync(pendingTexts.pop(), 'utf8');
    for (const name of text.match(MARKDOWN_NAME_PATTERN) ?? []) {
      if (!available.has(name) || included.has(name)) continue;
      included.add(name);
      const source = path.join(referencesDir, name);
      files.push({ source, dest: `${REFERENCES_DIR}/${name}` });
      pendingTexts.push(source);
    }
  }

  return files.sort((a, b) => (a.dest < b.dest ? -1 : a.dest > b.dest ? 1 : 0));
}

module.exports = { OPENCODE_SKILL_NAMES, resolveOpencodeSkillFiles };
