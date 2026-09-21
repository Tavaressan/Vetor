// Camada de consumo do Knowledge Provider (issue #226): frontmatter simples
// (type/project/status/datas), identidade estável de documento (ex.: "spec:authentication",
// "adr:001") e o padrão "consultar conhecimento existente antes de agir" usado por skills como
// /vetor:spec (ver scripts/knowledge-doc.ts, o CLI que expõe estas funções às skills).
//
// Consome a interface `KnowledgeProvider` (scripts/lib/knowledge.ts) sem alterá-la — mantém o
// contrato estável para implementações futuras (ex.: ObsidianKnowledgeProvider, issue #225).
// Links entre documentos usam `provider.link`, que já opera sobre paths reais (não identidades);
// esta camada só resolve a identidade de documentos que ela própria cria (specs).

import { linkLine } from "./knowledge.ts";
import type { KnowledgeProvider, KnowledgeSearchResult } from "./knowledge.ts";

export interface DocIdentity {
  type: string;
  slug: string;
}

const IDENTITY_SEPARATOR = ":";

/** Deriva um slug estável (kebab-case, sem acentos) a partir de um tema livre. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Identidade estável de documento, ex.: "spec:authentication", "adr:001". */
export function docIdentity(type: string, slug: string): string {
  return `${type}${IDENTITY_SEPARATOR}${slug}`;
}

/** Devolve `null` para uma identidade sem separador ou com type/slug vazio. */
export function parseDocIdentity(identity: string): DocIdentity | null {
  const idx = identity.indexOf(IDENTITY_SEPARATOR);
  if (idx <= 0 || idx === identity.length - 1) return null;
  return { type: identity.slice(0, idx), slug: identity.slice(idx + 1) };
}

// Diretório por tipo de documento — apenas os tipos hoje consumidos por skills do Vetor.
// Tipo sem entrada aqui usa `${type}s` como default (ex.: "context" -> "contexts/").
const TYPE_DIRS: Record<string, string> = {
  spec: "specs",
  adr: "adr",
  architecture: "architecture",
  context: "context",
};

/** Path canônico do documento a partir da identidade, ex.: "spec:auth" -> "specs/auth.md". */
export function pathForIdentity(identity: string): string {
  const parsed = parseDocIdentity(identity);
  if (!parsed) {
    throw new Error(`KnowledgeProvider: identidade de documento inválida: "${identity}"`);
  }
  const dir = TYPE_DIRS[parsed.type] ?? `${parsed.type}s`;
  return `${dir}/${parsed.slug}.md`;
}

export interface DocFrontmatter {
  id: string;
  type: string;
  project: string;
  status: string;
  created: string;
  updated: string;
}

/** Serializa frontmatter simples (chave: valor) — sem dependência de parser YAML externo. */
export function buildFrontmatter(fields: DocFrontmatter): string {
  return [
    "---",
    `id: ${fields.id}`,
    `type: ${fields.type}`,
    `project: ${fields.project}`,
    `status: ${fields.status}`,
    `created: ${fields.created}`,
    `updated: ${fields.updated}`,
    "---",
    "",
  ].join("\n");
}

export interface ParsedDoc {
  frontmatter: Record<string, string>;
  body: string;
}

/** Parseia o frontmatter (chave: valor) no topo do documento. Sem frontmatter → objeto vazio. */
export function parseFrontmatter(content: string): ParsedDoc {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: {}, body: content };
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { frontmatter, body: content.slice(match[0].length) };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Prefixo de uma linha de link (`linkLine("")` == "- Relacionado: ") — reconhece uma linha já
// gravada por `provider.link` sem precisar saber o target de antemão.
const RELATED_LINE_PREFIX = linkLine("");

/** Extrai as linhas `- Relacionado: <target>` do corpo de um documento, na ordem em que aparecem. */
function extractLinkLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line.startsWith(RELATED_LINE_PREFIX) && line.length > RELATED_LINE_PREFIX.length
    );
}

/**
 * Preserva no novo corpo qualquer linha `- Relacionado: <target>` já gravada no corpo atual (por
 * `provider.link`, ex.: `create-spec --link`) que não conste no novo rascunho. `update-spec` não
 * conhece esses vínculos — eles vivem no corpo, não no frontmatter — e seriam apagados
 * silenciosamente se o corpo fosse simplesmente substituído (issue #219, blocker do code-review
 * consultivo na PR #280). Não adiciona um vínculo novo — só evita perder um já existente.
 */
function preserveExistingLinks(currentBody: string, newBody: string): string {
  const existingLinks = extractLinkLines(currentBody);
  if (existingLinks.length === 0) return newBody;
  const newBodyLinks = new Set(extractLinkLines(newBody));
  const missingLinks = existingLinks.filter((line) => !newBodyLinks.has(line));
  if (missingLinks.length === 0) return newBody;
  // Mesma lógica de separador usada por `provider.link` (knowledge.ts) — mantém o formato
  // consistente entre um link criado por `create-spec --link` e um preservado por `update-spec`.
  const separator = newBody.endsWith("\n") || newBody === "" ? "" : "\n";
  return `${newBody}${separator}\n${missingLinks.join("\n")}\n`;
}

/**
 * Cria um documento com frontmatter válido (type/project/status/datas) e identidade estável.
 * Delega a `provider.create` — lança se já existir uma entrada na mesma identidade, nunca
 * sobrescreve silenciosamente.
 */
export async function createDocument(
  provider: KnowledgeProvider,
  params: { type: string; slug: string; project: string; status: string; body: string },
): Promise<{ identity: string; path: string }> {
  const identity = docIdentity(params.type, params.slug);
  const path = pathForIdentity(identity);
  const today = todayISO();
  const frontmatter = buildFrontmatter({
    id: identity,
    type: params.type,
    project: params.project,
    status: params.status,
    created: today,
    updated: today,
  });
  await provider.create(path, `${frontmatter}${params.body}`);
  return { identity, path };
}

/**
 * Atualiza um documento existente (escolha `update` do fluxo de overwrite — issue #219),
 * preservando `id`/`type`/`project`/`created` do frontmatter atual e só sobrescrevendo `status`
 * quando explicitamente informado; `updated` sempre avança para a data de hoje. Delega a
 * `provider.read` + `provider.update` — lança se a identidade não existir (mesmo contrato de
 * `provider.update`), nunca cria uma entrada nova por engano.
 */
export async function updateDocument(
  provider: KnowledgeProvider,
  params: { type: string; slug: string; status?: string; body: string },
): Promise<{ identity: string; path: string }> {
  const identity = docIdentity(params.type, params.slug);
  const path = pathForIdentity(identity);
  const current = await provider.read(path);
  const { frontmatter: currentFrontmatter, body: currentBody } = parseFrontmatter(current);
  // `project` e `created` só existem em documentos com frontmatter completo (ex.: criados via
  // createDocument). Um documento sem frontmatter válido (legado, ou editado à mão) nunca deve
  // ser reescrito com esses campos vazios silenciosamente — melhor falhar com ERRO claro do que
  // corromper a identidade/rastreabilidade do documento.
  if (!currentFrontmatter.project || !currentFrontmatter.created) {
    throw new Error(
      `KnowledgeProvider: não é possível atualizar "${path}" — frontmatter ausente ou incompleto ` +
        `(esperado ao menos "project" e "created").`,
    );
  }
  const frontmatter = buildFrontmatter({
    // `||` (truthy), não `??` — alinhado com o guard acima: um `id`/`type` vazio ("", não
    // ausente) também precisa ser reparado a partir da identidade canônica, nunca preservado
    // vazio silenciosamente.
    id: currentFrontmatter.id || identity,
    type: currentFrontmatter.type || params.type,
    project: currentFrontmatter.project,
    status: params.status ?? currentFrontmatter.status ?? "draft",
    created: currentFrontmatter.created,
    updated: todayISO(),
  });
  const body = preserveExistingLinks(currentBody, params.body);
  await provider.update(path, `${frontmatter}${body}`);
  return { identity, path };
}

/**
 * Localiza um documento pela sua identidade estável, resolvendo diretamente o path canônico
 * (não busca por texto) — evita falso-positivo de um documento que apenas *menciona* a
 * identidade em um link.
 */
export async function findByIdentity(
  provider: KnowledgeProvider,
  identity: string,
): Promise<KnowledgeSearchResult | null> {
  const path = pathForIdentity(identity);
  try {
    const content = await provider.read(path);
    return { path, excerpt: content.slice(0, 200) };
  } catch {
    return null;
  }
}

/** Busca prévia por Specs relacionadas a uma query, antes de gerar uma Spec nova. */
export async function findRelatedSpecs(
  provider: KnowledgeProvider,
  query: string,
): Promise<KnowledgeSearchResult[]> {
  const results = await provider.search(query);
  return results.filter((r) => r.path.startsWith("specs/"));
}
