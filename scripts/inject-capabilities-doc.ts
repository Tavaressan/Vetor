// Insere/atualiza um bloco delimitado e idempotente com o resumo das capacidades do Vetor em
// CLAUDE.md/AGENTS.md do projeto-alvo. Nunca cria o arquivo — só edita um que já existe (issue #86).

export const START_MARKER = "<!-- vetor:capabilities:start -->";
export const END_MARKER = "<!-- vetor:capabilities:end -->";

export type InjectResult = "inserted" | "updated" | "skipped_missing_file";

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acha o bloco delimitado por START_MARKER/END_MARKER em `path` e o substitui por `body`
 * (envolvido pelos marcadores). Se o bloco não existir, insere no fim do arquivo. Se o
 * arquivo não existir, não faz nada — o Vetor não opina sobre convenção de onboarding do
 * projeto-alvo.
 */
export function injectBlock(path: string, body: string): InjectResult {
  if (!exists(path)) return "skipped_missing_file";

  const current = Deno.readTextFileSync(path);
  const block = `${START_MARKER}\n${body}\n${END_MARKER}`;

  const startIdx = current.indexOf(START_MARKER);
  const endIdx = current.indexOf(END_MARKER);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = current.slice(0, startIdx);
    const after = current.slice(endIdx + END_MARKER.length);
    Deno.writeTextFileSync(path, `${before}${block}${after}`);
    return "updated";
  }

  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  Deno.writeTextFileSync(path, `${current}${separator}${block}\n`);
  return "inserted";
}
