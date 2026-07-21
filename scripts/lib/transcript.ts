// Parsing do transcript de sessão para o hook Stop: detecta edições registradas no
// transcript (.jsonl) que não têm correspondência no estado atual dos arquivos em disco —
// sinal de sessão interrompida no meio de um Edit/Write. Só relata; nunca aplica a
// recuperação sozinho.

export interface EditRecord {
  toolUseId: string;
  filePath: string;
  kind: "edit" | "write";
  /** Trecho (Edit) ou conteúdo completo (Write) esperado no arquivo após a edição. */
  expected: string;
  /** true quando não há tool_result correspondente: a sessão parou no meio da chamada. */
  incomplete: boolean;
}

export interface Divergence {
  filePath: string;
  kind: "edit" | "write";
  reason: string;
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  is_error?: boolean;
}

interface TranscriptLine {
  type?: string;
  message?: { role?: string; content?: unknown };
}

function isToolUse(block: unknown): block is ToolUseBlock {
  return !!block && typeof block === "object" &&
    (block as { type?: unknown }).type === "tool_use";
}

function isToolResult(block: unknown): block is ToolResultBlock {
  return !!block && typeof block === "object" &&
    (block as { type?: unknown }).type === "tool_result";
}

/**
 * Lê o `.jsonl` do transcript e devolve, por arquivo, a última edição (Edit/Write) cuja
 * chamada não foi explicitamente rejeitada (tool_result com `is_error: true`). Edições
 * anteriores no mesmo arquivo são supérfluas: o estado esperado em disco é o da última.
 */
export function parseTranscript(raw: string): EditRecord[] {
  const toolUses = new Map<string, EditRecord>();
  const results = new Map<string, boolean>(); // toolUseId -> is_error

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // linha corrompida (transcript truncado no meio da escrita): ignora, não afirma
    }

    const content = parsed.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (isToolUse(block) && (block.name === "Edit" || block.name === "Write")) {
        const filePath = block.input?.file_path;
        if (typeof filePath !== "string") continue;

        if (block.name === "Write") {
          const fileContent = block.input?.content;
          if (typeof fileContent !== "string") continue;
          toolUses.set(block.id, {
            toolUseId: block.id,
            filePath,
            kind: "write",
            expected: fileContent,
            incomplete: true,
          });
        } else {
          const newString = block.input?.new_string;
          if (typeof newString !== "string") continue;
          toolUses.set(block.id, {
            toolUseId: block.id,
            filePath,
            kind: "edit",
            expected: newString,
            incomplete: true,
          });
        }
      } else if (isToolResult(block)) {
        results.set(block.tool_use_id, block.is_error === true);
      }
    }
  }

  const byFile = new Map<string, EditRecord>();
  for (const record of toolUses.values()) {
    const isError = results.get(record.toolUseId);
    if (isError === true) continue; // chamada rejeitada: nada foi persistido de propósito
    record.incomplete = isError === undefined;
    byFile.set(record.filePath, record); // a última chamada por arquivo sobrescreve a anterior
  }

  return [...byFile.values()];
}

/** True quando `filePath` está dentro de `repoRoot` (mesmo diretório ou subdiretório). */
function isInsideRepo(filePath: string, repoRoot: string): boolean {
  return filePath === repoRoot || filePath.startsWith(repoRoot.replace(/\/$/, "") + "/");
}

/**
 * Compara cada edição pendente com o conteúdo atual em disco. `readFile` deve devolver
 * `null` quando o arquivo não existe, e nunca lançar.
 *
 * `repoRoot`, quando informado, restringe a checagem a arquivos dentro do repositório atual:
 * arquivos fora dele (ex.: `~/.claude/**`, geridos por outros subsistemas) são ignorados,
 * pois podem sofrer mutação legítima por processos alheios à sessão (issue #87).
 */
export function findDivergences(
  records: EditRecord[],
  readFile: (path: string) => string | null,
  repoRoot?: string,
): Divergence[] {
  const divergences: Divergence[] = [];

  for (const record of records) {
    if (repoRoot !== undefined && !isInsideRepo(record.filePath, repoRoot)) continue;

    const disk = readFile(record.filePath);

    if (disk === null) {
      divergences.push({
        filePath: record.filePath,
        kind: record.kind,
        reason: "arquivo não encontrado em disco",
      });
      continue;
    }

    const persisted = record.kind === "write"
      ? disk === record.expected
      : disk.includes(record.expected);

    if (!persisted) {
      divergences.push({
        filePath: record.filePath,
        kind: record.kind,
        reason: record.incomplete
          ? "chamada de ferramenta sem tool_result no transcript (sessão interrompida no meio da edição)"
          : "conteúdo em disco não reflete a última edição registrada no transcript",
      });
    }
  }

  return divergences;
}
