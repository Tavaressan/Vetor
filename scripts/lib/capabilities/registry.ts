import { resolveEffective } from "./evidence.ts";
import type {
  CapabilityName,
  EvidenceLevel,
  HarnessDescriptor,
  HarnessObservation,
} from "./types.ts";
import { validateDescriptor, type ValidationError } from "./validate.ts";

export interface CapabilityQuery {
  capability: CapabilityName;
  minLevel: EvidenceLevel;
}

const LEVEL_ORDER: Record<EvidenceLevel, number> = {
  declared: 0,
  verified: 1,
  operational: 2,
};

function byId(a: HarnessDescriptor, b: HarnessDescriptor): number {
  return a.id.localeCompare(b.id);
}

function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map((e) => `${e.path}: ${e.message}`).join("; ");
}

/**
 * Registry em memória de descritores de harness (ADR-002, Fase 1).
 * Determinístico: todas as leituras retornam descritores em ordem alfabética de `id`.
 * Sem I/O; observações são recebidas por parâmetro.
 */
export class CapabilityRegistry {
  private readonly descriptors = new Map<string, HarnessDescriptor>();

  /**
   * Registra um descritor. Rejeita descritor inválido (via validateDescriptor)
   * e duplicata (id já registrado).
   */
  register(descriptor: HarnessDescriptor): this {
    const errors = validateDescriptor(descriptor, {
      existingIds: this.descriptors.keys(),
    });
    if (errors.length > 0) {
      throw new Error(
        `Descritor inválido${descriptor.id ? ` (${descriptor.id})` : ""}: ${
          formatValidationErrors(errors)
        }`,
      );
    }
    this.descriptors.set(descriptor.id, descriptor);
    return this;
  }

  /** Retorna o descritor pelo id, ou undefined se desconhecido. */
  get(id: string): HarnessDescriptor | undefined {
    return this.descriptors.get(id);
  }

  /** Lista todos os descritores registrados, em ordem alfabética de `id`. */
  list(): HarnessDescriptor[] {
    return Array.from(this.descriptors.values()).sort(byId);
  }

  /**
   * Consulta descritores que suportam a capacidade com nível de evidência
   * efetivo >= `minLevel`, dadas as observações. Descritores desconhecidos
   * ou que não atendem ao critério não são selecionáveis/retornados.
   * Resultado em ordem alfabética de `id`.
   */
  query(
    { capability, minLevel }: CapabilityQuery,
    observations: readonly HarnessObservation[] = [],
  ): HarnessDescriptor[] {
    const min = LEVEL_ORDER[minLevel];
    return this.list().filter((descriptor) => {
      const effective = resolveEffective(descriptor, observations);
      const cap = effective[capability];
      return cap.state === "supported" && LEVEL_ORDER[cap.level] >= min;
    });
  }
}
