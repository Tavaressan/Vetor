// Geração das rules path-scoped do Vetor (.claude/rules/vetor/<runtime>.md).
//
// Rules com frontmatter `paths` só entram no contexto quando o Claude lê um arquivo que
// casa com o glob — custo zero quando irrelevante, e a convenção certa aparece quando o
// agente vai editar aquele tipo de arquivo.
//
// Regra de ouro deste módulo: cada linha gerada corresponde a um fato observado no
// repositório. Fato ausente → linha ausente. Nunca um default plausível.

import type { Conventions, ProjectInfo } from "./project.ts";

export interface RuleFile {
  path: string;
  content: string;
}

export const RULES_DIR = ".claude/rules/vetor";

const ORIGIN =
  "> Gerado por `/vetor` a partir do que foi detectado neste repositório. Editável — o Vetor não sobrescreve sem `--force`.";

function render(paths: string[], title: string, lines: string[]): string {
  const globs = paths.map((p) => `  - "${p}"`).join("\n");
  return `---
paths:
${globs}
---

${ORIGIN}

# ${title}

${lines.map((l) => `- ${l}`).join("\n")}
`;
}

function denoLines(info: ProjectInfo, conv: Conventions): string[] {
  const lines: string[] = [];
  const tasks = conv.denoTasks ?? [];

  if (info.testCommand) lines.push(`Comando de teste: \`${info.testCommand}\`.`);
  if (tasks.includes("fmt") && conv.formatter !== "prettier") {
    lines.push("Formatação: `deno fmt` (task `fmt` no `deno.json`). Não use Prettier.");
  }
  if (tasks.includes("lint")) lines.push("Lint: `deno task lint`.");
  if (tasks.includes("check")) lines.push("Typecheck: `deno task check`.");
  if (conv.denoImportMap) {
    lines.push("O `deno.json` define um mapa `imports`: use os aliases declarados nele.");
  }
  // needsInstall só é true no Deno quando há package.json — sem ele, não existe node_modules.
  if (!info.needsInstall) {
    lines.push(
      "Sem `node_modules`: as dependências vêm do cache global do Deno. Importe por specifier (`jsr:`, `npm:` ou URL).",
    );
  }

  return lines;
}

function nodeLines(info: ProjectInfo, conv: Conventions): string[] {
  const lines: string[] = [];
  const scripts = conv.nodeScripts ?? [];
  const pm = info.packageManager ?? "npm";

  lines.push(
    `Gerenciador de pacotes: \`${pm}\` (detectado pelo lockfile). Não misture com outros.`,
  );
  if (scripts.includes("test")) lines.push(`Comando de teste: \`${pm} test\`.`);
  if (scripts.includes("typecheck")) lines.push(`Typecheck: \`${pm} run typecheck\`.`);
  if (conv.linter && scripts.includes("lint")) {
    lines.push(`Lint: \`${pm} run lint\` (${conv.linter}).`);
  }
  if (conv.formatter && scripts.includes("format")) {
    lines.push(`Formatação: \`${pm} run format\` (${conv.formatter}).`);
  }
  if (conv.hasTsconfig) {
    lines.push("Projeto TypeScript: o `tsconfig.json` da raiz é a fonte das opções de compilação.");
  }
  if (conv.nodeModuleType === "module") {
    lines.push("O `package.json` declara `type: module`: use ESM (`import`), não `require`.");
  }

  return lines;
}

/** Rules para os runtimes suportados. Demais runtimes: nenhuma rule. */
export function renderRules(info: ProjectInfo, conv: Conventions): RuleFile[] {
  if (info.runtime === "deno") {
    const lines = denoLines(info, conv);
    if (lines.length === 0) return [];
    return [{
      path: `${RULES_DIR}/deno.md`,
      content: render(["**/*.ts", "**/*.tsx"], "Convenções Deno (detectadas)", lines),
    }];
  }

  if (info.runtime === "node") {
    const lines = nodeLines(info, conv);
    if (lines.length === 0) return [];
    return [{
      path: `${RULES_DIR}/node.md`,
      content: render(
        ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
        "Convenções Node/TypeScript (detectadas)",
        lines,
      ),
    }];
  }

  return [];
}
