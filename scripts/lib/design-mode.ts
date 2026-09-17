// Detecção de modo de operação de design (#228) — Prototype-first / System-first / Vetor-first —
// e Design System Import + Design Direction persistente.
//
// Vocabulário completo (Design System, Design Direction, Design Signature, Design Contract) em
// skills/shared/references/design-vocabulary.md. Este módulo implementa só a fatia detectável por
// varredura de filesystem: nunca inventa um padrão de interação ou uma direção visual que a
// varredura não sustenta (ver renderPatternsMd — OPEN_QUESTION, não um default plausível).

import { exists, readJson } from "./project.ts";

export type OperationMode = "prototype-first" | "system-first" | "vetor-first";

export type DesignSystemEvidenceKind =
  | "tokens-config"
  | "tokens-file"
  | "components-dir"
  | "storybook"
  | "package-dep";

export interface DesignSystemEvidence {
  relPath: string;
  kind: DesignSystemEvidenceKind;
  /** Info extra legível, ex.: "tailwindcss@3.4.1" (nome do pacote + versão detectada). */
  detail?: string;
  /** Nome do pacote, só presente em kind === "package-dep" — usado para não atribuir a versão
   * de uma dependência à fonte errada (ex.: tailwindcss não é a versão de components/). */
  packageName?: string;
}

export interface OperationModeResult {
  mode: OperationMode;
  hasPrototype: boolean;
  evidence: DesignSystemEvidence[];
}

export interface DesignFile {
  path: string;
  content: string;
}

/**
 * Local canônico de um protótipo já registrado no Vetor. Convenção deliberadamente mínima (#228):
 * o handoff completo de protótipo (extração de estrutura/tokens/estados) é escopo de issue futura
 * (#213 "Handoff de protótipos") — aqui só a evidência de existência importa para a detecção de modo.
 */
export const PROTOTYPE_DIR = ".vetor/design/prototype";
export const DESIGN_SYSTEM_DIR = ".vetor/design/system";
export const DESIGN_DIRECTION_DIR = ".vetor/design/direction";

// Candidatos fixos e rasos (raiz + primeiro nível comum) — nunca uma varredura recursiva. Uma busca
// recursiva por "*.css"/"components/" combinaria em qualquer projeto web e alcançaria
// node_modules/dist/build, que module-test-map.md já lista como exclusão obrigatória.
const TAILWIND_CONFIGS = [
  "tailwind.config.js",
  "tailwind.config.ts",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
];
const TOKEN_FILES = ["tokens.json", "tokens.js", "tokens.ts", "tokens.css", "design-tokens.json"];
const COMPONENT_DIRS = ["components", "src/components", "ui", "src/ui"];
const STORYBOOK_DIRS = [".storybook"];
const PACKAGE_DESIGN_DEPS = [
  "tailwindcss",
  "styled-components",
  "@emotion/styled",
  "@mui/material",
  "@chakra-ui/react",
  "@storybook/react",
];

function isDirectory(path: string): boolean {
  try {
    return Deno.statSync(path).isDirectory;
  } catch {
    return false;
  }
}

function stripVersionPrefix(v: string): string {
  return v.replace(/^[\^~>=<\s]+/, "").trim();
}

function detectPackageDesignDeps(dir: string): DesignSystemEvidence[] {
  const path = `${dir}/package.json`;
  if (!exists(path)) return [];
  try {
    const parsed = readJson(path) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const merged = { ...parsed.dependencies, ...parsed.devDependencies };
    const out: DesignSystemEvidence[] = [];
    for (const dep of PACKAGE_DESIGN_DEPS) {
      const version = merged[dep];
      if (!version) continue;
      out.push({
        relPath: "package.json",
        kind: "package-dep",
        detail: `${dep}@${stripVersionPrefix(version)}`,
        packageName: dep,
      });
    }
    return out;
  } catch {
    // package.json ilegível: nenhuma evidência a relatar.
    return [];
  }
}

/**
 * Varre evidências de um Design System já existente no projeto: tokens.* configs/arquivos,
 * components/ui dirs, .storybook e dependências de design de package.json. Fato ausente é
 * omitido — nunca substituído por um default plausível.
 */
export function detectDesignSystemEvidence(dir: string): DesignSystemEvidence[] {
  const out: DesignSystemEvidence[] = [];

  for (const relPath of TAILWIND_CONFIGS) {
    if (exists(`${dir}/${relPath}`)) out.push({ relPath, kind: "tokens-config" });
  }
  for (const relPath of TOKEN_FILES) {
    if (exists(`${dir}/${relPath}`)) out.push({ relPath, kind: "tokens-file" });
  }
  for (const relPath of COMPONENT_DIRS) {
    if (isDirectory(`${dir}/${relPath}`)) out.push({ relPath, kind: "components-dir" });
  }
  for (const relPath of STORYBOOK_DIRS) {
    if (isDirectory(`${dir}/${relPath}`)) out.push({ relPath, kind: "storybook" });
  }
  out.push(...detectPackageDesignDeps(dir));

  return out;
}

export function hasPrototype(dir: string): boolean {
  return isDirectory(`${dir}/${PROTOTYPE_DIR}`);
}

/**
 * Detecta o modo de operação (#213 "Modos de operação"): Prototype-first > System-first >
 * Vetor-first, nesta ordem de prioridade — um protótipo registrado implica handoff a partir dele
 * mesmo quando um Design System também está presente.
 */
export function detectOperationMode(dir: string): OperationModeResult {
  const proto = hasPrototype(dir);
  const evidence = detectDesignSystemEvidence(dir);
  const mode: OperationMode = proto
    ? "prototype-first"
    : evidence.length > 0
    ? "system-first"
    : "vetor-first";
  return { mode, hasPrototype: proto, evidence };
}

// A versão só é atribuída à fonte a que ela realmente pertence: tailwindcss é a lib de tokens,
// nunca a versão de um diretório de componentes que não tem versão própria (e vice-versa).
const TOKEN_VERSION_DEPS = new Set(["tailwindcss"]);
const COMPONENT_VERSION_DEPS = new Set([
  "styled-components",
  "@emotion/styled",
  "@mui/material",
  "@chakra-ui/react",
  "@storybook/react",
]);

function versionFromEvidence(evidence: DesignSystemEvidence[], allowedDeps: Set<string>): string {
  const pkg = evidence.find((e) =>
    e.kind === "package-dep" && e.detail && e.packageName && allowedDeps.has(e.packageName)
  );
  return pkg?.detail?.split("@").pop() ?? "unknown";
}

function frontmatter(sources: string[], version: string): string {
  const source = sources.length === 0 ? "unknown" : sources.join(", ");
  return `---\nsource: ${source}\nversion: ${version}\nauthority: project\n---\n`;
}

function renderTokensMd(evidence: DesignSystemEvidence[]): DesignFile {
  const tokenEvidence = evidence.filter((e) =>
    e.kind === "tokens-config" || e.kind === "tokens-file"
  );
  const sources = tokenEvidence.map((e) => e.relPath);
  const version = versionFromEvidence(evidence, TOKEN_VERSION_DEPS);
  const body = sources.length > 0
    ? `Este projeto já possui tokens definidos externamente. O Vetor referencia a fonte abaixo em\nvez de duplicar os valores — esta representação é documentação/handoff, nunca uma segunda fonte\nconcorrente de tokens.\n\n${
      sources.map((s) => `- \`${s}\``).join("\n")
    }\n\nConsulte o arquivo original para os valores atuais de cor, tipografia, espaçamento, radius,\nelevation e motion.`
    : `Nenhuma configuração de tokens (\`tailwind.config.*\`, \`tokens.*\`) foi encontrada na varredura.\nVer \`evidence.md\` para o que foi verificado.`;

  return {
    path: `${DESIGN_SYSTEM_DIR}/tokens.md`,
    content: `${frontmatter(sources, version)}\n# Design System — Tokens (referência)\n\n${body}\n`,
  };
}

function renderComponentsMd(evidence: DesignSystemEvidence[]): DesignFile {
  const componentEvidence = evidence.filter((e) => e.kind === "components-dir");
  const sources = componentEvidence.map((e) => e.relPath);
  const version = versionFromEvidence(evidence, COMPONENT_VERSION_DEPS);
  const body = sources.length > 0
    ? `Componentes reutilizáveis já existem no projeto. O Vetor referencia o(s) diretório(s) abaixo\nem vez de listar/duplicar os componentes aqui.\n\n${
      sources.map((s) => `- \`${s}/\``).join("\n")
    }`
    : `Nenhum diretório de componentes (\`components/\`, \`ui/\`) foi encontrado na varredura. Ver\n\`evidence.md\` para o que foi verificado.`;

  return {
    path: `${DESIGN_SYSTEM_DIR}/components.md`,
    content: `${
      frontmatter(sources, version)
    }\n# Design System — Componentes (referência)\n\n${body}\n`,
  };
}

function renderPatternsMd(): DesignFile {
  // Padrões de interação (ex.: confirmação para ações destrutivas) não são deriváveis de uma
  // varredura de arquivos — ver project.ts: "fato não encontrado é omitido, nunca substituído
  // por um default plausível". Registrado como OPEN_QUESTION (evidence-state.md).
  const content =
    `# Design System — Padrões de interação\n\nOPEN_QUESTION\nPadrões de interação não são deriváveis de uma varredura de arquivos — dependem de observação\ndo código/Storybook existente ou de decisão humana explícita.\n\nImpact:\nSem essa informação, a Design Direction e o Design Contract não podem assumir um padrão de\ninteração consistente com o resto do produto.\n`;
  return { path: `${DESIGN_SYSTEM_DIR}/patterns.md`, content };
}

function renderEvidenceMd(evidence: DesignSystemEvidence[]): DesignFile {
  const lines = evidence.length > 0
    ? evidence.map((e) => `- \`${e.relPath}\` (${e.kind}${e.detail ? `, ${e.detail}` : ""})`).join(
      "\n",
    )
    : "Nenhuma evidência de Design System encontrada nesta varredura.";
  const content =
    `# Design System — Evidence\n\nSinais encontrados na varredura do projeto (\`detectDesignSystemEvidence\`):\n\n${lines}\n`;
  return { path: `${DESIGN_SYSTEM_DIR}/evidence.md`, content };
}

/** Monta os 4 arquivos de `.vetor/design/system/` a partir da evidência já detectada. */
export function renderDesignSystemFiles(evidence: DesignSystemEvidence[]): DesignFile[] {
  return [
    renderTokensMd(evidence),
    renderComponentsMd(evidence),
    renderPatternsMd(),
    renderEvidenceMd(evidence),
  ];
}

const DESIGN_DIRECTION_TEMPLATE = `# Design Direction

> Regra geral: **DEFAULT ≠ FORBIDDEN** — um padrão comum continua permitido quando há
> justificativa funcional ou estética derivada do produto, conteúdo ou interação. Esta seção nunca
> deve virar uma lista de proibições universais (ver \`design-vocabulary.md\` §2).

## Product

## Audience

## Primary job

## Visual personality

## Density

## Typography

## Palette

## Layout

## Design Signature

## Motion

## Avoid
`;

/** Esqueleto de `.vetor/design/direction/product.md` — ver #213 "Design Direction". */
export function renderDesignDirectionFile(): DesignFile {
  return { path: `${DESIGN_DIRECTION_DIR}/product.md`, content: DESIGN_DIRECTION_TEMPLATE };
}

/**
 * Grava os arquivos em `dir`, nunca sobrescrevendo um já existente — mesmo contrato de
 * `detect-project.ts`/`stack-practices`: a representação do Vetor é criada uma vez e depois
 * "criada/atualizável" manualmente, sem que uma nova varredura apague uma edição humana.
 */
export function writeDesignFiles(
  dir: string,
  files: DesignFile[],
): { written: string[]; skipped: string[] } {
  const written: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const fullPath = `${dir}/${file.path}`;
    if (exists(fullPath)) {
      skipped.push(file.path);
      continue;
    }
    const parentDir = fullPath.slice(0, fullPath.lastIndexOf("/"));
    Deno.mkdirSync(parentDir, { recursive: true });
    Deno.writeTextFileSync(fullPath, file.content);
    written.push(file.path);
  }

  return { written, skipped };
}
