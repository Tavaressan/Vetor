// Safety gate do Vetor para o Google Antigravity (hook PreToolUse, matcher run_command).
//
// Contrato do Antigravity (antigravity.google/docs/hooks, hooks.json):
// - Recebe o evento em JSON no stdin; para run_command, o comando e o diretório de execução
//   vêm em toolCall.args:
//   { "toolCall": { "name": "run_command", "args": { "CommandLine": "...", "Cwd": "..." } } }
// - Responde em JSON no stdout, com exit 0 nos dois casos:
//   { "decision": "allow" }  ou  { "decision": "deny", "reason": "..." }
//
// A política (git destrutivo, branch protegida, worker não-GREEN) é a mesma do hook do Claude
// Code e vive em scripts/lib/safety-policy.ts. O guard de escrita do safety-check.ts não tem
// equivalente aqui: o matcher do Antigravity só cobre run_command.
//
// Falha aberta: JSON inválido ou erro interno liberam o comando, com o diagnóstico em stderr —
// um hook quebrado não pode travar o agente. O stdout leva somente o JSON de decisão, e o
// diagnóstico traz a classe e a mensagem do erro, nunca o payload nem o comando.

import { evaluateShellCommand, type SafetyDecision } from "./lib/safety-policy.ts";
import { resolveWorktree } from "./lib/status.ts";

interface AntigravityEvent {
  toolCall?: { args?: { CommandLine?: unknown; Cwd?: unknown } };
}

const ALLOW: SafetyDecision = { decision: "allow" };

export async function handleEvent(
  readInput: () => Promise<string>,
  evaluate: typeof evaluateShellCommand = evaluateShellCommand,
): Promise<SafetyDecision> {
  try {
    const raw = await readInput();

    let event: AntigravityEvent | null;
    try {
      event = JSON.parse(raw);
    } catch {
      // A mensagem do JSON.parse repete trechos da entrada (que pode conter o comando): só a classe.
      console.error("[vetor-safety-hook] JSON inválido recebido no stdin (SyntaxError); liberado.");
      return ALLOW;
    }

    const args = event?.toolCall?.args;
    const command = args?.CommandLine;
    if (typeof command !== "string") return ALLOW;

    const cwd = typeof args?.Cwd === "string" && args.Cwd ? args.Cwd : Deno.cwd();
    return await evaluate(command, () => resolveWorktree(cwd));
  } catch (error) {
    const detail = error instanceof Error
      ? `${error.name}: ${error.message}`
      : "valor lançado que não é um Error";
    console.error(`[vetor-safety-hook] erro interno; liberado. ${detail}`);
    return ALLOW;
  }
}

if (import.meta.main) {
  const decision = await handleEvent(() => new Response(Deno.stdin.readable).text());
  console.log(JSON.stringify(decision));
}
