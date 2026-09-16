// Abstração KnowledgeProvider e implementação padrão em filesystem.
//
// Contrato mínimo que qualquer implementação (Filesystem, Obsidian, ...) deve seguir —
// documentado aqui e em skills/shared/references/knowledge-provider-contract.md:
//
// - `create` em um path já existente lança erro (não sobrescreve silenciosamente).
// - `update`/`read` em um path inexistente lançam erro.
// - `link(source, target)` é idempotente: aplicar duas vezes não duplica a referência.
// - `link` exige que `source` e `target` já existam.
// - `search` combina por conteúdo OU path, case-insensitive.
// - Paths são relativos à raiz do provider, usam `/` como separador e nunca podem
//   escapar da raiz (segmentos `..` ou paths absolutos são rejeitados).
//
// `FilesystemKnowledgeProvider` nunca lê `.claude/vetor/config.json` — funciona de forma
// idêntica com ou sem `knowledge` configurado. A leitura de config fica isolada em
// `detectKnowledgeState`, usada apenas para reportar o estado na inicialização do Vetor.

export interface KnowledgeSearchResult {
  path: string;
  excerpt: string;
}

export interface KnowledgeProvider {
  /** Busca entradas cujo path ou conteúdo combina com a query (case-insensitive). */
  search(query: string): Promise<KnowledgeSearchResult[]>;
  /** Lê o conteúdo de uma entrada. Lança se o path não existir. */
  read(path: string): Promise<string>;
  /** Cria uma nova entrada. Lança se o path já existir. */
  create(path: string, content: string): Promise<void>;
  /** Sobrescreve o conteúdo de uma entrada existente. Lança se o path não existir. */
  update(path: string, content: string): Promise<void>;
  /** Lista os paths das entradas sob `path` (raiz do provider quando omitido). */
  list(path?: string): Promise<string[]>;
  /** Cria uma referência semântica entre duas entradas existentes. Idempotente. */
  link(source: string, target: string): Promise<void>;
  delete?(path: string): Promise<void>;
  move?(source: string, target: string): Promise<void>;
  exists?(path: string): Promise<boolean>;
}

function assertSafeRelativePath(path: string): void {
  if (
    path === "" || path.startsWith("/") || path.startsWith("\\") ||
    /^[a-zA-Z]:[\\/]/.test(path) || path.split(/[\\/]/).includes("..")
  ) {
    throw new Error(`KnowledgeProvider: path inválido ou fora da raiz do provider: "${path}"`);
  }
}

function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

export class FilesystemKnowledgeProvider implements KnowledgeProvider {
  constructor(private readonly rootDir: string = "docs") {}

  private resolve(path: string): string {
    assertSafeRelativePath(path);
    return `${this.rootDir}/${path}`;
  }

  private fileExists(path: string): boolean {
    try {
      return Deno.statSync(path).isFile;
    } catch {
      return false;
    }
  }

  // deno-lint-ignore require-await
  async read(path: string): Promise<string> {
    const full = this.resolve(path);
    if (!this.fileExists(full)) {
      throw new Error(`KnowledgeProvider: entrada não encontrada: "${path}"`);
    }
    return Deno.readTextFileSync(full);
  }

  // deno-lint-ignore require-await
  async create(path: string, content: string): Promise<void> {
    const full = this.resolve(path);
    if (this.fileExists(full)) {
      throw new Error(`KnowledgeProvider: entrada já existe: "${path}"`);
    }
    const dir = full.slice(0, full.lastIndexOf("/"));
    if (dir) Deno.mkdirSync(dir, { recursive: true });
    Deno.writeTextFileSync(full, content);
  }

  // deno-lint-ignore require-await
  async update(path: string, content: string): Promise<void> {
    const full = this.resolve(path);
    if (!this.fileExists(full)) {
      throw new Error(`KnowledgeProvider: entrada não encontrada: "${path}"`);
    }
    Deno.writeTextFileSync(full, content);
  }

  // deno-lint-ignore require-await
  async list(path = ""): Promise<string[]> {
    const full = path ? this.resolve(path) : this.rootDir;
    if (!existsDir(full)) return [];

    const results: string[] = [];
    const walk = (current: string) => {
      for (const entry of Deno.readDirSync(current)) {
        const entryPath = `${current}/${entry.name}`;
        if (entry.isDirectory) {
          walk(entryPath);
        } else if (entry.isFile) {
          results.push(toPosix(entryPath.slice(this.rootDir.length + 1)));
        }
      }
    };
    walk(full);
    return results;
  }

  async search(query: string): Promise<KnowledgeSearchResult[]> {
    const needle = query.toLowerCase();
    const results: KnowledgeSearchResult[] = [];
    for (const path of await this.list()) {
      let content: string;
      try {
        // Entradas binárias (ex.: imagens em um vault) não são conteúdo pesquisável,
        // mas não podem quebrar a busca — apenas o match por path continua valendo.
        content = Deno.readTextFileSync(`${this.rootDir}/${path}`);
      } catch {
        content = "";
      }
      if (path.toLowerCase().includes(needle) || content.toLowerCase().includes(needle)) {
        results.push({ path, excerpt: content.slice(0, 200) });
      }
    }
    return results;
  }

  private linkLine(target: string): string {
    return `- Relacionado: ${target}`;
  }

  // deno-lint-ignore require-await
  async link(source: string, target: string): Promise<void> {
    const sourceFull = this.resolve(source);
    const targetFull = this.resolve(target);
    if (!this.fileExists(sourceFull) || !this.fileExists(targetFull)) {
      throw new Error(
        `KnowledgeProvider: link exige que source e target existam ("${source}" -> "${target}")`,
      );
    }
    const content = Deno.readTextFileSync(sourceFull);
    const line = this.linkLine(target);
    // Idempotente: compara a linha renderizada, não uma substring solta — evita falso
    // positivo (ex.: já existir "b.md" ao linkar "ab.md") e falso negativo.
    if (content.split(/\r?\n/).some((l) => l.trim() === line)) return;
    const separator = content.endsWith("\n") || content === "" ? "" : "\n";
    Deno.writeTextFileSync(sourceFull, `${content}${separator}\n${line}\n`);
  }

  // deno-lint-ignore require-await
  async delete(path: string): Promise<void> {
    const full = this.resolve(path);
    if (!this.fileExists(full)) {
      throw new Error(`KnowledgeProvider: entrada não encontrada: "${path}"`);
    }
    Deno.removeSync(full);
  }

  // deno-lint-ignore require-await
  async move(source: string, target: string): Promise<void> {
    const sourceFull = this.resolve(source);
    const targetFull = this.resolve(target);
    if (!this.fileExists(sourceFull)) {
      throw new Error(`KnowledgeProvider: entrada não encontrada: "${source}"`);
    }
    if (this.fileExists(targetFull)) {
      throw new Error(`KnowledgeProvider: entrada já existe: "${target}"`);
    }
    const dir = targetFull.slice(0, targetFull.lastIndexOf("/"));
    if (dir) Deno.mkdirSync(dir, { recursive: true });
    Deno.renameSync(sourceFull, targetFull);
  }

  // deno-lint-ignore require-await
  async exists(path: string): Promise<boolean> {
    return this.fileExists(this.resolve(path));
  }
}

function existsDir(path: string): boolean {
  try {
    return Deno.statSync(path).isDirectory;
  } catch {
    return false;
  }
}

// --- Detecção do estado do Knowledge Provider (usada por /vetor na inicialização) ---

export type KnowledgeStatus = "filesystem" | "obsidian" | "disabled";

export interface KnowledgeState {
  status: KnowledgeStatus;
  label: string;
}

export interface KnowledgeConfig {
  enabled?: boolean;
  provider?: string;
}

export interface VetorConfigWithKnowledge {
  knowledge?: KnowledgeConfig;
}

/**
 * Deriva o estado do Knowledge Provider a partir de `.claude/vetor/config.json` para
 * reportar na inicialização do Vetor. Nunca lança: ausência de `knowledge` (ou de config)
 * é tratada como o default sempre-funcional (`filesystem`), nunca como erro.
 */
export function detectKnowledgeState(
  config: VetorConfigWithKnowledge | null | undefined,
): KnowledgeState {
  const knowledge = config?.knowledge;

  if (knowledge?.enabled === false) {
    return { status: "disabled", label: "○ Disabled" };
  }
  if (knowledge?.provider === "obsidian") {
    return { status: "obsidian", label: "✓ Obsidian" };
  }
  return { status: "filesystem", label: "✓ Filesystem" };
}
