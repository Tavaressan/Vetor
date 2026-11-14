/**
 * Perfil determinístico de tarefa (F2-2, ADR-002, contrato em
 * docs/investigations/contrato-minimo-fase-1.md §4.5, §5 e §6).
 * Só funções puras e fatos extraídos; nunca consulta o coordinator nem constrói ContextPacket.
 */

import {
  extractAcceptanceCriteria,
  extractTargetFiles,
  type ModuleTestMap,
  parseModuleTestMap,
  resolveModule,
} from "../orchestrator/context-packet.ts";
import type { DataSensitivity, ExplicitConstraints, FieldSource, TaskProfile } from "./types.ts";

export interface ProfileTaskInput {
  /** Número da issue ou id externo. */
  taskId: string;
  title: string;
  body: string;
  labels?: string[];
  /** Conteúdo do `module-test-map.md`. */
  moduleTestMap: string;
  /** Sobrescreve a inferência de arquivos-alvo a partir do título e do body. */
  targetFiles?: string[];
  specProvided?: boolean;
  microSpecProvided?: boolean;
  /** Restrições explícitas por entrada programática (§5.2); nunca derivadas. */
  explicit?: ExplicitConstraints;
  /** `execution.defaultDataSensitivity` da config; vira proveniência `config`. */
  defaultDataSensitivity?: DataSensitivity;
}

const TITLE_PREFIX_RE = /^([a-z][a-z0-9-]*)(?=[(:!])/i;

function deriveOperations(title: string): string[] {
  const match = title.trim().match(TITLE_PREFIX_RE);
  return match ? [match[1].toLowerCase()] : [];
}

function fallbackModule(map: ModuleTestMap): string | undefined {
  return map.prefixes.find((entry) => entry.prefix === "./")?.module ??
    Object.keys(map.commands)[0];
}

function moduleForFile(file: string, map: ModuleTestMap, fallback: string): string {
  let best: { prefix: string; module: string } | undefined;
  for (const entry of map.prefixes) {
    if (entry.prefix === "./" || !file.startsWith(entry.prefix)) continue;
    if (!best || entry.prefix.length > best.prefix.length) best = entry;
  }
  return best?.module ?? fallback;
}

/** Módulos do module-test-map resolvidos por arquivo, únicos, na ordem de primeira aparição. */
function resolveModules(files: string[], map: ModuleTestMap): string[] {
  const fallback = fallbackModule(map);
  if (!fallback) return [];
  if (files.length === 0) return [fallback];
  const seen = new Set<string>();
  const modules: string[] = [];
  for (const file of files) {
    const mod = moduleForFile(file, map, fallback);
    if (!seen.has(mod)) {
      seen.add(mod);
      modules.push(mod);
    }
  }
  return modules.length > 0 ? modules : [fallback];
}

function derivePathDomains(files: string[]): string[] {
  const seen = new Set<string>();
  const domains: string[] = [];
  for (const file of files) {
    const normalized = file.replaceAll("\\", "/");
    const [first] = normalized.split("/");
    if (!first || first === "." || first.includes(".")) continue;
    if (!seen.has(first)) {
      seen.add(first);
      domains.push(first);
    }
  }
  return domains;
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function profileTask(input: ProfileTaskInput): TaskProfile {
  const labels = input.labels ?? [];
  const title = input.title;
  const body = input.body;
  const text = `${title}\n${body}`;

  const acceptanceCriteria = extractAcceptanceCriteria(body);
  const targetFiles = input.targetFiles ?? extractTargetFiles(text);
  const map = parseModuleTestMap(input.moduleTestMap);

  // Chamada direta exigida pelo contrato (§5.3).
  const dominantModule = resolveModule(targetFiles, map);
  const resolvedModules = resolveModules(targetFiles, map);
  const modules = resolvedModules.length > 0 ? resolvedModules : [dominantModule];

  const operations = deriveOperations(title);
  const domains = unique([...derivePathDomains(targetFiles), ...modules]);

  const explicitReq = input.explicit?.requirements;
  const browser = explicitReq?.browser === true;
  const mcp = explicitReq?.mcp === true;
  const requirementsSource: FieldSource = explicitReq !== undefined ? "explicit" : "default";

  let dataSensitivity: DataSensitivity;
  let dataSensitivitySource: FieldSource;
  if (input.explicit?.dataSensitivity !== undefined) {
    dataSensitivity = input.explicit.dataSensitivity;
    dataSensitivitySource = "explicit";
  } else if (input.defaultDataSensitivity !== undefined) {
    dataSensitivity = input.defaultDataSensitivity;
    dataSensitivitySource = "config";
  } else {
    dataSensitivity = "unknown";
    dataSensitivitySource = "default";
  }

  const titlePrefix = operations[0];

  return {
    profileVersion: 1,
    taskId: input.taskId,
    operations,
    domains,
    complexity: "unknown",
    risk: "unknown",
    requirements: { browser, mcp },
    dataSensitivity,
    provenance: {
      operations: "derived",
      domains: "derived",
      complexity: "derived",
      risk: "derived",
      requirements: requirementsSource,
      dataSensitivity: dataSensitivitySource,
    },
    evidence: {
      ...(titlePrefix !== undefined ? { titlePrefix } : {}),
      labels: [...labels],
      acceptanceCriteriaCount: acceptanceCriteria.length,
      resolvedModules: [...modules],
      specProvided: input.specProvided === true,
      microSpecProvided: input.microSpecProvided === true,
    },
  };
}
