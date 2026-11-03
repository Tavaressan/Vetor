import { assertEquals } from "@std/assert";
import { listsSubcommand } from "./helpers/opencode-probe.ts";

const HELP_2X = `opencode 2.2.2

USAGE
  opencode <command>

SUBCOMMANDS
  run           Roda um prompt
  debug, dbg    Ferramentas de diagnóstico
  serve         Sobe o servidor
`;

const HELP_1X_ROOT = `opencode [project]

Commands:
  opencode run [message..]   run opencode with a message
  opencode agent             manage agents
  opencode debug             debugging and troubleshooting tools

Options:
  -h, --help  show help
`;

const HELP_1X_AGENT = `opencode agent

manage agents

Commands:
  opencode agent create  create a new agent
  opencode agent list    list all available agents

Options:
  -h, --help  show help
`;

Deno.test("opencode-probe: lê a seção SUBCOMMANDS do opencode 2.x, inclusive aliases", () => {
  assertEquals(listsSubcommand(HELP_2X, [], "run"), true);
  assertEquals(listsSubcommand(HELP_2X, [], "dbg"), true);
  assertEquals(listsSubcommand(HELP_2X, [], "agent"), false);
});

Deno.test("opencode-probe: lê a seção Commands: do yargs (opencode 1.x)", () => {
  assertEquals(listsSubcommand(HELP_1X_ROOT, [], "agent"), true);
  assertEquals(listsSubcommand(HELP_1X_ROOT, [], "run"), true);
  assertEquals(listsSubcommand(HELP_1X_AGENT, ["agent"], "list"), true);
  assertEquals(listsSubcommand(HELP_1X_AGENT, ["agent"], "delete"), false);
});

Deno.test("opencode-probe: não confunde opções nem prefixos com subcomandos", () => {
  assertEquals(listsSubcommand(HELP_1X_ROOT, [], "help"), false);
  assertEquals(listsSubcommand(HELP_1X_AGENT, ["agent"], "lis"), false);
  assertEquals(listsSubcommand(HELP_1X_ROOT, [], "agen"), false);
});
