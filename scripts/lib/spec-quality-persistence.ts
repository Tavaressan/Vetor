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
 * isso não apareceria em `git status`).
 *
 * #269: usa o path relativo completo (sem extensão, `/` virando `-`), não só o basename — duas
 * Specs com o mesmo nome em pastas diferentes (ex.: "docs/specs/auth/x.md" e
 * "docs/specs/billing/x.md") precisam de arquivos de histórico distintos.
 *
 * Migração: essa mudança altera o nome do arquivo derivado para toda Spec fora da raiz do diretório
 * de histórico (ex.: "docs/specs/x.md" → "docs-specs-x.validation.json", antes "x.validation.json").
 * Um histórico já persistido com o nome antigo fica órfão (não é lido, não é migrado) — a próxima
 * validação dessa Spec recomeça o histórico de refinamento do zero, resetando o contador de
 * `MAX_REFINEMENT_CYCLES` (#222). Aceitável: o histórico é metadado informativo/gitignored, não
 * conteúdo da Spec — perdê-lo uma vez não perde trabalho, só o contador de ciclos já percorridos. */
export function validationPathFor(
  specPath: string,
  root = ".claude/vetor/specs",
): string {
  const normalized = specPath.replaceAll("\\", "/").replace(/^\.?\/+/, "");
  const withoutExt = normalized.replace(/\.[^./]+$/, "");
  const slug = withoutExt.replaceAll("/", "-");
  return `${root}/${slug}.validation.json`;
}

/**
 * Resolve o path default de persistência a partir da raiz do repositório git (`git rev-parse
 * --show-toplevel`), não do cwd do processo — sem isso, duas invocações do CLI a partir de
 * subdiretórios diferentes do mesmo checkout resolveriam paths relativos diferentes para o mesmo
 * histórico, quebrando a continuidade do refinamento iterativo (#222, #203 §10). Quando não é
 * possível resolver a raiz (não é um repositório git, ou `git` indisponível), cai no path relativo
 * ao cwd (`validationPathFor` sem `root` customizado) — mesmo comportamento de antes desta função
 * existir, nunca uma falha dura.
 */
export async function resolveDefaultHistoryPath(
  specPath: string,
  cwd = Deno.cwd(),
): Promise<string> {
  try {
    const output = await new Deno.Command("git", {
      args: ["rev-parse", "--show-toplevel"],
      cwd,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (output.code === 0) {
      const toplevel = new TextDecoder().decode(output.stdout).trim();
      if (toplevel) return validationPathFor(specPath, `${toplevel}/.claude/vetor/specs`);
    }
  } catch {
    // git indisponível — cai no fallback relativo abaixo.
  }
  return validationPathFor(specPath);
}

export async function loadValidationState(path: string): Promise<ValidationState | null> {
  try {
    return JSON.parse(await Deno.readTextFile(path));
  } catch {
    return null;
  }
}

export async function saveValidationState(path: string, state: ValidationState): Promise<void> {
  // #269: `Math.max(-1, -1) = -1` quando o path não tem separador — `slice(0, -1)` cortava o
  // último caractere do path em vez de resultar em string vazia, criando um diretório espúrio.
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = separatorIndex === -1 ? "" : path.slice(0, separatorIndex);
  if (dir) await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(path, JSON.stringify(state, null, 2) + "\n");
}
