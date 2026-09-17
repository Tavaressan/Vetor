// Persistência do estado de validação de `/vetor:spec-validate` (#222, #203 §12) — separada do
// arquivo da Spec, para nunca poluir seu conteúdo com informação de execução do validador.
//
// Convenção de path segue o mesmo diretório dos demais artefatos internos do Vetor
// (`.claude/vetor/...`, ver skills/shared/references/agent-status.template.md) — não o
// `.vetor/specs/` sugerido como exemplo em #203 §12, que descreve um formato equivalente, não uma
// obrigação literal.

import type { ValidationRecord } from "./spec-quality-report.ts";

export interface ValidationState {
  specPath: string;
  history: ValidationRecord[];
}

/** Deriva o path de persistência a partir do path da Spec — função pura, sem tocar o filesystem
 * (testável sem risco de deixar artefato órfão em `.claude/vetor/specs/`, que é gitignored e por
 * isso não apareceria em `git status`). */
export function validationPathFor(
  specPath: string,
  root = ".claude/vetor/specs",
): string {
  const normalized = specPath.replaceAll("\\", "/");
  const base = normalized.split("/").pop()!.replace(/\.[^./]+$/, "");
  return `${root}/${base}.validation.json`;
}

export async function loadValidationState(path: string): Promise<ValidationState | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return null;
  }
}

export async function saveValidationState(path: string, state: ValidationState): Promise<void> {
  const dir = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
  if (dir) await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(state, null, 2) + "\n");
}
