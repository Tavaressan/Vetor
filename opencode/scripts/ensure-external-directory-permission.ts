// CLI invocado pelo issue-coordinator portado (opencode/agent/issue-coordinator.md, issue #313)
// antes do primeiro `opencode run --dir <worktree>` da sessão.
//
// Causa raiz da #313: `issue-worker`/`code-review` rodam com `--dir <worktree>` (cwd fixado no
// worktree), mas `config.json`/`module-test-map.md`/status file vivem em
// `<repo-root>/.claude/vetor/`, fora da árvore do worktree — por desenho, é assim que o
// issue-coordinator agrega progresso de múltiplos processos `opencode` isolados via polling de
// arquivo. O OpenCode trata esse acesso como `external_directory` (default `"*": "ask"`); em
// `opencode run` não-interativo (sem TTY) uma permissão `ask` auto-rejeita em vez de bloquear
// esperando input.
//
// Confirmado contra o CLI `opencode` real (v1.18.32): uma regra `permission.external_directory`
// em `<repo-root>/opencode.json` resolve tanto leitura quanto escrita, mesmo com o worktree dois
// níveis abaixo (`<repo-root>/.claude/worktrees/<slug>`) — e a resolução do OpenCode é um walk-up
// de diretório a partir do cwd, independente de git: o arquivo não precisa estar rastreado/
// commitado para ser encontrado a partir de dentro do worktree (diferente de `.opencode/agent/*.md`,
// que só chega ao worktree se estiver commitado — `git worktree add` só propaga arquivos
// rastreados). Por isso este script grava um `opencode.json` **local, não versionado** na raiz do
// repositório principal, em vez de reescrever um `.md` de agent compartilhado (opção 1 da issue,
// descartada por risco de corrida entre workers paralelos editando o mesmo arquivo).
//
// Issue #389 — a premissa do walk-up acima não vale no opencode 1.19.0: com `--dir <worktree>`, a
// config resolvida (`opencode debug config` rodado no worktree) não traz a regra gravada só na
// raiz, e o worker volta a ser auto-rejeitado. Por isso, quando recebe `worktree`, o script grava
// a mesma regra também em `<worktree>/opencode.json` — arquivo que o 1.19 carrega — e põe
// `/opencode.json` no `info/exclude` do repositório (compartilhado pelos worktrees), para o worker
// não commitar um path absoluto da máquina. Se o projeto versiona `opencode.json`, o script recusa
// (código 1): mesclar ali alteraria um arquivo rastreado do usuário dentro do worktree.
//
// Idempotente por desenho: seguro de chamar a cada dispatch (Fase 3 e Fase 4, inclusive
// redespacho/`--resume`, onde a Fase 3 não roda de novo) sem the coordinator precisar rastrear se
// já rodou. Nunca sobrescreve um `opencode.json` existente às cegas — mescla preservando outras
// chaves (ex.: `mcp`, outras regras de `permission.external_directory`) e recusa (código 1) se o
// arquivo existente não for JSON válido, em vez de arriscar destruir configuração do usuário.
//
// Contrato de stdin:
//   { cwd?: string, worktree?: string }
// Sem `cwd`, usa `Deno.cwd()`. `worktree` (absoluto ou relativo a `cwd`) é o diretório que o
// worker recebe em `--dir`.
//
// Códigos de saída:
//   0 - regra presente (criada, mesclada, ou já estava correta) na raiz e, se informado, no
//       worktree.
//   1 - opencode.json existente não é JSON válido, ou `<worktree>/opencode.json` é versionado;
//       a mensagem de stderr diz o que fazer.

import { readJson } from "../../scripts/lib/project.ts";
import { resolveWorktree } from "../../scripts/lib/status.ts";
import { normalizeCwd } from "./lib/cwd.ts";

interface Payload {
  cwd?: string;
  worktree?: string;
}

interface OpencodeConfig {
  "$schema"?: string;
  permission?: {
    external_directory?: Record<string, string>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

async function git(args: string[], cwd: string): Promise<{ success: boolean; stdout: string }> {
  const out = await new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "null" })
    .output();
  return { success: out.success, stdout: new TextDecoder().decode(out.stdout).trim() };
}

/** Acrescenta `pattern` ao `info/exclude` compartilhado pelos worktrees, se ainda não estiver lá. */
async function ensureExcluded(worktreeDir: string, pattern: string): Promise<void> {
  const { stdout: excludePath } = await git(
    ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"],
    worktreeDir,
  );
  let current = "";
  try {
    current = await Deno.readTextFile(excludePath);
  } catch {
    await Deno.mkdir(excludePath.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
  }
  if (current.split(/\r?\n/).some((line) => line.trim() === pattern)) return;
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  await Deno.writeTextFile(excludePath, `${current}${separator}${pattern}\n`);
}

async function ensureRule(configPath: string, rulePath: string): Promise<void> {
  let config: OpencodeConfig;
  if (exists(configPath)) {
    try {
      config = readJson(configPath) as OpencodeConfig;
    } catch {
      console.error(
        `${configPath} existe mas não é JSON válido — recuse sobrescrever. Adicione manualmente ` +
          `"permission.external_directory": { "${rulePath}": "allow" } a esse arquivo.`,
      );
      Deno.exit(1);
    }
  } else {
    config = { "$schema": "https://opencode.ai/config.json" };
  }

  const currentRule = config.permission?.external_directory?.[rulePath];
  if (currentRule === "allow") {
    return;
  }

  config.permission = {
    ...config.permission,
    external_directory: {
      ...config.permission?.external_directory,
      [rulePath]: "allow",
    },
  };

  await Deno.writeTextFile(configPath, JSON.stringify(config, null, 2) + "\n");
}

async function main() {
  const raw = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer());

  let input: Payload;
  try {
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }

  const cwd = normalizeCwd(input.cwd ?? Deno.cwd());
  const worktree = await resolveWorktree(cwd);
  const root = worktree?.root ?? cwd;
  const rulePath = `${root}/.claude/vetor/**`;

  await ensureRule(`${root}/opencode.json`, rulePath);

  if (!input.worktree) return;
  const worktreeArg = normalizeCwd(input.worktree);
  const worktreeDir = /^([A-Za-z]:)?[\\/]/.test(worktreeArg)
    ? worktreeArg
    : `${cwd}/${worktreeArg}`;
  if ((await git(["ls-files", "--error-unmatch", "opencode.json"], worktreeDir)).success) {
    console.error(
      `${worktreeDir}/opencode.json é versionado no projeto — recuse alterá-lo (o worker o ` +
        `commitaria com um path absoluto desta máquina). Adicione manualmente ` +
        `"permission.external_directory": { "${rulePath}": "allow" } a um opencode.json não ` +
        `versionado que o worker carregue, ou rode o worker de forma interativa (issue #389).`,
    );
    Deno.exit(1);
  }
  await ensureRule(`${worktreeDir}/opencode.json`, rulePath);
  await ensureExcluded(worktreeDir, "/opencode.json");
}

await main();
