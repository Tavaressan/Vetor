// ⚠️ LEGADO — NÃO USE. Aposentado pela issue #141; não é registrado em hooks/hooks.json
// nem carregado pelo plugin. Mantido apenas como referência histórica.
//
// Este arquivo está na sua última versão em uso (pós-#136/#137), com a guarda incondicional
// de ~/.claude/** e o acknowledgment por sessão já aplicados. A aposentadoria NÃO é correção
// de bug ativo: é decisão de manutenção. A comparação transcript-versus-disco é frágil por
// natureza — qualquer processo legítimo que toque o arquivo depois do Write (formatador,
// linter, hook de outro plugin, o subsistema de memória do Claude Code) produz divergência —
// e cada remendo (#87, #127, #136, #137) estreitou o alcance do hook sem tornar o sinal
// confiável. Ver legacy/stop-recovery/README.md.

// Recuperação de trabalho perdido a partir do transcript da sessão (hook Stop).
//
// Motivação (issue #46): uma sessão interrompida no meio de um Edit — falha de rede, kill,
// timeout — pode deixar o transcript relatando uma edição que nunca chegou a ser escrita em
// disco. Sem isto, o usuário só descobre no próximo `git diff`/teste, se descobrir. Aqui, ao
// fim da sessão, comparamos o transcript com o estado atual dos arquivos e REPORTAMOS a
// divergência — nunca aplicamos a recuperação sozinhos: quem decide é quem está na sessão.
//
// Contrato do Claude Code: o payload do Stop traz `transcript_path` (arquivo .jsonl),
// `session_id` e `stop_hook_active` — true quando este hook já bloqueou a parada uma vez nesta
// mesma invocação. `stop_hook_active` evita o loop infinito dentro de uma mesma parada, mas é
// reiniciado a cada novo turno — por isso o acknowledgment por sessão abaixo (issue #137).

import { type Divergence, findDivergences, parseTranscript } from "./transcript.ts";

interface HookInput {
  transcript_path?: string;
  stop_hook_active?: boolean;
  session_id?: string;
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

/** True se o arquivo não tem modificações pendentes no git (untracked, modified, staged). */
function isGitClean(filePath: string, root: string): boolean {
  try {
    const { success, stdout } = new Deno.Command("git", {
      args: ["status", "--porcelain", "--", filePath],
      cwd: root,
      stdout: "piped",
      stderr: "null",
    }).outputSync();
    if (!success) return false;
    return new TextDecoder().decode(stdout).trim() === "";
  } catch {
    return false;
  }
}

/**
 * Acknowledgment por sessão (issue #137): divergências cuja resolução não é verificável por git
 * (arquivo fora do repo, untracked, ou sessão sem repo) re-bloqueariam o Stop a cada turno, sem
 * mecanismo para o agente marcar como já revisada. Persistimos, por `session_id`, o conjunto de
 * `filePath + expected` já apresentado — se o mesmo arquivo divergir de novo com um `expected`
 * diferente (nova edição), a chave muda e o alerta volta a acontecer.
 */
function ackPath(sessionId: string): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
  return `${home}/.claude/vetor/stop-recovery-ack/${sessionId}.json`;
}

function divergenceKey(d: Divergence): string {
  return `${d.filePath}\u0000${d.expected}`;
}

function readAcked(sessionId: string): Set<string> {
  try {
    const raw = Deno.readTextFileSync(ackPath(sessionId));
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

/** Nunca lança: falha ao persistir só significa que o alerta pode voltar no próximo turno. */
function persistAcked(sessionId: string, keys: Set<string>): void {
  try {
    const path = ackPath(sessionId);
    Deno.mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    Deno.writeTextFileSync(path, JSON.stringify([...keys]));
  } catch {
    // não crítico
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

  const root = repoRoot();
  const { edits: records, bashCommands } = parseTranscript(transcript);
  const allDivergences = findDivergences(records, readFile, root, (path) => {
    return root ? isGitClean(path, root) : false;
  }, bashCommands);

  if (allDivergences.length === 0) quiet();

  const sessionId = input.session_id;
  let divergences = allDivergences;
  if (sessionId) {
    const acked = readAcked(sessionId);
    divergences = allDivergences.filter((d) => !acked.has(divergenceKey(d)));
    for (const d of allDivergences) acked.add(divergenceKey(d));
    persistAcked(sessionId, acked);
  }

  if (divergences.length === 0) quiet();

  const list = divergences.map((d) => `- ${d.filePath} (${d.kind}): ${d.reason}`).join("\n");

  report(
    "Vetor: possível trabalho perdido detectado no transcript desta sessão — edições que não " +
      "correspondem ao estado atual dos arquivos em disco:\n\n" + list +
      "\n\nRevise cada item manualmente antes de reaplicar; este hook não altera nenhum arquivo.",
  );
}

await main();
