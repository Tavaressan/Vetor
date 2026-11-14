import { DATA_SENSITIVITIES, type DataSensitivity, type PolicyMode } from "./types.ts";

export interface ExecutionPolicy {
  mode: PolicyMode;
  authorizedExecutors: string[];
  /** Níveis ausentes são normalizados para listas vazias e, portanto, bloqueiam o roteamento. */
  dataSensitivityPolicy: Record<DataSensitivity, string[]>;
  defaultDataSensitivity?: DataSensitivity;
  /** Retentativas após o primeiro dispatch. */
  maxRetryAttempts: number;
}

export interface ExecutionPolicyValidationError {
  path: string;
  message: string;
}

export interface ExecutionPolicyParseResult {
  policy: ExecutionPolicy;
  errors: ExecutionPolicyValidationError[];
}

const DEFAULT_MAX_RETRY_ATTEMPTS = 2;
const POLICY_MODE_SET: ReadonlySet<string> = new Set(["manual", "assisted", "autonomous"]);
const DATA_SENSITIVITY_SET: ReadonlySet<string> = new Set(DATA_SENSITIVITIES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPolicyMode(value: unknown): value is PolicyMode {
  return typeof value === "string" && POLICY_MODE_SET.has(value);
}

function isDataSensitivity(value: unknown): value is DataSensitivity {
  return typeof value === "string" && DATA_SENSITIVITY_SET.has(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0 && item.trim() === item);
}

function defaultPolicy(): ExecutionPolicy {
  return {
    mode: "manual",
    authorizedExecutors: [],
    dataSensitivityPolicy: {
      public: [],
      private: [],
      sensitive: [],
      unknown: [],
    },
    maxRetryAttempts: DEFAULT_MAX_RETRY_ATTEMPTS,
  };
}

/**
 * Lê e valida `execution` de um objeto de configuração já carregado.
 * Configuração ausente usa os padrões; qualquer configuração inválida falha fechada
 * para `manual`, permitindo ao chamador manter o comportamento inline.
 */
export function parseExecutionPolicy(config: unknown): ExecutionPolicyParseResult {
  const errors: ExecutionPolicyValidationError[] = [];

  if (config === undefined) {
    return { policy: defaultPolicy(), errors };
  }
  if (!isRecord(config)) {
    return {
      policy: defaultPolicy(),
      errors: [{ path: "config", message: "config deve ser um objeto" }],
    };
  }
  if (config.execution === undefined) {
    return { policy: defaultPolicy(), errors };
  }
  if (!isRecord(config.execution)) {
    return {
      policy: defaultPolicy(),
      errors: [{ path: "execution", message: "execution deve ser um objeto" }],
    };
  }

  const execution = config.execution;
  let mode: PolicyMode = "manual";
  if (execution.mode !== undefined) {
    if (isPolicyMode(execution.mode)) {
      mode = execution.mode;
    } else {
      errors.push({
        path: "execution.mode",
        message: 'mode deve ser "manual", "assisted" ou "autonomous"',
      });
    }
  }

  let authorizedExecutors: string[] = [];
  if (execution.authorizedExecutors !== undefined) {
    if (isStringList(execution.authorizedExecutors)) {
      authorizedExecutors = [...execution.authorizedExecutors];
    } else {
      errors.push({
        path: "execution.authorizedExecutors",
        message: "authorizedExecutors deve ser uma lista de strings não vazias",
      });
    }
  } else if (mode !== "manual") {
    errors.push({
      path: "execution.authorizedExecutors",
      message: `authorizedExecutors é obrigatório no modo ${mode}`,
    });
  }

  const dataSensitivityPolicy: Record<DataSensitivity, string[]> = {
    public: [],
    private: [],
    sensitive: [],
    unknown: [],
  };
  if (execution.dataSensitivityPolicy !== undefined) {
    if (!isRecord(execution.dataSensitivityPolicy)) {
      errors.push({
        path: "execution.dataSensitivityPolicy",
        message: "dataSensitivityPolicy deve ser um objeto",
      });
    } else {
      for (const [sensitivity, executors] of Object.entries(execution.dataSensitivityPolicy)) {
        if (!isDataSensitivity(sensitivity)) {
          errors.push({
            path: `execution.dataSensitivityPolicy.${sensitivity}`,
            message: `nível de sensibilidade desconhecido: "${sensitivity}"`,
          });
        } else if (!isStringList(executors)) {
          errors.push({
            path: `execution.dataSensitivityPolicy.${sensitivity}`,
            message: "cada nível deve conter uma lista de strings não vazias",
          });
        } else {
          dataSensitivityPolicy[sensitivity] = [...executors];
        }
      }
    }
  } else if (mode !== "manual") {
    errors.push({
      path: "execution.dataSensitivityPolicy",
      message: `dataSensitivityPolicy é obrigatória no modo ${mode}`,
    });
  }

  let defaultDataSensitivity: DataSensitivity | undefined;
  if (execution.defaultDataSensitivity !== undefined) {
    if (isDataSensitivity(execution.defaultDataSensitivity)) {
      defaultDataSensitivity = execution.defaultDataSensitivity;
    } else {
      errors.push({
        path: "execution.defaultDataSensitivity",
        message: 'defaultDataSensitivity deve ser "public", "private", "sensitive" ou "unknown"',
      });
    }
  }

  let maxRetryAttempts = DEFAULT_MAX_RETRY_ATTEMPTS;
  if (execution.maxRetryAttempts !== undefined) {
    if (
      typeof execution.maxRetryAttempts === "number" &&
      Number.isSafeInteger(execution.maxRetryAttempts) &&
      execution.maxRetryAttempts >= 0
    ) {
      maxRetryAttempts = execution.maxRetryAttempts;
    } else {
      errors.push({
        path: "execution.maxRetryAttempts",
        message: "maxRetryAttempts deve ser um inteiro seguro não negativo",
      });
    }
  }

  if (
    mode === "autonomous" && execution.authorizedExecutors !== undefined &&
    isStringList(execution.authorizedExecutors) && authorizedExecutors.length === 0
  ) {
    errors.push({
      path: "execution.authorizedExecutors",
      message: "authorizedExecutors não pode estar vazio no modo autonomous",
    });
  }

  if (errors.length > 0) {
    return { policy: defaultPolicy(), errors };
  }

  return {
    policy: {
      mode,
      authorizedExecutors,
      dataSensitivityPolicy,
      ...(defaultDataSensitivity === undefined ? {} : { defaultDataSensitivity }),
      maxRetryAttempts,
    },
    errors,
  };
}
