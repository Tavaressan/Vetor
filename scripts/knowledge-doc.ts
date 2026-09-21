// CLI de consumo do Knowledge Provider para skills baseadas em prompt (ex.: /vetor:spec).
// Uma SKILL.md é prosa interpretada por um agente — não pode importar módulos TypeScript
// diretamente. Este wrapper expõe scripts/lib/knowledge-docs.ts como subcomandos, no mesmo
// padrão de scripts/detect-project.ts / scripts/vetor-checks.sh.
//
// Uso:
//   deno run -A scripts/knowledge-doc.ts status [--config <path>]
//   deno run -A scripts/knowledge-doc.ts search-specs "<tema>" [--root <dir>]
//   deno run -A scripts/knowledge-doc.ts create-spec --slug <slug> --project <projeto>
//     [--status <status>] [--root <dir>] [--link <path-do-documento-relacionado>]
//     (corpo da Spec lido via stdin)
//   deno run -A scripts/knowledge-doc.ts update-spec --slug <slug> [--status <status>] [--root <dir>]
//     (corpo da Spec lido via stdin — escolha "update" do fluxo de overwrite, issue #219)
//   deno run -A scripts/knowledge-doc.ts find <identidade> [--root <dir>]
//
// `status` nunca instancia um provider — apenas reporta se a Skill deve usá-lo (ver
// `detectKnowledgeState`, skills/shared/references/knowledge-provider-contract.md). Os demais
// comandos sempre operam sobre `FilesystemKnowledgeProvider`: ObsidianKnowledgeProvider ainda não
// existe neste código (issue #225 em andamento).

import { detectKnowledgeState, FilesystemKnowledgeProvider } from "./lib/knowledge.ts";
import {
  createDocument,
  findByIdentity,
  findRelatedSpecs,
  slugify,
  updateDocument,
} from "./lib/knowledge-docs.ts";

function flagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx === -1 ? undefined : args[idx + 1];
}

/**
 * Descarta um prefixo `<root>/` redundante em `--link`. Context Discovery (skills/spec/SKILL.md
 * passo 1) reporta paths relativos à raiz do repositório (ex.: "docs/adr/001.md"), mas o
 * KnowledgeProvider resolve paths relativos à sua própria raiz (`--root`, default "docs") — sem
 * esta normalização, um link para "docs/adr/001.md" com `--root docs` resolveria para
 * "docs/docs/adr/001.md" (path duplicado, nunca existe) e o `link()` sempre lançaria.
 */
function stripRootPrefix(path: string, root: string): string {
  const prefix = `${root.replace(/\/+$/, "")}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

async function readStdin(): Promise<string> {
  return new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer());
}

async function readConfig(path: string): Promise<unknown> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return null;
  }
}

async function main() {
  const [command, ...rest] = Deno.args;

  try {
    await run(command, rest);
  } catch (err) {
    console.error(`ERRO: ${(err as Error).message}`);
    Deno.exit(1);
  }
}

async function run(command: string, rest: string[]) {
  switch (command) {
    case "status": {
      const configPath = flagValue(rest, "--config") ?? ".claude/vetor/config.json";
      const config = await readConfig(configPath);
      const state = detectKnowledgeState(
        config as Parameters<typeof detectKnowledgeState>[0],
      );
      console.log(JSON.stringify({ enabled: state.status !== "disabled", status: state.status }));
      break;
    }
    case "search-specs": {
      const query = rest[0];
      const root = flagValue(rest, "--root") ?? "docs";
      if (!query || query.startsWith("--")) {
        console.error("ERRO: search-specs exige <tema>.");
        Deno.exit(1);
      }
      const provider = new FilesystemKnowledgeProvider(root);
      const results = await findRelatedSpecs(provider, query);
      console.log(JSON.stringify(results));
      break;
    }
    case "create-spec": {
      const slugArg = flagValue(rest, "--slug");
      const project = flagValue(rest, "--project");
      const status = flagValue(rest, "--status") ?? "draft";
      const root = flagValue(rest, "--root") ?? "docs";
      const linkArg = flagValue(rest, "--link");
      if (!slugArg || !project) {
        console.error("ERRO: create-spec exige --slug e --project.");
        Deno.exit(1);
      }
      // Sempre normalizado via slugify — nunca usa o argumento literal. Sem isso, um --slug com
      // caracteres reservados de filesystem (ex.: "a:b" no Windows/NTFS) grava fora do path
      // esperado (Alternate Data Stream) em vez de falhar de forma clara.
      const slug = slugify(slugArg);
      if (!slug) {
        console.error(`ERRO: --slug "${slugArg}" não produz um slug válido (kebab-case).`);
        Deno.exit(1);
      }
      const provider = new FilesystemKnowledgeProvider(root);
      const body = await readStdin();
      const { identity, path } = await createDocument(provider, {
        type: "spec",
        slug,
        project,
        status,
        body,
      });
      if (linkArg) {
        const link = stripRootPrefix(linkArg, root);
        try {
          await provider.link(path, link);
        } catch (err) {
          // A Spec já foi criada com sucesso — reporta o path real em vez de mascarar o
          // resultado como falha total, mas sinaliza claramente que o link não foi criado.
          console.error(
            `AVISO: Spec criada em "${path}" (${identity}), mas o link para "${link}" falhou: ${
              (err as Error).message
            }`,
          );
          console.log(JSON.stringify({ identity, path, linkFailed: true }));
          Deno.exit(1);
        }
      }
      console.log(JSON.stringify({ identity, path }));
      break;
    }
    case "update-spec": {
      const slugArg = flagValue(rest, "--slug");
      const status = flagValue(rest, "--status");
      const root = flagValue(rest, "--root") ?? "docs";
      if (!slugArg) {
        console.error("ERRO: update-spec exige --slug.");
        Deno.exit(1);
      }
      const slug = slugify(slugArg);
      if (!slug) {
        console.error(`ERRO: --slug "${slugArg}" não produz um slug válido (kebab-case).`);
        Deno.exit(1);
      }
      const provider = new FilesystemKnowledgeProvider(root);
      const body = await readStdin();
      const { identity, path } = await updateDocument(provider, {
        type: "spec",
        slug,
        status,
        body,
      });
      console.log(JSON.stringify({ identity, path }));
      break;
    }
    case "find": {
      const identity = rest[0];
      const root = flagValue(rest, "--root") ?? "docs";
      if (!identity || identity.startsWith("--")) {
        console.error("ERRO: find exige <identidade>.");
        Deno.exit(1);
      }
      const provider = new FilesystemKnowledgeProvider(root);
      const result = await findByIdentity(provider, identity);
      console.log(JSON.stringify(result));
      break;
    }
    default:
      console.error(
        "Uso: knowledge-doc.ts <status|search-specs|create-spec|update-spec|find> ... (ver comentário no topo do arquivo)",
      );
      Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
