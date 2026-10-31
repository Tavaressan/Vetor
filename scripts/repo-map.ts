// Repo Map sintático compacto (issue #506, Spec docs/specs/repo-map-ast-context-packet.md).
//
// Cataloga os símbolos públicos (interfaces, types, classes, funções e constantes exportadas) de
// TypeScript/JavaScript via AST do compilador TypeScript, omite os corpos (`{ ... }`) e comprime o
// resultado num esqueleto Markdown dentro de um orçamento de tokens (padrão: 1.500).
//
// Decisões de projeto:
// - Módulos: ESM (`export ...`) e CommonJS (`module.exports = { a, b: fn }`, `module.exports.x =`,
//   `exports.x =` e `module.exports = x`, com `require("./x")` relativos no grafo de imports; o
//   módulo cli/ do Vetor é CommonJS). Cada nome é resolvido até a declaração local, para trazer a
//   assinatura. Métodos e spread dentro do literal de `module.exports` não são catalogados.
// - Parser: `npm:typescript` fixado em 6.0.3 (JS puro; a linha 7.x é nativa e não serve). Carregado
//   por import dinâmico só quando algum arquivo precisa ser parseado, então o caminho de cache
//   morno não paga o custo de carga do compilador.
// - Tokens: estimativa de 4 caracteres por token (`Math.ceil(chars / 4)`), medida sobre o texto
//   final inteiro (blocos, cercas de código e rodapé), nunca sobre partes.
// - Ranking: um símbolo vale `peso do tipo + 4 * arquivos que o importam pelo nome + importadores
//   do arquivo`; um arquivo vale `4 * importadores distintos + contratos tipados exportados`.
//   Desempates sempre por comparação de código (nunca `localeCompare`) para ser determinístico.
// - Orçamento: (1) tudo detalhado se couber; senão (2) até 60% do orçamento vão para assinaturas
//   completas dos símbolos mais bem ranqueados, (3) os demais arquivos entram condensados (só
//   nomes) enquanto couberem, (4) a sobra volta a detalhar símbolos e (5) o que não coube vira o
//   rodapé "arquivos omitidos".
// - Cache: `.claude/vetor/cache/repo-map.json`, indexado pelo SHA-1 de blob do git de cada arquivo
//   (o mesmo de `git hash-object`), com gravação atômica (arquivo temporário + rename).
// - Escopo (issue #507, RF-03): `module`/`files` definem um foco. Os arquivos do foco são tier 1, os
//   vizinhos imediatos (quem eles importam e quem os importa) são tier 2 e o resto é tier 3. O tier
//   vem antes do score em toda ordenação, então o foco é detalhado primeiro e é o último a ser
//   omitido. Sem foco, todo arquivo é tier 3 e a ordem continua só por centralidade.
// O specifier fica inline (e não no import map do deno.json) porque scripts do Vetor podem rodar a
// partir de cópias sem o deno.json da raiz, como as que o instalador do OpenCode gera no projeto.
// deno-lint-ignore no-import-prefix
import type * as TS from "npm:typescript@6.0.3";
import {
  catchAllModule,
  parseModuleTestMap,
  resolveModule,
} from "./lib/orchestrator/context-packet.ts";

export const DEFAULT_MAX_TOKENS = 1500;
/** Versão do formato/extração do cache; incremente quando a extração mudar. */
export const CACHE_VERSION = "1.1.0";
const DEFAULT_CACHE_PATH = ".claude/vetor/cache/repo-map.json";
const MAX_FILE_BYTES = 500 * 1024;
const DETAIL_SHARE = 0.6;
const MAX_LISTED_NAMES = 8;
const READ_CHUNK = 64;

const EXCLUDED_DIRS = new Set(["node_modules", "target", "build", "dist", ".venv", ".git"]);
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const KIND_WEIGHT: Record<SymbolKind, number> = {
  interface: 3,
  type: 3,
  class: 2,
  function: 1,
  const: 0.5,
};
const REF_WEIGHT = 4;
const IMPORTER_WEIGHT = 4;

export type SymbolKind = "interface" | "type" | "class" | "function" | "const";

export interface RepoSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
  /** Assinatura sem corpo, possivelmente em várias linhas (classes e interfaces). */
  signature: string;
  exported: boolean;
}

export interface ImportRef {
  /** Especificador relativo, como escrito no código. */
  source: string;
  importedSymbols: string[];
}

export interface FileSymbolSummary {
  fileHash: string;
  mtime: number;
  /** Tokens estimados de todas as assinaturas do arquivo. */
  tokens: number;
  symbols: RepoSymbol[];
  imports: ImportRef[];
}

export interface RepoMapCache {
  version: typeof CACHE_VERSION;
  lastUpdated: string;
  files: Record<string, FileSymbolSummary>;
}

export interface ExtractedFile {
  symbols: RepoSymbol[];
  imports: ImportRef[];
  /** Presente quando a extração caiu no fallback léxico. */
  warning?: string;
}

export interface RepoMapOptions {
  /** Raiz do repositório (padrão: cwd). */
  root?: string;
  /** Teto de tokens do Markdown gerado (padrão: 1500). */
  maxTokens?: number;
  /** Caminho do cache; `null` desativa o cache (padrão: `<root>/.claude/vetor/cache/repo-map.json`). */
  cachePath?: string | null;
  /** Módulo do `module-test-map` cujos arquivos formam o foco (exige `moduleTestMap`). */
  module?: string;
  /** Conteúdo do `module-test-map.md`, de onde saem os prefixos de `module`. */
  moduleTestMap?: string;
  /**
   * Arquivos-alvo, relativos ao root. Só os que são fontes mapeados entram no foco. O módulo
   * catch-all (`./`) só entra no foco quando nenhum arquivo resolve: ele cobre quase o repositório
   * inteiro e tornaria o escopo inócuo.
   */
  files?: string[];
}

export interface RepoMapFile {
  path: string;
  /** 1 = foco, 2 = vizinho imediato do foco, 3 = demais (todos, quando não há foco). */
  tier: 1 | 2 | 3;
  score: number;
  /** Símbolos exibidos com assinatura completa, na ordem de renderização. */
  symbols: RepoSymbol[];
  /** Nomes exibidos apenas na linha condensada do arquivo. */
  listed: string[];
}

export interface RepoMapResult {
  status: "ok" | "empty";
  maxTokens: number;
  estimatedTokens: number;
  markdown: string;
  /** Arquivos presentes no Markdown, na ordem de renderização. */
  files: RepoMapFile[];
  /** Arquivos com símbolos públicos que não couberam no orçamento. */
  omitted: string[];
  /** Arquivos pulados antes do parsing, com o motivo. */
  skipped: Array<{ path: string; reason: string }>;
  warnings: string[];
  stats: { parsed: number; cached: number; cacheWritten: boolean };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// Descoberta de arquivos
// ---------------------------------------------------------------------------------------------

/** Se o caminho é código que o Repo Map sabe mapear (extensão de fonte e não excluído). */
export function isMappedSourcePath(path: string): boolean {
  return SOURCE_EXTENSIONS.includes(extensionOf(path)) && !isExcludedPath(path);
}

/** Diretórios vendorizados/gerados e arquivos de segredo ficam fora do mapa. */
export function isExcludedPath(path: string): boolean {
  const parts = path.split("/");
  const file = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);
  if (dirs.some((dir) => EXCLUDED_DIRS.has(dir))) return true;
  if (`/${dirs.join("/")}/`.includes("/.claude/worktrees/")) return true;
  return file.startsWith(".env") || file.endsWith(".pem") || file.endsWith(".key");
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") ? path.slice(dot) : "";
}

async function gitFiles(root: string): Promise<string[] | null> {
  try {
    const output = await new Deno.Command("git", {
      args: ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      cwd: root,
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!output.success) return null;
    return new TextDecoder().decode(output.stdout).split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

async function walkFiles(root: string, dir = ""): Promise<string[]> {
  const found: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir ? `${root}/${dir}` : root)) {
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (EXCLUDED_DIRS.has(entry.name) || relative === ".claude/worktrees") continue;
        found.push(...await walkFiles(root, relative));
      } else if (entry.isFile) {
        found.push(relative);
      }
    }
  } catch (error) {
    // Subdiretório ilegível (permissão, corrida com remoção): segue com o que já foi listado.
    if (!dir) throw error;
  }
  return found;
}

async function listSourceFiles(root: string): Promise<string[]> {
  const raw = (await gitFiles(root)) ?? (await walkFiles(root));
  return raw
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => SOURCE_EXTENSIONS.includes(extensionOf(path)) && !isExcludedPath(path))
    .sort(compare);
}

// ---------------------------------------------------------------------------------------------
// Extração de símbolos
// ---------------------------------------------------------------------------------------------

type TypeScript = typeof TS;
type Loaded = { ts: TypeScript | null; error?: string };
let typeScriptLoad: Promise<Loaded> | undefined;

function loadTypeScript(): Promise<Loaded> {
  // deno-lint-ignore no-import-prefix
  typeScriptLoad ??= import("npm:typescript@6.0.3")
    .then((ts): Loaded => ({ ts: ts as TypeScript }))
    .catch((error): Loaded => ({
      ts: null,
      error: error instanceof Error ? error.message.split("\n")[0] : String(error),
    }));
  return typeScriptLoad;
}

/** Junta tokens numa linha só, descartando comentários e quebras de linha. */
function collapse(ts: TypeScript, text: string): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  const trivia = new Set<TS.SyntaxKind>([
    ts.SyntaxKind.WhitespaceTrivia,
    ts.SyntaxKind.NewLineTrivia,
    ts.SyntaxKind.SingleLineCommentTrivia,
    ts.SyntaxKind.MultiLineCommentTrivia,
  ]);
  let out = "";
  let previous = "";
  let gap = false;
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (trivia.has(kind)) {
      gap = true;
      continue;
    }
    const token = scanner.getTokenText();
    const closing = token === ")" || token === "]";
    if (gap && closing && out.endsWith(",")) out = out.slice(0, -1); // vírgula final
    else if (gap && out && previous !== "(" && previous !== "[" && !closing) out += " ";
    gap = false;
    out += token;
    previous = token;
  }
  return out;
}

function withSemicolon(text: string): string {
  return text.endsWith(";") ? text : `${text};`;
}

function scriptKindFor(ts: TypeScript, path: string): TS.ScriptKind {
  switch (extensionOf(path)) {
    case ".ts":
      return ts.ScriptKind.TS;
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    default:
      return ts.ScriptKind.JS;
  }
}

function extractWithTypeScript(ts: TypeScript, path: string, source: string): ExtractedFile {
  const sf = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    false,
    scriptKindFor(ts, path),
  );
  const text = sf.text;
  const symbols: RepoSymbol[] = [];
  const imports: ImportRef[] = [];

  const slice = (from: number, to: number) => collapse(ts, text.slice(from, to));
  const startOf = (node: TS.Node) => node.getStart(sf);
  const lineOf = (node: TS.Node) => sf.getLineAndCharacterOfPosition(startOf(node)).line + 1;
  const hasModifier = (node: TS.Node, kind: TS.SyntaxKind) =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);
  const push = (name: string, kind: SymbolKind, node: TS.Node, signature: string) => {
    symbols.push({ name, kind, line: lineOf(node), signature, exported: true });
  };
  /** Cabeçalho de classe/interface: da declaração até o `{` do corpo (exclusive). */
  const header = (node: TS.ClassDeclaration | TS.InterfaceDeclaration) =>
    slice(startOf(node), node.members.pos).replace(/\s*\{$/, "");
  /** Assinatura de função/método: até o início do corpo, que vira `{ ... }`. */
  const callable = (node: TS.SignatureDeclaration & { body?: TS.Node }) =>
    node.body
      ? `${slice(startOf(node), startOf(node.body))} { ... }`
      : withSemicolon(slice(startOf(node), node.end));

  const classMembers = (node: TS.ClassDeclaration): string[] => {
    const memberName = (m: TS.ClassElement) =>
      ts.isConstructorDeclaration(m) ? "constructor" : m.name ? m.name.getText(sf) : "";
    const overloaded = new Set<string>();
    for (const m of node.members) {
      if ((ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m)) && !m.body) {
        overloaded.add(memberName(m));
      }
    }
    const lines: string[] = [];
    for (const m of node.members) {
      if (ts.isSemicolonClassElement(m) || ts.isClassStaticBlockDeclaration(m)) continue;
      if (hasModifier(m, ts.SyntaxKind.PrivateKeyword)) continue;
      if (m.name && ts.isPrivateIdentifier(m.name)) continue;
      if (
        ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m) ||
        ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)
      ) {
        // A implementação de um método sobrecarregado não faz parte do contrato público.
        if (m.body && overloaded.has(memberName(m))) continue;
        lines.push(callable(m));
      } else if (ts.isPropertyDeclaration(m)) {
        const end = (m.type ?? m.questionToken ?? m.exclamationToken ?? m.name).end;
        lines.push(withSemicolon(slice(startOf(m), end)));
      } else if (ts.isIndexSignatureDeclaration(m)) {
        lines.push(withSemicolon(slice(startOf(m), m.end)));
      }
    }
    return lines;
  };

  /** Classe com cabeçalho e membros públicos, sem corpos. */
  const classSignature = (node: TS.ClassDeclaration) => {
    const members = classMembers(node);
    const body = members.length
      ? `{\n${members.map((line) => `  ${line}`).join("\n")}\n}`
      : "{ ... }";
    return `${header(node)} ${body}`;
  };

  const isLiteral = (node: TS.Expression) =>
    ts.isStringLiteral(node) || ts.isNumericLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand));

  /** Valor de um inicializador: função sem corpo, literal curto ou `...`. */
  const valueText = (init: TS.Expression) => {
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      return `${slice(startOf(init), startOf(init.body))} { ... }`;
    }
    return isLiteral(init) && init.end - startOf(init) <= 80
      ? slice(startOf(init), init.end)
      : "...";
  };

  // --- CommonJS (issue #507) ---
  // Declarações locais de primeiro nível, para resolver `module.exports = { a }` até a assinatura.
  const locals = new Map<string, TS.Node>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && st.body) {
      if (!locals.has(st.name.text)) locals.set(st.name.text, st);
    } else if (ts.isClassDeclaration(st) && st.name) {
      locals.set(st.name.text, st);
    } else if (ts.isVariableStatement(st)) {
      for (const decl of st.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) locals.set(decl.name.text, decl);
      }
    }
  }

  const isModuleExports = (node: TS.Node) =>
    ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) &&
    node.expression.text === "module" && node.name.text === "exports";

  /** `require("./x")`, com ou sem acesso a propriedade (`require("./x").nome`); só relativos. */
  const relativeRequire = (node: TS.Node): { source: string; property?: string } | null => {
    let property: string | undefined;
    let call = node;
    if (ts.isPropertyAccessExpression(call)) {
      property = call.name.text;
      call = call.expression;
    }
    if (
      !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) ||
      call.expression.text !== "require" || call.arguments.length !== 1
    ) return null;
    const arg = call.arguments[0];
    const isString = ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg);
    return isString && arg.text.startsWith(".") ? { source: arg.text, property } : null;
  };

  const cjsNames = new Set<string>();
  /**
   * Registra um export CommonJS. `value` é a expressão exportada; um identificador é resolvido para
   * a declaração local (função, classe ou constante), como no caminho ESM. Nome repetido vale só
   * na primeira ocorrência.
   */
  const commonJsExport = (name: string, target: string, value: TS.Node, at: TS.Node) => {
    if (cjsNames.has(name)) return;
    cjsNames.add(name);
    const local = ts.isIdentifier(value) ? locals.get(value.text) : undefined;
    const node = local ?? value;
    if (ts.isFunctionDeclaration(node)) {
      push(name, "function", at, `${target} = ${callable(node)};`);
    } else if (ts.isClassDeclaration(node)) {
      push(name, "class", at, `${target} = ${classSignature(node)};`);
    } else {
      const init = ts.isVariableDeclaration(node) ? node.initializer : node as TS.Expression;
      const inlineFunction = !local && init !== undefined &&
        (ts.isArrowFunction(init) || ts.isFunctionExpression(init));
      push(
        name,
        inlineFunction ? "function" : "const",
        at,
        init ? `${target} = ${valueText(init)};` : `${target};`,
      );
    }
  };

  const collectRequire = (names: string[], source: string) => {
    imports.push({ source, importedSymbols: names });
  };

  const collectCommonJs = (st: TS.ExpressionStatement) => {
    const expr = st.expression;
    const bare = relativeRequire(expr);
    if (bare) return collectRequire([], bare.source);
    if (!ts.isBinaryExpression(expr) || expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
      return;
    }
    const left = expr.left;
    if (isModuleExports(left)) {
      const right = expr.right;
      if (!ts.isObjectLiteralExpression(right)) {
        const name = ts.isIdentifier(right) ? right.text : "default";
        return commonJsExport(name, "module.exports", right, st);
      }
      for (const prop of right.properties) {
        if (ts.isShorthandPropertyAssignment(prop)) {
          commonJsExport(prop.name.text, `exports.${prop.name.text}`, prop.name, prop);
        } else if (
          ts.isPropertyAssignment(prop) &&
          (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
        ) {
          commonJsExport(prop.name.text, `exports.${prop.name.text}`, prop.initializer, prop);
        }
      }
    } else if (
      ts.isPropertyAccessExpression(left) &&
      (isModuleExports(left.expression) ||
        (ts.isIdentifier(left.expression) && left.expression.text === "exports"))
    ) {
      commonJsExport(left.name.text, `exports.${left.name.text}`, expr.right, st);
    }
  };

  /** `const { a, b: c } = require("./x")`, `const x = require("./x")` e `...require("./x").a`. */
  const collectRequireDeclarations = (st: TS.VariableStatement) => {
    for (const decl of st.declarationList.declarations) {
      const required = decl.initializer && relativeRequire(decl.initializer);
      if (!required) continue;
      const names: string[] = [];
      if (ts.isObjectBindingPattern(decl.name)) {
        for (const el of decl.name.elements) {
          const imported = el.propertyName ?? el.name;
          if (!el.dotDotDotToken && ts.isIdentifier(imported)) names.push(imported.text);
        }
      } else {
        names.push(required.property ?? "*");
      }
      collectRequire(names, required.source);
    }
  };

  const functions = new Map<string, { symbol: RepoSymbol; overloaded: boolean }>();

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) {
      const spec = st.moduleSpecifier;
      if (!spec || !ts.isStringLiteral(spec) || !spec.text.startsWith(".")) continue;
      const names: string[] = [];
      if (ts.isImportDeclaration(st)) {
        const clause = st.importClause;
        if (clause?.name) names.push("default");
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) names.push("*");
        else if (bindings) {
          for (const el of bindings.elements) names.push((el.propertyName ?? el.name).text);
        }
      } else {
        const clause = st.exportClause;
        if (!clause || ts.isNamespaceExport(clause)) names.push("*");
        else for (const el of clause.elements) names.push((el.propertyName ?? el.name).text);
      }
      imports.push({ source: spec.text, importedSymbols: names });
      continue;
    }

    if (ts.isExportAssignment(st)) {
      if (st.isExportEquals) continue;
      const value = ts.isIdentifier(st.expression) ? st.expression.text : "...";
      push("default", "const", st, `export default ${value};`);
      continue;
    }

    if (ts.isExpressionStatement(st)) {
      collectCommonJs(st);
      continue;
    }
    if (!hasModifier(st, ts.SyntaxKind.ExportKeyword)) {
      if (ts.isVariableStatement(st)) collectRequireDeclarations(st);
      continue;
    }
    const isDefault = hasModifier(st, ts.SyntaxKind.DefaultKeyword);

    if (ts.isFunctionDeclaration(st)) {
      const name = isDefault ? "default" : st.name?.text;
      if (!name) continue;
      const known = functions.get(name);
      if (!st.body) {
        const line = withSemicolon(slice(startOf(st), st.end));
        if (known) {
          known.symbol.signature += `\n${line}`;
          known.overloaded = true;
        } else {
          const before = symbols.length;
          push(name, "function", st, line);
          functions.set(name, { symbol: symbols[before], overloaded: true });
        }
      } else if (!known?.overloaded) {
        const before = symbols.length;
        push(name, "function", st, callable(st));
        functions.set(name, { symbol: symbols[before], overloaded: false });
      }
    } else if (ts.isClassDeclaration(st)) {
      const name = isDefault ? "default" : st.name?.text;
      if (!name) continue;
      push(name, "class", st, classSignature(st));
    } else if (ts.isInterfaceDeclaration(st)) {
      const members = st.members.map((m) => `  ${slice(startOf(m), m.end).replace(/[;,]$/, "")};`);
      const body = members.length ? `{\n${members.join("\n")}\n}` : "{}";
      push(st.name.text, "interface", st, `${header(st)} ${body}`);
    } else if (ts.isTypeAliasDeclaration(st)) {
      push(st.name.text, "type", st, withSemicolon(slice(startOf(st), st.end)));
    } else if (ts.isEnumDeclaration(st)) {
      push(st.name.text, "type", st, slice(startOf(st), st.end));
    } else if (ts.isVariableStatement(st)) {
      const list = st.declarationList;
      const prefix = slice(startOf(st), startOf(list));
      const keyword = list.flags & ts.NodeFlags.Const
        ? "const"
        : list.flags & ts.NodeFlags.Let
        ? "let"
        : "var";
      for (const decl of list.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const type = decl.type ? `: ${slice(startOf(decl.type), decl.type.end)}` : "";
        const value = decl.initializer ? ` = ${valueText(decl.initializer)}` : "";
        const signature = `${prefix} ${keyword} ${decl.name.text}${type}${value};`;
        symbols.push({
          name: decl.name.text,
          kind: "const",
          line: lineOf(decl),
          signature,
          exported: true,
        });
      }
    }
  }
  return { symbols, imports };
}

const LEXICAL_EXPORT =
  /^export\s+(default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)?/;
const LEXICAL_KINDS: Record<string, SymbolKind> = {
  "function": "function",
  "function*": "function",
  class: "class",
  interface: "interface",
  type: "type",
  enum: "type",
  const: "const",
  let: "const",
  var: "const",
};

const LEXICAL_COMMONJS_PROPERTY = /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/;
const LEXICAL_COMMONJS_OBJECT = /^module\.exports\s*=\s*\{/gm;

/** Chaves de primeiro nível de um literal de objeto, dado o texto logo após a chave de abertura. */
function lexicalObjectKeys(afterBrace: string): string[] {
  const text = afterBrace.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "{" || char === "[" || char === "(") depth++;
    else if (char === "}" || char === "]" || char === ")") {
      if (depth === 0) break;
      depth--;
    }
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts
    .map((part) => /^\s*([A-Za-z_$][\w$]*)\s*(?::|\(|$)/.exec(part)?.[1])
    .filter((name): name is string => name !== undefined);
}

/**
 * Fallback sem AST: captura as linhas que começam com `export` e os exports CommonJS de primeiro
 * nível (`module.exports = { ... }`, `module.exports.x =` e `exports.x =`), sem assinatura.
 */
export function extractSymbolsLexical(source: string): RepoSymbol[] {
  const symbols: RepoSymbol[] = [];
  const commonJsNames = new Set<string>();
  const pushCommonJs = (name: string, line: number) => {
    if (commonJsNames.has(name)) return;
    commonJsNames.add(name);
    symbols.push({
      name,
      kind: "const",
      line,
      signature: `exports.${name} = ...;`,
      exported: true,
    });
  };
  source.split(/\r?\n/).forEach((raw, index) => {
    const match = LEXICAL_EXPORT.exec(raw);
    if (!match) {
      const property = LEXICAL_COMMONJS_PROPERTY.exec(raw);
      if (property) pushCommonJs(property[1], index + 1);
      return;
    }
    const name = match[1] ? "default" : match[3];
    if (!name) return;
    symbols.push({
      name,
      kind: LEXICAL_KINDS[match[2]],
      line: index + 1,
      signature: raw.trim().replace(/\s*\{\s*\}?\s*$/, " { ... }"),
      exported: true,
    });
  });
  for (const object of source.matchAll(LEXICAL_COMMONJS_OBJECT)) {
    const line = source.slice(0, object.index).split("\n").length;
    const afterBrace = source.slice(object.index + object[0].length);
    for (const name of lexicalObjectKeys(afterBrace)) pushCommonJs(name, line);
  }
  return symbols;
}

/**
 * Extrai símbolos públicos e imports relativos de um arquivo. Sem o compilador TypeScript
 * disponível, ou se a extração falhar, cai no fallback léxico (sem imports) e avisa em `warning`.
 */
export async function extractSymbols(path: string, source: string): Promise<ExtractedFile> {
  const { ts, error } = await loadTypeScript();
  if (!ts) {
    return {
      symbols: extractSymbolsLexical(source),
      imports: [],
      warning: `compilador TypeScript indisponível (${error}); usando extração léxica`,
    };
  }
  try {
    return extractWithTypeScript(ts, path, source);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      symbols: extractSymbolsLexical(source),
      imports: [],
      warning: `${path}: falha na extração por AST (${message}); usando extração léxica`,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Cache incremental
// ---------------------------------------------------------------------------------------------

/** SHA-1 de blob do git (equivalente a `git hash-object`). */
async function gitBlobSha1(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const data = new Uint8Array(header.length + bytes.length);
  data.set(header);
  data.set(bytes, header.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", data));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadCache(cachePath: string, warnings: string[]): Promise<RepoMapCache | null> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(cachePath);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      warnings.push(`cache ilegível em ${cachePath}; reconstruindo (${(error as Error).message})`);
    }
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === CACHE_VERSION && parsed.files && typeof parsed.files === "object") {
      return parsed as RepoMapCache;
    }
  } catch {
    warnings.push(`cache corrompido em ${cachePath}; reconstruindo`);
  }
  return null;
}

async function saveCache(cachePath: string, cache: RepoMapCache): Promise<void> {
  const slash = Math.max(cachePath.lastIndexOf("/"), cachePath.lastIndexOf("\\"));
  if (slash > 0) {
    const dir = cachePath.slice(0, slash);
    await Deno.mkdir(dir, { recursive: true });
    // O cache do Vetor se auto-ignora, como em check-edit.ts e vetor-status.sh: o .gitignore do
    // projeto-alvo pode não cobrir .claude/vetor/cache/. Um cachePath customizado não é tocado.
    if (dir.replaceAll("\\", "/").endsWith(".claude/vetor/cache")) {
      await Deno.writeTextFile(`${dir}/.gitignore`, "*\n", { createNew: true }).catch(() => {});
    }
  }
  const temp = `${cachePath}.${crypto.randomUUID()}.tmp`;
  try {
    await Deno.writeTextFile(temp, JSON.stringify(cache));
    await Deno.rename(temp, cachePath);
  } catch (error) {
    await Deno.remove(temp).catch(() => {});
    throw error;
  }
}

type LoadedFile =
  | { path: string; summary: FileSymbolSummary; reused: boolean; fallback: boolean }
  | { path: string; skip: string }
  | null;

async function loadFile(
  root: string,
  path: string,
  previous: FileSymbolSummary | undefined,
  warnings: string[],
): Promise<LoadedFile> {
  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(`${root}/${path}`);
  } catch {
    return null; // removido ou não é arquivo regular (ex.: submódulo)
  }
  if (bytes.length > MAX_FILE_BYTES) {
    return { path, skip: `arquivo acima de 500KB (${Math.round(bytes.length / 1024)}KB)` };
  }
  const fileHash = await gitBlobSha1(bytes);
  if (
    previous && previous.fileHash === fileHash && Array.isArray(previous.symbols) &&
    Array.isArray(previous.imports)
  ) {
    return { path, summary: previous, reused: true, fallback: false };
  }
  const extracted = await extractSymbols(path, new TextDecoder().decode(bytes));
  if (extracted.warning && !warnings.includes(extracted.warning)) warnings.push(extracted.warning);
  const stat = await Deno.stat(`${root}/${path}`).catch(() => null);
  return {
    path,
    reused: false,
    fallback: extracted.warning !== undefined,
    summary: {
      fileHash,
      mtime: stat?.mtime?.getTime() ?? 0,
      tokens: estimateTokens(extracted.symbols.map((s) => s.signature).join("\n")),
      symbols: extracted.symbols,
      imports: extracted.imports,
    },
  };
}

async function mapChunked<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  }
  return results;
}

// ---------------------------------------------------------------------------------------------
// Ranking e orçamento de tokens
// ---------------------------------------------------------------------------------------------

interface RankedSymbol {
  symbol: RepoSymbol;
  /** Pontuação própria do símbolo (tipo + referências por nome). */
  score: number;
}

interface FileEntry {
  path: string;
  lang: string;
  tier: 1 | 2 | 3;
  score: number;
  importers: number;
  ranked: RankedSymbol[];
}

function resolveImport(from: string, source: string, known: Set<string>): string | null {
  const parts = from.split("/").slice(0, -1);
  for (const segment of source.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  const base = parts.join("/");
  const stem = base.replace(/\.(?:[cm]?js|jsx)$/, "");
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => stem + ext),
    ...SOURCE_EXTENSIONS.map((ext) => base + ext),
    ...SOURCE_EXTENSIONS.map((ext) => `${base}/index${ext}`),
  ];
  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

const LANGUAGES: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".jsx": "jsx",
};

function rankFiles(
  summaries: Map<string, FileSymbolSummary>,
  focus: ReadonlySet<string>,
): FileEntry[] {
  const known = new Set(summaries.keys());
  const importers = new Map<string, Set<string>>();
  const dependencies = new Map<string, Set<string>>();
  const references = new Map<string, Map<string, Set<string>>>();
  for (const [from, summary] of summaries) {
    for (const ref of summary.imports) {
      const target = resolveImport(from, ref.source, known);
      if (!target || target === from) continue;
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target)!.add(from);
      if (!dependencies.has(from)) dependencies.set(from, new Set());
      dependencies.get(from)!.add(target);
      for (const name of ref.importedSymbols) {
        if (name === "*") continue;
        if (!references.has(target)) references.set(target, new Map());
        const byName = references.get(target)!;
        if (!byName.has(name)) byName.set(name, new Set());
        byName.get(name)!.add(from);
      }
    }
  }

  // Vizinhos imediatos do foco, nos dois sentidos: o que o foco importa e quem importa o foco.
  const neighbors = new Set<string>();
  for (const path of focus) {
    for (const other of importers.get(path) ?? []) neighbors.add(other);
    for (const other of dependencies.get(path) ?? []) neighbors.add(other);
  }

  const entries: FileEntry[] = [];
  for (const [path, summary] of summaries) {
    if (summary.symbols.length === 0) continue;
    const importerCount = importers.get(path)?.size ?? 0;
    const byName = references.get(path);
    const ranked = summary.symbols
      .map((symbol) => ({
        symbol,
        score: KIND_WEIGHT[symbol.kind] + REF_WEIGHT * (byName?.get(symbol.name)?.size ?? 0),
      }))
      .sort((a, b) =>
        b.score - a.score || compare(a.symbol.name, b.symbol.name) ||
        a.symbol.line - b.symbol.line
      );
    const typed = summary.symbols.filter((s) =>
      s.kind === "interface" || s.kind === "type" || s.kind === "class"
    ).length;
    entries.push({
      path,
      lang: LANGUAGES[extensionOf(path)] ?? "js",
      tier: focus.has(path) ? 1 : neighbors.has(path) ? 2 : 3,
      score: IMPORTER_WEIGHT * importerCount + typed,
      importers: importerCount,
      ranked,
    });
  }
  return entries.sort((a, b) => a.tier - b.tier || b.score - a.score || compare(a.path, b.path));
}

function partition(entry: FileEntry, detailed: ReadonlySet<number>) {
  const full: RepoSymbol[] = [];
  const rest: string[] = [];
  entry.ranked.forEach((item, index) => {
    if (detailed.has(index)) full.push(item.symbol);
    else rest.push(item.symbol.name);
  });
  const listed = rest.slice(0, MAX_LISTED_NAMES);
  return { full, listed, hidden: rest.length - listed.length };
}

function renderBlock(entry: FileEntry, detailed: ReadonlySet<number>): string {
  const { full, listed, hidden } = partition(entry, detailed);
  const lines = full.map((symbol) => symbol.signature);
  if (listed.length > 0) {
    const label = full.length > 0 ? "também" : "exports";
    lines.push(`// ${label}: ${listed.join(", ")}${hidden > 0 ? ` (+${hidden})` : ""}`);
  }
  return `### ${entry.path}\n\`\`\`${entry.lang}\n${lines.join("\n")}\n\`\`\`\n`;
}

function renderFooter(omitted: number): string {
  return `… +${omitted} arquivos omitidos pelo orçamento de tokens\n`;
}

function selectWithinBudget(entries: FileEntry[], maxTokens: number) {
  const everything = entries.map((entry) => new Set(entry.ranked.keys()));
  const fullText = entries.map((entry, i) => renderBlock(entry, everything[i])).join("\n");
  if (estimateTokens(fullText) <= maxTokens) {
    return {
      markdown: fullText,
      shown: entries.map((entry, i) => ({ entry, detailed: everything[i] })),
      omitted: [] as string[],
    };
  }

  // Reserva o rodapé no pior caso (todos os arquivos omitidos) para não estourar o teto.
  const capacity = maxTokens * 4 - renderFooter(entries.length).length;
  const detailed = entries.map(() => new Set<number>());
  const blocks: Array<string | null> = entries.map(() => null);
  let total = 0;
  const cost = (block: string) => block.length + 1; // +1: separador "\n" entre blocos

  const globalOrder = entries
    .flatMap((entry, fileIndex) =>
      entry.ranked.map((item, symbolIndex) => ({
        fileIndex,
        symbolIndex,
        score: item.score + entry.importers,
      }))
    )
    .sort((a, b) =>
      entries[a.fileIndex].tier - entries[b.fileIndex].tier || b.score - a.score ||
      compare(entries[a.fileIndex].path, entries[b.fileIndex].path) ||
      a.symbolIndex - b.symbolIndex
    );

  const tryUpgrade = (fileIndex: number, symbolIndex: number, limit: number) => {
    const next = new Set(detailed[fileIndex]).add(symbolIndex);
    const block = renderBlock(entries[fileIndex], next);
    const previous = blocks[fileIndex];
    const delta = cost(block) - (previous === null ? 0 : cost(previous));
    if (total + delta > limit) return;
    detailed[fileIndex] = next;
    blocks[fileIndex] = block;
    total += delta;
  };

  // Passada 1: assinaturas completas dos símbolos mais relevantes, até DETAIL_SHARE do orçamento.
  const detailLimit = Math.floor(capacity * DETAIL_SHARE);
  for (const item of globalOrder) tryUpgrade(item.fileIndex, item.symbolIndex, detailLimit);

  // Passada 2: arquivos restantes entram condensados (só nomes) enquanto couberem.
  entries.forEach((entry, fileIndex) => {
    if (blocks[fileIndex] !== null) return;
    const block = renderBlock(entry, detailed[fileIndex]);
    if (total + cost(block) > capacity) return;
    blocks[fileIndex] = block;
    total += cost(block);
  });

  // Passada 3: a sobra volta a detalhar símbolos dos arquivos que já aparecem.
  for (const item of globalOrder) {
    if (blocks[item.fileIndex] === null || detailed[item.fileIndex].has(item.symbolIndex)) continue;
    tryUpgrade(item.fileIndex, item.symbolIndex, capacity);
  }

  const shown = entries.flatMap((entry, i) =>
    blocks[i] === null ? [] : [{ entry, detailed: detailed[i] }]
  );
  const omitted = entries.filter((_, i) => blocks[i] === null).map((entry) => entry.path);
  let markdown = blocks.filter((block): block is string => block !== null).join("\n");
  if (omitted.length > 0) {
    markdown = `${markdown}${markdown ? "\n" : ""}${renderFooter(omitted.length)}`;
  }
  if (estimateTokens(markdown) > maxTokens) {
    // Orçamento menor que o próprio rodapé: nada cabe.
    return { markdown: "", shown: [], omitted: entries.map((entry) => entry.path) };
  }
  return { markdown, shown, omitted };
}

// ---------------------------------------------------------------------------------------------
// Escopo (foco)
// ---------------------------------------------------------------------------------------------

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

/**
 * Arquivos do foco: os `files` que são fontes mapeados mais os arquivos do `module` (união), exceto
 * que o módulo catch-all só entra quando nenhum arquivo resolve. Sem `module` nem `files`, devolve
 * um conjunto vazio (mapa sem escopo). Registra em `warnings` os casos em que o escopo é fraco.
 */
function resolveFocus(
  known: string[],
  options: RepoMapOptions,
  warnings: string[],
): Set<string> {
  const requested = (options.files ?? []).map(normalizePath).filter(Boolean);
  const mapped = new Set(known);
  const resolved = requested.filter((path) => mapped.has(path));
  const focus = new Set(resolved);

  if (options.module !== undefined) {
    if (options.moduleTestMap === undefined) {
      throw new Error(
        `module "${options.module}" exige moduleTestMap (conteúdo do module-test-map)`,
      );
    }
    const map = parseModuleTestMap(options.moduleTestMap);
    const available = [
      ...new Set([...Object.keys(map.commands), ...map.prefixes.map((entry) => entry.module)]),
    ];
    if (!available.includes(options.module)) {
      throw new Error(
        `módulo "${options.module}" não existe no module-test-map (disponíveis: ${
          available.join(", ")
        })`,
      );
    }
    const isCatchAll = options.module === catchAllModule(map);
    if (isCatchAll && resolved.length === 0) {
      warnings.push(
        `módulo "${options.module}" é o catch-all (./) e cobre os arquivos sem prefixo: o escopo ` +
          "pouco restringe; informe os arquivos-alvo",
      );
    }
    if (!isCatchAll || resolved.length === 0) {
      for (const path of known) {
        if (resolveModule([path], map) === options.module) focus.add(path);
      }
    }
  }

  if (requested.length > 0 && resolved.length === 0) {
    warnings.push(`nenhum dos arquivos informados é fonte mapeado: ${requested.join(", ")}`);
  }
  if (focus.size === 0 && (requested.length > 0 || options.module !== undefined)) {
    warnings.push("foco vazio: mapa sem escopo");
  }
  return focus;
}

// ---------------------------------------------------------------------------------------------
// API principal
// ---------------------------------------------------------------------------------------------

export async function buildRepoMap(options: RepoMapOptions = {}): Promise<RepoMapResult> {
  const root = options.root ?? ".";
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new RangeError(`maxTokens deve ser um inteiro positivo (recebido: ${maxTokens})`);
  }
  const cachePath = options.cachePath === undefined
    ? `${root}/${DEFAULT_CACHE_PATH}`
    : options.cachePath;
  const warnings: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];

  const previous = cachePath ? await loadCache(cachePath, warnings) : null;
  const paths = await listSourceFiles(root);
  const loaded = await mapChunked(
    paths,
    READ_CHUNK,
    (path) => loadFile(root, path, previous?.files[path], warnings),
  );

  const summaries = new Map<string, FileSymbolSummary>();
  const persistable: Record<string, FileSymbolSummary> = {};
  let parsed = 0;
  let cached = 0;
  let parsedPersistable = false;
  for (const file of loaded) {
    if (!file) continue;
    if ("skip" in file) {
      skipped.push({ path: file.path, reason: file.skip });
      continue;
    }
    summaries.set(file.path, file.summary);
    if (file.reused) cached++;
    else parsed++;
    // Resultados do fallback léxico não são persistidos: com o compilador de volta, valem mais.
    if (!file.fallback) {
      persistable[file.path] = file.summary;
      if (!file.reused) parsedPersistable = true;
    }
  }

  let cacheWritten = false;
  const pruned = previous !== null && Object.keys(previous.files).some((p) => !(p in persistable));
  if (cachePath && (parsedPersistable || pruned)) {
    try {
      await saveCache(cachePath, {
        version: CACHE_VERSION,
        lastUpdated: new Date().toISOString(),
        files: persistable,
      });
      cacheWritten = true;
    } catch (error) {
      warnings.push(`cache não gravado em ${cachePath}: ${(error as Error).message}`);
    }
  }

  const focus = resolveFocus([...summaries.keys()], options, warnings);
  const entries = rankFiles(summaries, focus);
  if (focus.size > 0 && !entries.some((entry) => entry.tier === 1)) {
    // Sem exports reconhecidos o foco some do mapa, que se enche de arquivos sem relação.
    const sample = [...focus].sort(compare);
    const listed = sample.slice(0, 3).join(", ");
    warnings.push(
      `foco sem símbolos exportados (${listed}${
        sample.length > 3 ? `, +${sample.length - 3}` : ""
      }): ` +
        "o mapa não está escopado",
    );
  }
  const stats = { parsed, cached, cacheWritten };
  if (entries.length === 0) {
    return {
      status: "empty",
      maxTokens,
      estimatedTokens: 0,
      markdown: "",
      files: [],
      omitted: [],
      skipped,
      warnings,
      stats,
    };
  }

  const selection = selectWithinBudget(entries, maxTokens);
  return {
    status: "ok",
    maxTokens,
    estimatedTokens: estimateTokens(selection.markdown),
    markdown: selection.markdown,
    files: selection.shown.map(({ entry, detailed }) => {
      const { full, listed } = partition(entry, detailed);
      return { path: entry.path, tier: entry.tier, score: entry.score, symbols: full, listed };
    }),
    omitted: selection.omitted,
    skipped,
    warnings,
    stats,
  };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const USAGE = "uso: deno run -A scripts/repo-map.ts [--max-tokens <N>] [--json] " +
  "[--module <nome> [--module-test-map <path>]] [--files <a,b>] [--cache-path <path>]";

const VALUE_FLAGS = ["--max-tokens", "--module", "--module-test-map", "--files", "--cache-path"];

interface CliArgs {
  maxTokens: number;
  json: boolean;
  module?: string;
  moduleTestMap?: string;
  files?: string[];
  cachePath?: string;
}

function parseCliArgs(args: string[]): CliArgs | { error: string } {
  const values = new Map<string, string>();
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
      continue;
    }
    const flag = VALUE_FLAGS.find((name) => arg === name || arg.startsWith(`${name}=`));
    if (!flag) return { error: `argumento desconhecido: ${arg}` };
    values.set(flag, arg === flag ? args[++i] ?? "" : arg.slice(flag.length + 1));
  }

  const rawTokens = values.get("--max-tokens");
  if (rawTokens !== undefined && (!/^\d+$/.test(rawTokens) || Number(rawTokens) < 1)) {
    return { error: `--max-tokens exige um inteiro positivo (recebido: ${rawTokens || "nada"})` };
  }
  for (const flag of VALUE_FLAGS) {
    if (values.get(flag) === "") return { error: `${flag} exige um valor` };
  }
  const files = values.get("--files")?.split(",").map((file) => file.trim()).filter(Boolean);
  return {
    maxTokens: rawTokens === undefined ? DEFAULT_MAX_TOKENS : Number(rawTokens),
    json,
    module: values.get("--module"),
    moduleTestMap: values.get("--module-test-map"),
    files,
    cachePath: values.get("--cache-path"),
  };
}

function failCli(message: string): never {
  console.error(`repo-map: ${message}`);
  Deno.exit(1);
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(Deno.args);
  if ("error" in parsed) {
    console.error(`${parsed.error}\n${USAGE}`);
    Deno.exit(2);
  }
  const root = Deno.cwd();
  let moduleTestMap: string | undefined;
  if (parsed.module !== undefined) {
    const mapPath = parsed.moduleTestMap ?? `${root}/.claude/vetor/module-test-map.md`;
    moduleTestMap = await Deno.readTextFile(mapPath).catch(() =>
      failCli(
        `não consegui ler o module-test-map em ${mapPath}; informe --module-test-map <path> ` +
          "(no worktree, use o do root do repositório)",
      )
    );
  }
  const result = await buildRepoMap({
    root,
    maxTokens: parsed.maxTokens,
    cachePath: parsed.cachePath,
    module: parsed.module,
    moduleTestMap,
    files: parsed.files,
  }).catch((error) => failCli(error instanceof Error ? error.message : String(error)));
  if (parsed.json) {
    console.log(JSON.stringify(result));
    return;
  }
  for (const warning of result.warnings) console.error(`aviso: ${warning}`);
  if (result.markdown) console.info(result.markdown.trimEnd());
}

if (import.meta.main) await main();
