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
  /** Índice de ordem (0-based) no transcript — usado para comparar com chamadas Bash posteriores. */
  order: number;
}

export interface BashRecord {
  toolUseId: string;
  command: string;
  /** Índice de ordem (0-based) no transcript — usado para saber se veio depois de uma edição. */
  order: number;
}

export interface Divergence {
  filePath: string;
  kind: "edit" | "write";
  reason: string;
  /** Conteúdo esperado (mesmo valor de EditRecord.expected) — chave usada para acknowledgment
   * por sessão (issue #137): se o mesmo filePath voltar a divergir com um `expected` diferente,
   * é uma divergência nova, não a mesma já revisada. */
  expected: string;
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

export interface ParseResult {
  edits: EditRecord[];
  bashCommands: BashRecord[];
}

/**
 * Lê o `.jsonl` do transcript e devolve:
 * - `edits`: por arquivo, a última edição (Edit/Write) cuja chamada não foi rejeitada
 * - `bashCommands`: todas as chamadas Bash bem-sucedidas, em ordem de aparição
 *
 * Edições anteriores no mesmo arquivo são supérfluas: o estado esperado em disco é o da última.
 * As chamadas Bash são usadas para detectar remoções/renomeações legítimas posteriores a uma edição.
 */
export function parseTranscript(raw: string): ParseResult {
  const toolUses = new Map<string, EditRecord>();
  const bashUses = new Map<string, BashRecord>();
  const results = new Map<string, boolean>(); // toolUseId -> is_error
  let order = 0;

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

        const currentOrder = order++;
        if (block.name === "Write") {
          const fileContent = block.input?.content;
          if (typeof fileContent !== "string") continue;
          toolUses.set(block.id, {
            toolUseId: block.id,
            filePath,
            kind: "write",
            expected: fileContent,
            incomplete: true,
            order: currentOrder,
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
            order: currentOrder,
          });
        }
      } else if (isToolUse(block) && block.name === "Bash") {
        const cmd = block.input?.command;
        if (typeof cmd !== "string") continue;
        bashUses.set(block.id, {
          toolUseId: block.id,
          command: cmd,
          order: order++,
        });
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

  const bashCommands = [...bashUses.values()].filter((b) => {
    return results.get(b.toolUseId) !== true;
  });

  return { edits: [...byFile.values()], bashCommands };
}

/** True quando `filePath` está dentro de `repoRoot` (mesmo diretório ou subdiretório). */
function isInsideRepo(filePath: string, repoRoot: string): boolean {
  return filePath === repoRoot || filePath.startsWith(repoRoot.replace(/\/$/, "") + "/");
}

/**
 * True quando `filePath` pertence ao `~/.claude/**` do usuário (onde vivem memória, projects e
 * configs) — mutação legítima por processo alheio à sessão (issue #87), excluída
 * **incondicionalmente**, sem depender de haver um repo git detectável (issue #136: antes, sem
 * `repoRoot`, essa exclusão inteira era ignorada).
 *
 * A âncora no home do usuário é deliberada: um `.claude/` versionado dentro do repo-alvo é
 * conteúdo do projeto e continua sendo verificado normalmente.
 */
function isKnownSubsystemPath(filePath: string): boolean {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");
  if (home === undefined) return false;

  const prefix = home.replace(/\\/g, "/").replace(/\/$/, "") + "/.claude/";
  return filePath.replace(/\\/g, "/").startsWith(prefix);
}

/** Comandos que podem remover ou renomear um arquivo. */
const REMOVE_COMMANDS =
  /\bgit\s+worktree\s+remove\b|\bgit\s+rm\b|\brm\b|\bmv\b|\bunlink\b|\bshred\b/;

/**
 * True quando um BashRecord posterior à edição menciona explicitamente o caminho do arquivo
 * como alvo de remoção/renomeação.
 */
function wasRemovedByCommand(
  filePath: string,
  editOrder: number,
  bashCommands: BashRecord[],
): boolean {
  for (const cmd of bashCommands) {
    if (cmd.order <= editOrder) continue;
    if (!REMOVE_COMMANDS.test(cmd.command)) continue;
    if (cmd.command.includes(filePath)) return true;
    // Para `git worktree remove <dir>`, checa se o arquivo está dentro do worktree removido.
    const worktreeMatch = cmd.command.match(/\bgit\s+worktree\s+remove\s+(\S+)/);
    if (worktreeMatch) {
      const dir = worktreeMatch[1].replace(/\/$/, "");
      if (filePath.startsWith(dir + "/") || filePath === dir) return true;
    }
  }
  return false;
}

/**
 * Compara cada edição pendente com o conteúdo atual em disco. `readFile` deve devolver
 * `null` quando o arquivo não existe, e nunca lançar.
 *
 * Arquivos de subsistemas conhecidos (ex.: `~/.claude/**`, geridos por outros processos) são
 * ignorados incondicionalmente — mutação legítima alheia à sessão (issue #87).
 *
 * `repoRoot`, quando informado, restringe a checagem aos demais arquivos dentro do repositório
 * atual. Quando `repoRoot` é `undefined` (sessão fora de um repo git), não há repo-alvo contra
 * o qual verificar (o propósito original é a #46) — em vez de verificar tudo, a divergência é
 * tratada como não verificável e ignorada em silêncio (issue #136).
 *
 * `bashCommands`, quando fornecido, permite detectar remoções/renomeações legítimas que
 * ocorreram após a edição (issue #127).
 */
export function findDivergences(
  records: EditRecord[],
  readFile: (path: string) => string | null,
  repoRoot?: string,
  isResolvedExternally?: (path: string) => boolean,
  bashCommands?: BashRecord[],
): Divergence[] {
  const divergences: Divergence[] = [];

  for (const record of records) {
    if (isKnownSubsystemPath(record.filePath)) continue;

    // Sem repo git detectável não há como restringir a checagem ao repo-alvo (o propósito
    // original da #46) — em vez de verificar tudo (bug da #136), tratamos como não verificável
    // e ficamos em silêncio.
    if (repoRoot === undefined) continue;
    if (!isInsideRepo(record.filePath, repoRoot)) continue;

    const disk = readFile(record.filePath);

    if (disk === null) {
      if (bashCommands && wasRemovedByCommand(record.filePath, record.order ?? 0, bashCommands)) {
        continue;
      }
      divergences.push({
        filePath: record.filePath,
        kind: record.kind,
        reason: "arquivo não encontrado em disco",
        expected: record.expected,
      });
      continue;
    }

    const persisted = record.kind === "write"
      ? disk === record.expected
      : disk.includes(record.expected);

    if (!persisted) {
      if (isResolvedExternally && isResolvedExternally(record.filePath)) continue;

      divergences.push({
        filePath: record.filePath,
        kind: record.kind,
        reason: record.incomplete
          ? "chamada de ferramenta sem tool_result no transcript (sessão interrompida no meio da edição)"
          : "conteúdo em disco não reflete a última edição registrada no transcript",
        expected: record.expected,
      });
    }
  }

  return divergences;
}
