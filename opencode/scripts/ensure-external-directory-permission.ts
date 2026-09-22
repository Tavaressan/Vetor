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
// Idempotente por desenho: seguro de chamar a cada dispatch (Fase 3 e Fase 4, inclusive
// redespacho/`--resume`, onde a Fase 3 não roda de novo) sem the coordinator precisar rastrear se
// já rodou. Nunca sobrescreve um `opencode.json` existente às cegas — mescla preservando outras
// chaves (ex.: `mcp`, outras regras de `permission.external_directory`) e recusa (código 1) se o
// arquivo existente não for JSON válido, em vez de arriscar destruir configuração do usuário.
//
// Contrato de stdin:
//   { cwd?: string }
// Sem `cwd`, usa `Deno.cwd()`.
//
// Códigos de saída:
//   0 - regra presente (criada, mesclada, ou já estava correta) — stdout traz o path do
//       opencode.json.
//   1 - opencode.json existente não é JSON válido; nada foi escrito.

import { normalizeCwd, readJson } from "./lib/project.ts";
import { resolveWorktree } from "./lib/status.ts";

interface Payload {
  cwd?: string;
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

  const configPath = `${root}/opencode.json`;
  const rulePath = `${root}/.claude/vetor/**`;

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
    console.log(configPath);
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
  console.log(configPath);
}

await main();
