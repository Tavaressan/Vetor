// Aviso de projeto não inicializado (hook SessionStart).
//
// As skills do Vetor dependem de .claude/vetor/config.json (runtime, testCommand) e do
// module-test-map.md. Sem eles, o fix-loop e o worktree-ship falham no meio do caminho,
// não na entrada. Melhor dizer isso no início da sessão.
//
// Contrato do Claude Code: exit 0 + `hookSpecificOutput.additionalContext`. Projeto já
// configurado → silêncio.

import { readJson } from "./lib/project.ts";

const CONFIG_FILE = ".claude/vetor/config.json";

interface HookInput {
  cwd?: string;
}

function quiet(): never {
  Deno.exit(0);
}

function notify(message: string): never {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: message,
    },
  }));
  Deno.exit(0);
}

async function main() {
  const raw = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer());

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    quiet();
  }

  // O projeto é o cwd da sessão, não o do processo do hook.
  const cwd = input.cwd ?? Deno.cwd();

  let config: { runtime?: string };
  try {
    config = readJson(`${cwd}/${CONFIG_FILE}`) as { runtime?: string };
  } catch {
    notify(
      "Vetor: este projeto ainda não foi inicializado (`.claude/vetor/config.json` ausente). " +
        "Rode `/vetor` antes de usar as skills de worktree, fix-loop ou ship.",
    );
  }

  if (!config.runtime || config.runtime === "unknown") {
    notify(
      "Vetor: o runtime deste projeto não foi detectado (`runtime: unknown` em " +
        "`.claude/vetor/config.json`). Os comandos de teste em `.claude/vetor/module-test-map.md` " +
        "precisam de ajuste manual, senão o fix-loop não tem o que rodar.",
    );
  }

  quiet();
}

await main();
