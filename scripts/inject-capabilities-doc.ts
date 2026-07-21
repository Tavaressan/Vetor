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

/** Resumo padrão inserido em CLAUDE.md/AGENTS.md — mantido em um só lugar (fonte única). */
export const CAPABILITIES_BODY = `## Vetor (plugin instalado)

Automação de ciclo de desenvolvimento (issues → worktrees → fix loop → PR). Skills e agentes:

- \`/vetor\` — inicializa/atualiza a configuração do Vetor neste projeto.
- \`/vetor:backlog\` (\`backlog-ideator\`) — propõe issues a partir de gaps do código/docs.
- \`/vetor:coordinator\` (\`issue-coordinator\`) — orquestra workers para issues do backlog.
- \`/vetor:worktree-create\` (\`worktree-create\`) — cria um worktree isolado para uma issue.
- \`/vetor:fix-loop\` (\`fix-loop-agent\`) — itera build/test até verde num worktree existente.
- \`/vetor:worktree-ship\` (\`worktree-ship\`) — abre PR a partir de um worktree em estado verde.
- \`/vetor:guardian\` (\`guardian\`) — auditoria de banco de dados por stack (condicional).
- \`/vetor:retro\` (\`retro\`) — retrospectiva do ciclo de trabalho.
- Agentes \`code-review\` e \`issue-worker\` — usados internamente pelos comandos acima.

Detalhes de cada skill: \`skills/<nome>/SKILL.md\` no plugin.`;

if (import.meta.main) {
  const path = Deno.args[0];
  if (!path) {
    console.error("uso: inject-capabilities-doc.ts <caminho-do-arquivo>");
    Deno.exit(1);
  }
  const result = injectBlock(path, CAPABILITIES_BODY);
  console.log(JSON.stringify({ path, result }));
}
