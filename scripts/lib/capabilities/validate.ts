import { CAPABILITY_NAMES, type HarnessDescriptor } from "./types.ts";

export interface ValidationError {
  /** Caminho do campo com problema (ex.: "id", "declared.terminal.source"). */
  path: string;
  message: string;
}

export interface ValidateDescriptorOptions {
  /** IDs já registrados; usado para rejeitar duplicatas. */
  existingIds?: Iterable<string>;
}

const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CAPABILITY_NAME_SET: ReadonlySet<string> = new Set(CAPABILITY_NAMES);

/**
 * Verifica se uma faixa de versão é "parseável" de forma básica (semântica
 * mínima): não vazia e composta por dígitos, letras, pontos, hífens, espaços,
 * vírgulas e operadores/comparadores usuais de range (>=, <=, ^, ~, *, x, X,
 * ||). A validação completa de semver/range fica a cargo de consumidores que
 * precisem comparar versões; aqui garantimos apenas que o campo não é lixo.
 */
function isParseableVersionRange(value: string): boolean {
  if (value.trim().length === 0) return false;
  // Aceita tokens típicos de semver/ranges: 1.2.3, >=1.0.0 <2.0.0, ^1.2, ~2, 1.x, *
  return /^[0-9A-Za-z.*xX^~<>=|,\-\s+]+$/.test(value) &&
    /[0-9*Xx]/.test(value);
}

/**
 * Valida um HarnessDescriptor de forma pura.
 * Retorna a lista de erros encontrados (vazia quando válido).
 */
export function validateDescriptor(
  descriptor: HarnessDescriptor,
  options: ValidateDescriptorOptions = {},
): ValidationError[] {
  const errors: ValidationError[] = [];

  // descriptorVersion
  if (descriptor.descriptorVersion !== 1) {
    errors.push({
      path: "descriptorVersion",
      message: "descriptorVersion deve ser 1",
    });
  }

  // id: kebab-case
  if (typeof descriptor.id !== "string" || descriptor.id.length === 0) {
    errors.push({ path: "id", message: "id é obrigatório" });
  } else if (!KEBAB_CASE_RE.test(descriptor.id)) {
    errors.push({
      path: "id",
      message: "id deve ser kebab-case (ex.: claude-code, alethe)",
    });
  }

  // id único
  if (options.existingIds && typeof descriptor.id === "string") {
    for (const existing of options.existingIds) {
      if (existing === descriptor.id) {
        errors.push({
          path: "id",
          message: `id "${descriptor.id}" já está registrado`,
        });
        break;
      }
    }
  }

  // kind
  if (descriptor.kind !== "cli" && descriptor.kind !== "orchestrator") {
    errors.push({
      path: "kind",
      message: 'kind deve ser "cli" ou "orchestrator"',
    });
  }

  // command obrigatório quando kind é cli
  if (descriptor.kind === "cli") {
    if (typeof descriptor.command !== "string" || descriptor.command.trim().length === 0) {
      errors.push({
        path: "command",
        message: 'command é obrigatório e não vazio quando kind é "cli"',
      });
    }
  } else if (descriptor.command !== undefined) {
    if (typeof descriptor.command !== "string" || descriptor.command.trim().length === 0) {
      errors.push({
        path: "command",
        message: "command, quando presente, não pode ser vazio",
      });
    }
  }

  // versionRange parseável (se presente)
  if (descriptor.versionRange !== undefined) {
    if (
      typeof descriptor.versionRange !== "string" ||
      !isParseableVersionRange(descriptor.versionRange)
    ) {
      errors.push({
        path: "versionRange",
        message: "versionRange deve ser uma faixa semver parseável",
      });
    }
  }

  // declared: nomes conhecidos e source não vazio em toda afirmação
  if (
    descriptor.declared === null || descriptor.declared === undefined ||
    typeof descriptor.declared !== "object" || Array.isArray(descriptor.declared)
  ) {
    errors.push({
      path: "declared",
      message: "declared deve ser um objeto (mapa de capacidades)",
    });
  } else {
    for (const [name, claim] of Object.entries(descriptor.declared)) {
      const path = `declared.${name}`;
      if (!CAPABILITY_NAME_SET.has(name)) {
        errors.push({
          path,
          message: `capacidade desconhecida: "${name}"`,
        });
        continue;
      }
      if (claim === null || claim === undefined || typeof claim !== "object") {
        errors.push({
          path,
          message: "afirmação de capacidade deve ser um objeto",
        });
        continue;
      }
      if (
        claim.state !== "supported" && claim.state !== "unsupported" &&
        claim.state !== "unknown"
      ) {
        errors.push({
          path: `${path}.state`,
          message: 'state deve ser "supported", "unsupported" ou "unknown"',
        });
      }
      if (typeof claim.source !== "string" || claim.source.trim().length === 0) {
        errors.push({
          path: `${path}.source`,
          message: "source é obrigatório e não vazio em toda afirmação",
        });
      }
    }
  }

  return errors;
}
