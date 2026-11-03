// Sonda compartilhada pelos testes que exercitam o binário `opencode` real (dependência externa
// opcional, não travável via deno.lock). Usa só `--help`: barata, sem tocar em projeto nem rede.
//
// - Binário ausente, versão sem o subcomando ou sonda estourando o timeout => teste ignorado, com
//   `console.warn` explicando o motivo.
// - `VETOR_REQUIRE_OPENCODE=1` (CI com opencode compatível): qualquer um desses casos lança erro
//   em vez de ignorar, para o teste não sumir em silêncio.

const PROBE_TIMEOUT_MS = 5_000;

async function help(path: string[]): Promise<string> {
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const child = new Deno.Command("opencode", {
    args: [...path, "--help"],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal,
  });
  const out = await child.output();
  if (!out.success) throw new Error(`\`opencode ${path.join(" ")} --help\` saiu com ${out.code}`);
  return new TextDecoder().decode(out.stdout) + new TextDecoder().decode(out.stderr);
}

/**
 * `true` quando o `--help` de `opencode <path>` lista `subcommand`. Reconhece os dois formatos:
 * a seção `SUBCOMMANDS` do opencode 2.x e a seção `Commands:` do yargs (opencode 1.x), cujas linhas
 * repetem o caminho completo (`opencode agent list   descrição`).
 */
export function listsSubcommand(helpText: string, path: string[], subcommand: string): boolean {
  const section = helpText.split(/^SUBCOMMANDS\s*$/m)[1] ?? "";
  const names = section.split("\n").slice(1).map((line) => line.match(/^\s+(.+?)(?:\s{2,}|$)/)?.[1])
    .flatMap((cell) => (cell ?? "").split(",").map((name) => name.trim()));
  if (names.includes(subcommand)) return true;

  const commands = helpText.split(/^Commands:\s*$/m)[1]?.split(/\n\s*\n/)[0] ?? "";
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = new RegExp(
    `^\\s+opencode\\s+${[...path, subcommand].map(escape).join("\\s+")}(?:\\s|$)`,
  );
  return commands.split("\n").some((l) => line.test(l));
}

/** Retorna o motivo de `opencode <args>` não estar disponível, ou `undefined` se estiver. */
async function unsupportedReason(args: string[]): Promise<string | undefined> {
  const path = args.filter((arg) => !arg.startsWith("-"));
  try {
    for (let i = 0; i < path.length; i++) {
      if (!listsSubcommand(await help(path.slice(0, i)), path.slice(0, i), path[i])) {
        return `subcomando \`${path.slice(0, i + 1).join(" ")}\` ausente nesta versão do opencode`;
      }
    }
    return undefined;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "binário `opencode` não encontrado no PATH";
    return `sonda do opencode falhou: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** `true` quando o `opencode` do PATH suporta o subcomando; do contrário avisa e retorna `false`. */
export async function opencodeSupports(args: string[]): Promise<boolean> {
  const reason = await unsupportedReason(args);
  if (reason === undefined) return true;
  const label = `opencode ${args.join(" ")}`;
  if (Deno.env.get("VETOR_REQUIRE_OPENCODE") === "1") {
    throw new Error(`VETOR_REQUIRE_OPENCODE=1, mas ${label} não está disponível: ${reason}`);
  }
  console.warn(`[opencode-probe] teste ignorado (${label}): ${reason}`);
  return false;
}
