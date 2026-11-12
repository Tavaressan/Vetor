import { type CapabilityName, type HarnessDescriptor, type HarnessObservation } from "./types.ts";

const CORE_CAPABILITIES: readonly CapabilityName[] = [
  "terminal",
  "filesystem",
  "git",
];

/**
 * Probe injetada para descoberta passiva. A resolução de executável deve ser
 * feita por busca no PATH, sem spawn.
 */
export interface Probe {
  resolveExecutable(name: string): string | undefined;
}

/**
 * Sonda opcional de versão/`--help`. Só pode ser usada quando explicitamente
 * solicitada; pode ter efeitos colaterais (ex.: shim do mise), por isso marca
 * `sideEffects: "possible"` e nunca roda na descoberta passiva.
 */
export interface VersionProbe {
  /** Retorna a versão observada, se conhecida. */
  probeVersion(command: string): string | undefined;
}

export interface DiscoverOptions {
  /** Horário da observação; padrão: `new Date().toISOString()`. Injetável para testes. */
  now?: () => string;
  /**
   * Flag explícita para habilitar a sonda de versão/`--help`. Quando fornecida,
   * a observação resultante marca `sideEffects: "possible"`. Nunca usada na
   * descoberta passiva se omitida.
   */
  versionProbe?: VersionProbe;
}

/**
 * Descoberta passiva: resolve o executável no PATH (sem spawn) e produz uma
 * `HarnessObservation`. Se o executável está instalado e o perfil declara uma
 * capacidade do núcleo (`terminal`, `filesystem`, `git`) como `supported`, ela
 * é promovida a `verified` com origem "núcleo + executável resolvido".
 */
export function discover(
  descriptor: HarnessDescriptor,
  probe: Probe,
  options: DiscoverOptions = {},
): HarnessObservation {
  const now = options.now?.() ?? new Date().toISOString();
  const capabilities: HarnessObservation["capabilities"] = {};

  let installed: boolean | undefined;
  if (descriptor.kind === "cli" && descriptor.command) {
    installed = probe.resolveExecutable(descriptor.command) !== undefined;
  }

  if (installed === true) {
    for (const capability of CORE_CAPABILITIES) {
      const claim = descriptor.declared[capability];
      if (claim?.state === "supported") {
        capabilities[capability] = {
          state: "supported",
          level: "verified",
          source: "núcleo + executável resolvido",
        };
      }
    }
  }

  let version: string | undefined;
  let sideEffects: HarnessObservation["sideEffects"] = "none";
  if (options.versionProbe) {
    sideEffects = "possible";
    if (descriptor.kind === "cli" && descriptor.command && installed === true) {
      version = options.versionProbe.probeVersion(descriptor.command);
    }
  }

  return {
    executorId: descriptor.id,
    observedAt: now,
    ...(version !== undefined ? { version } : {}),
    ...(installed !== undefined ? { installed } : {}),
    capabilities,
    sideEffects,
  };
}
