'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { commandExists } = require('../lib/installer/command-exists.js');

const cliRoot = path.join(__dirname, '..');

// npm sempre inclui alguns arquivos implícitos (package.json, README, LICENSE)
// independente do campo "files" — só o conteúdo de diretório é restrito por ele.
const ALLOWED_PREFIXES = ['bin/', 'lib/', 'templates/'];
const ALLOWED_EXACT = ['package.json', 'README.md', 'LICENSE'];

test('npm pack --dry-run só empacota bin/, lib/ e templates/ (além dos implícitos)', () => {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: cliRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const [pkg] = JSON.parse(output);

  for (const file of pkg.files) {
    const allowed =
      ALLOWED_EXACT.includes(file.path) ||
      ALLOWED_PREFIXES.some((prefix) => file.path.startsWith(prefix));
    assert.ok(allowed, `arquivo inesperado no pacote: ${file.path}`);
  }

  // Garante que o allowlist não está vazio por acidente (ex.: "files" quebrado
  // silenciosamente): os arquivos reais de bin/ e lib/ precisam aparecer.
  const paths = pkg.files.map((file) => file.path);
  assert.ok(paths.includes('bin/vetor.js'), 'bin/vetor.js ausente do pacote');
  assert.ok(paths.includes('lib/router.js'), 'lib/router.js ausente do pacote');
});

// Issue #255 (redespacho): o teste acima só checa o prefixo "templates/" — passaria mesmo
// com o diretório vazio (só ".gitkeep"). Este teste garante que o hook `prepack`
// (cli/scripts/sync-templates.js) de fato populou templates/ com conteúdo real de
// skills/agents/hooks/opencode antes do pacote ser montado, checando um arquivo concreto e
// conhecido de cada uma das fontes.
//
// `opencode/` adicionada na issue #283: sem isso no pacote publicado,
// `ENGINE_NATIVE_SOURCE_DIR.opencode` (writer.js) resolveria um diretório inexistente e
// `vetor install` com OpenCode selecionado, rodando do pacote npm real, não copiaria nada.
test('npm pack --dry-run inclui arquivos concretos sincronizados de skills/, agents/, hooks/ e opencode/ via prepack', () => {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: cliRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const [pkg] = JSON.parse(output);
  const paths = pkg.files.map((file) => file.path);

  assert.ok(
    paths.includes('templates/skills/vetor/SKILL.md'),
    'templates/skills/vetor/SKILL.md ausente do pacote — prepack não sincronizou skills/',
  );
  assert.ok(
    paths.includes('templates/agents/code-review/agent.json'),
    'templates/agents/code-review/agent.json ausente do pacote — prepack não sincronizou agents/',
  );
  assert.ok(
    paths.includes('templates/hooks/hooks.json'),
    'templates/hooks/hooks.json ausente do pacote — prepack não sincronizou hooks/',
  );
  assert.ok(
    paths.includes('templates/opencode/agent/issue-worker.md'),
    'templates/opencode/agent/issue-worker.md ausente do pacote — prepack não sincronizou opencode/',
  );
});

// Issue #300: os testes acima validam só o conteúdo *declarado* do pacote (`npm pack
// --dry-run --json`) — nenhum instala o tarball de verdade fora do monorepo e roda o
// instalador a partir dele. `defaultSourceRoot()` (writer.js) tem um branch dedicado ao
// layout de pacote publicado (sem `plugin.json` ao lado) que só era exercitado contra
// fixtures sintéticas (`installer-writer.test.js`), nunca contra o `node_modules/` real
// que `npm install <tarball>` produz.
//
// Roda sequencialmente no mesmo arquivo que os testes acima (não em um arquivo dedicado)
// de propósito: `npm pack` sem `--dry-run` também dispara o hook `prepack` real
// (`sync-templates.js`), que recria `cli/templates/` do zero (`fs.rmSync` + `fs.cpSync`,
// ver sync-templates.js) — o mesmo diretório que os dois testes acima também mutam via
// prepack. `node --test` roda arquivos diferentes em paralelo por padrão; manter tudo em
// `pack.test.js` preserva o invariante já documentado em sync-templates.test.js ("pack.test.js
// é o único arquivo de teste que muta esse diretório").
//
// `--ignore-scripts` aqui: os dois testes acima, rodando sequencialmente antes deste no
// mesmo arquivo, já dispararam o prepack real e deixaram `cli/templates/` sincronizado —
// não é preciso rodar prepack uma terceira vez. Descoberto empiricamente (issue #300): sem
// `--ignore-scripts`, essa terceira sincronização (rm + cp em `cli/templates/`) cria uma
// janela de corrida real contra `npm-publish-workflow.test.js` (`npm publish --dry-run`,
// arquivo diferente, rodando em paralelo por padrão) — ~50% de falha intermitente em 8
// execuções da suíte completa (`npm test`) local. O tarball ainda inclui `templates/`
// sincronizado de verdade — só não sincroniza de novo aqui.
function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test(
  'npm pack real (sem --dry-run) instalado num diretório limpo fora do monorepo expõe bin/lib/templates reais e resolve defaultSourceRoot() para templates/',
  () => {
    withTempDir('vetor-e2e-pack-', (packDir) => {
      const output = execFileSync(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir],
        {
          cwd: cliRoot,
          encoding: 'utf8',
          shell: process.platform === 'win32',
        },
      );
      const [pkg] = JSON.parse(output);
      const tarballPath = path.join(packDir, pkg.filename);
      assert.ok(fs.existsSync(tarballPath), `tarball real não foi gerado: ${tarballPath}`);

      // Instalado fora do monorepo (mkdtemp em os.tmpdir(), nunca dentro do checkout) —
      // `npm install <tarball>`, não `npm link` (que apontaria para o working tree em vez
      // do conteúdo empacotado de verdade).
      withTempDir('vetor-e2e-install-', (installPrefix) => {
        execFileSync(
          'npm',
          [
            'install',
            tarballPath,
            '--prefix',
            installPrefix,
            '--no-audit',
            '--no-fund',
            '--no-package-lock',
          ],
          { cwd: installPrefix, encoding: 'utf8', shell: process.platform === 'win32' },
        );

        const installedRoot = path.join(installPrefix, 'node_modules', '@tavaressan', 'vetor');
        assert.ok(fs.existsSync(path.join(installedRoot, 'bin', 'vetor.js')));
        assert.ok(fs.existsSync(path.join(installedRoot, 'lib', 'router.js')));
        assert.ok(fs.existsSync(path.join(installedRoot, 'lib', 'installer', 'writer.js')));

        // Bin real instalado (não o working tree) responde a --help.
        const helpOutput = execFileSync('node', [path.join(installedRoot, 'bin', 'vetor.js'), '--help'], {
          encoding: 'utf8',
        });
        assert.match(helpOutput, /Uso: vetor <comando>/);

        // eslint-disable-next-line import/no-dynamic-require
        const installedWriter = require(path.join(installedRoot, 'lib', 'installer', 'writer.js'));

        // O branch de `defaultSourceRoot()` para pacote publicado (sem `plugin.json` no
        // diretório-pai) só tinha cobertura contra fixture sintética antes desta issue —
        // aqui roda contra o `node_modules/` real produzido por `npm install`.
        assert.equal(
          installedWriter.defaultSourceRoot(),
          path.join(installedRoot, 'templates'),
        );
        assert.ok(
          fs.existsSync(path.join(installedRoot, 'templates', 'skills', 'vetor', 'SKILL.md')),
        );
        assert.ok(
          fs.existsSync(
            path.join(installedRoot, 'templates', 'agents', 'issue-worker', 'codex.toml'),
          ),
        );
        assert.ok(
          fs.existsSync(
            path.join(installedRoot, 'templates', 'opencode', 'agent', 'issue-worker.md'),
          ),
        );

        // Achado desta issue (#300), documentado em wiki/Compatibilidade-OpenCode.md: o
        // prompt interativo (`prompts.js`) decide "sessão não-interativa" por
        // `input.isTTY` — um processo filho com stdin em pipe nunca é TTY, então `vetor
        // install` rodado assim nunca seleciona engine nenhuma, mesmo com engines
        // detectadas. Não é um bug a corrigir aqui (fora de escopo, YAGNI) — é o
        // comportamento real do binário publicado, registrado como regressão conhecida.
        withTempDir('vetor-e2e-project-noninteractive-', (projectDir) => {
          const installOutput = execFileSync(
            'node',
            [path.join(installedRoot, 'bin', 'vetor.js'), 'install'],
            { cwd: projectDir, encoding: 'utf8', input: '' },
          );
          assert.match(installOutput, /Sessão não-interativa/);
          assert.match(installOutput, /Nenhuma engine selecionada\. Instalação cancelada\./);
        });

        // Núcleo do critério de aceite: a partir do binário instalado (tarball real),
        // instala para Claude Code, OpenCode e Codex — as engines com lógica de tradução
        // em writer.js — contra um projeto de teste limpo.
        withTempDir('vetor-e2e-project-', (projectDir) => {
          const engines = [
            { id: 'claude-code', name: 'Claude Code', detected: true },
            { id: 'opencode', name: 'OpenCode', detected: true },
            { id: 'codex', name: 'Codex', detected: true },
          ];
          const { copied, skipped, enginesSkipped } = installedWriter.installFiles({
            projectRoot: projectDir,
            engines,
          });

          assert.equal(skipped.length, 0);
          assert.deepEqual(enginesSkipped, []);
          assert.ok(copied.length > 0);

          // Claude Code: cópia direta, formato agnóstico já usado nativamente por esta
          // própria sessão.
          const claudeSkill = path.join(projectDir, '.claude', 'skills', 'vetor', 'SKILL.md');
          assert.ok(fs.existsSync(claudeSkill));
          assert.match(fs.readFileSync(claudeSkill, 'utf8'), /^---[\s\S]*name:/);
          assert.ok(
            fs.existsSync(path.join(projectDir, '.claude', 'agents', 'issue-worker.md')),
          );

          // OpenCode: árvore nativa achatada (`agent/`, singular) — sem o `agents/`
          // (plural, genérico) nem `skills/` além de `issue-coordinator` (única portada).
          assert.ok(
            fs.existsSync(path.join(projectDir, '.opencode', 'agent', 'issue-worker.md')),
          );
          assert.ok(!fs.existsSync(path.join(projectDir, '.opencode', 'agents')));

          // Codex: subagentes achatados para .toml — nunca o path aninhado nem o .md de
          // outra engine (tradução de formato, não cópia genérica).
          assert.ok(
            fs.existsSync(path.join(projectDir, '.codex', 'agents', 'issue-worker.toml')),
          );
          assert.ok(
            !fs.existsSync(path.join(projectDir, '.codex', 'agents', 'issue-worker', 'codex.toml')),
          );
          assert.ok(!fs.existsSync(path.join(projectDir, '.codex', 'agents', 'issue-worker.md')));

          // Validação contra o runtime real do OpenCode instalado neste ambiente (CLI
          // opencode real, não só checagem de arquivo em disco) — pula com motivo claro se
          // o CLI não estiver disponível (ex.: CI sem opencode instalado).
          if (commandExists('opencode')) {
            const agentListOutput = execFileSync('opencode', ['agent', 'list'], {
              cwd: projectDir,
              encoding: 'utf8',
              shell: process.platform === 'win32',
            });
            assert.match(agentListOutput, /issue-worker \(subagent\)/);
            assert.match(agentListOutput, /code-review \(subagent\)/);
          } else {
            console.info(
              'opencode CLI não encontrado no PATH — pulando validação de runtime real ' +
                '(ver wiki/Compatibilidade-OpenCode.md).',
            );
          }

          // Codex: sem CLI interativo disponível neste ambiente para validar o runtime
          // real (`codex --version` não resolve no PATH) — a cópia/tradução de arquivo
          // acima já está coberta; a validação de runtime fica documentada como pendência
          // manual (ver wiki/Compatibilidade-OpenCode.md e o corpo da issue #300).
          if (!commandExists('codex')) {
            console.info(
              'codex CLI não encontrado no PATH — validação de runtime real do Codex ' +
                'permanece manual (ver issue #300).',
            );
          }
        });
      });
    });
  },
);
