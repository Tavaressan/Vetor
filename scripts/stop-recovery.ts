// Recuperação de trabalho perdido a partir do transcript da sessão (hook Stop).
//
// Motivação (issue #46): uma sessão interrompida no meio de um Edit — falha de rede, kill,
// timeout — pode deixar o transcript relatando uma edição que nunca chegou a ser escrita em
// disco. Sem isto, o usuário só descobre no próximo `git diff`/teste, se descobrir. Aqui, ao
// fim da sessão, comparamos o transcript com o estado atual dos arquivos e REPORTAMOS a
// divergência — nunca aplicamos a recuperação sozinhos: quem decide é quem está na sessão.
//
// Contrato do Claude Code: o payload do Stop traz `transcript_path` (arquivo .jsonl) na
// raiz e `stop_hook_active` — true quando este hook já bloqueou a parada uma vez nesta
// mesma invocação. Isso evita o loop infinito sem precisar do arquivo sentinela que
// check-status.ts usa para o SubagentStop (que não tem esse campo).

import { findDivergences, parseTranscript } from "./lib/transcript.ts";

interface HookInput {
  transcript_path?: string;
  stop_hook_active?: boolean;
}

function quiet(): never {
  Deno.exit(0);
}

function report(reason: string): never {
  console.log(JSON.stringify({ decision: "block", reason }));
  Deno.exit(0);
}

function readFile(path: string): string | null {
  try {
    return Deno.readTextFileSync(path);
  } catch {
    return null;
  }
}

/** Root do repositório git atual, ou `undefined` se não for possível determiná-lo. */
function repoRoot(): string | undefined {
  try {
    const { success, stdout } = new Deno.Command("git", {
      args: ["rev-parse", "--show-toplevel"],
      stdout: "piped",
      stderr: "null",
    }).outputSync();
    if (!success) return undefined;
    return new TextDecoder().decode(stdout).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  const raw = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer());

  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    quiet();
  }

  // Já reportamos uma vez nesta parada: reportar de novo travaria a sessão num loop.
  if (input.stop_hook_active) quiet();

  const transcriptPath = input.transcript_path;
  if (!transcriptPath) quiet();

  const transcript = readFile(transcriptPath);
  if (transcript === null) quiet();

  const records = parseTranscript(transcript);
  const divergences = findDivergences(records, readFile, repoRoot());

  if (divergences.length === 0) quiet();

  const list = divergences.map((d) => `- ${d.filePath} (${d.kind}): ${d.reason}`).join("\n");

  report(
    "Vetor: possível trabalho perdido detectado no transcript desta sessão — edições que não " +
      "correspondem ao estado atual dos arquivos em disco:\n\n" + list +
      "\n\nRevise cada item manualmente antes de reaplicar; este hook não altera nenhum arquivo.",
  );
}

await main();
