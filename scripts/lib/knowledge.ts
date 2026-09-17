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
  /** Path absoluto para a raiz do Vault do Obsidian (obrigatório quando `provider: "obsidian"`). */
  vault?: string;
  /** Subpasta opcional dentro do Vault que representa o projeto atual. */
  project?: string;
  /** Nomes de subdiretórios do Vault, configuráveis por projeto (ex.: `{ specs: "Specs" }`). */
  paths?: Record<string, string>;
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

// --- ObsidianKnowledgeProvider (issue #225) ---
//
// SEGURANÇA — conteúdo do Vault é dado não confiável: qualquer texto lido de uma entrada do
// Vault (via `read`/`search`) é retornado como dado bruto para quem chamou o provider. Ele
// NUNCA deve ser interpretado como instrução para um agente — mesmo que o conteúdo contenha
// algo formatado como comando/prompt (possível prompt injection plantada em um documento do
// Vault). Skills que consomem este provider devem tratar o retorno de `read`/`search` como
// texto a ser exibido/citado, nunca como diretiva a seguir.
//
// O provider nunca acopla a um SDK de MCP específico: ele recebe um `ObsidianMcpClient` já
// pronto para uso (injetado por quem o instancia) e permanece agnóstico de qual MCP de Obsidian
// está por trás dele — inclusive útil para testes com um cliente simulado/mockado.

/**
 * Abstração mínima sobre um MCP de Obsidian. Qualquer MCP compatível com estas operações pode
 * ser injetado em `ObsidianKnowledgeProvider` — o provider nunca importa um SDK específico.
 * Implementações devem lançar `ObsidianUnavailableError` quando a conexão com o Obsidian falhar
 * (indisponibilidade), para que o provider distinga isso de um erro de contrato (ex.: "já
 * existe"), que deve propagar normalmente em vez de acionar o fallback.
 */
export interface ObsidianMcpClient {
  search(query: string): Promise<KnowledgeSearchResult[]>;
  read(path: string): Promise<string>;
  create(path: string, content: string): Promise<void>;
  update(path: string, content: string): Promise<void>;
  list(path?: string): Promise<string[]>;
}

/** Sinaliza que o MCP de Obsidian está indisponível (conexão/timeout), não um erro de contrato. */
export class ObsidianUnavailableError extends Error {
  constructor(message = "MCP de Obsidian indisponível") {
    super(message);
    this.name = "ObsidianUnavailableError";
  }
}

export interface ObsidianVaultConfig {
  /** Path absoluto para a raiz do Vault no filesystem — usado pelo fallback e pela validação de path. */
  vault: string;
  /** Subpasta opcional dentro do Vault que representa este projeto. */
  project?: string;
  /** Nomes de subdiretórios do Vault, configuráveis — nunca hardcoded (ex.: `{ specs: "Specs" }`). */
  paths?: Record<string, string>;
}

function tryRealPathSync(path: string): string | undefined {
  try {
    return Deno.realPathSync(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return undefined;
    throw err;
  }
}

/**
 * Garante que `relativePath`, resolvido contra `vaultRoot`, não escapa da raiz do Vault através
 * de um symlink — mesmo quando o path final ainda não existe (ex.: `create` sob um diretório
 * cujo pai é um link simbólico). Caminha para cima até achar o ancestral existente mais próximo:
 * como o conteúdo do Vault é dado não confiável, um symlink plantado nele não pode ser seguido
 * para fora da raiz configurada.
 */
function assertNoSymlinkEscape(vaultRoot: string, relativePath: string): void {
  const vaultReal = tryRealPathSync(vaultRoot);
  if (vaultReal === undefined) return; // vault ainda não existe (ex.: primeira escrita) — nada a validar
  const vaultRealNormalized = toPosix(vaultReal);

  let current = `${vaultRoot}/${relativePath}`;
  while (true) {
    const real = tryRealPathSync(current);
    if (real !== undefined) {
      const realNormalized = toPosix(real);
      if (
        realNormalized !== vaultRealNormalized &&
        !realNormalized.startsWith(`${vaultRealNormalized}/`)
      ) {
        throw new Error(
          `ObsidianKnowledgeProvider: path escapa do vault via symlink: "${relativePath}"`,
        );
      }
      return;
    }
    const parentEnd = Math.max(current.lastIndexOf("/"), current.lastIndexOf("\\"));
    if (parentEnd <= 0 || current.slice(0, parentEnd) === current) return;
    current = current.slice(0, parentEnd);
  }
}

/**
 * Implementação do `KnowledgeProvider` que consome um MCP de Obsidian (injetado via
 * `ObsidianMcpClient`), com fallback explícito para `FilesystemKnowledgeProvider` — apontando
 * para a mesma raiz do Vault no filesystem — quando o MCP não está configurado ou reporta
 * indisponibilidade (`ObsidianUnavailableError`). Nunca finge sucesso: uma operação só é
 * considerada bem-sucedida quando o client ou o fallback efetivamente a completam; quando o
 * fallback é usado, `warning` fica preenchido com o motivo.
 */
export class ObsidianKnowledgeProvider implements KnowledgeProvider {
  private readonly fallback: FilesystemKnowledgeProvider;
  private readonly vaultRoot: string;
  /** Nomes de subdiretórios do Vault configurados — Skills os usam para montar paths, em vez de hardcodar. */
  readonly paths: Readonly<Record<string, string>>;
  /** Motivo do fallback na última operação, ou `undefined` se ela foi atendida pelo MCP. */
  warning: string | undefined;

  constructor(
    private readonly client: ObsidianMcpClient | undefined,
    config: ObsidianVaultConfig,
    private readonly warn: (message: string) => void = (message) => console.warn(message),
  ) {
    if (!config.vault || config.vault.trim() === "") {
      throw new Error("ObsidianKnowledgeProvider: config.knowledge.vault é obrigatório");
    }
    this.vaultRoot = config.project ? `${config.vault}/${config.project}` : config.vault;
    this.paths = Object.freeze({ ...(config.paths ?? {}) });
    this.fallback = new FilesystemKnowledgeProvider(this.vaultRoot);
  }

  private assertSafeVaultPath(path: string): void {
    assertSafeRelativePath(path);
    assertNoSymlinkEscape(this.vaultRoot, path);
  }

  private reportFallback(message: string): void {
    this.warning = message;
    this.warn(message);
  }

  private async withFallback<T>(
    op: string,
    run: (client: ObsidianMcpClient) => Promise<T>,
    runFallback: () => Promise<T>,
  ): Promise<T> {
    if (!this.client) {
      this.reportFallback(
        `ObsidianKnowledgeProvider: nenhum MCP de Obsidian configurado — usando ` +
          `FilesystemKnowledgeProvider como fallback ("${op}").`,
      );
      return runFallback();
    }
    try {
      const result = await run(this.client);
      this.warning = undefined;
      return result;
    } catch (err) {
      if (err instanceof ObsidianUnavailableError) {
        this.reportFallback(
          `ObsidianKnowledgeProvider: MCP de Obsidian indisponível (${err.message}) — usando ` +
            `FilesystemKnowledgeProvider como fallback ("${op}").`,
        );
        return runFallback();
      }
      throw err;
    }
  }

  search(query: string): Promise<KnowledgeSearchResult[]> {
    return this.withFallback(
      "search",
      (client) => client.search(query),
      () => this.fallback.search(query),
    );
  }

  // As assinaturas abaixo usam `async` mesmo sem `await` direto para que a validação de path
  // (síncrona) vire rejeição de Promise, e não um throw síncrono — consistente com o restante
  // do contrato, onde toda operação inválida se manifesta como Promise rejeitada.

  // deno-lint-ignore require-await
  async read(path: string): Promise<string> {
    this.assertSafeVaultPath(path);
    return this.withFallback(
      "read",
      (client) => client.read(path),
      () => this.fallback.read(path),
    );
  }

  // deno-lint-ignore require-await
  async create(path: string, content: string): Promise<void> {
    this.assertSafeVaultPath(path);
    return this.withFallback(
      "create",
      (client) => client.create(path, content),
      () => this.fallback.create(path, content),
    );
  }

  // deno-lint-ignore require-await
  async update(path: string, content: string): Promise<void> {
    this.assertSafeVaultPath(path);
    return this.withFallback(
      "update",
      (client) => client.update(path, content),
      () => this.fallback.update(path, content),
    );
  }

  // deno-lint-ignore require-await
  async list(path = ""): Promise<string[]> {
    if (path) this.assertSafeVaultPath(path);
    return this.withFallback(
      "list",
      (client) => client.list(path || undefined),
      () => this.fallback.list(path),
    );
  }

  async link(source: string, target: string): Promise<void> {
    this.assertSafeVaultPath(source);
    this.assertSafeVaultPath(target);
    const content = await this.read(source);
    await this.read(target); // apenas para validar existência — contrato exige que target também exista
    const line = `- Relacionado: ${target}`;
    if (content.split(/\r?\n/).some((l) => l.trim() === line)) return;
    const separator = content.endsWith("\n") || content === "" ? "" : "\n";
    await this.update(source, `${content}${separator}\n${line}\n`);
  }
}
