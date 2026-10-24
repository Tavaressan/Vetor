/**
 * Registro e resolução polimórfica de orquestradores (issue #482).
 *
 * Gerencia adaptadores de orquestradores (hoje só o Alethe), realiza a detecção estática
 * de disponibilidade e resolve a seleção pela preferência configurada: sem preferência o
 * orquestrador não é escolhido (issue #504).
 */

import type {
  OrchestratorAdapter,
  OrchestratorProbeContext,
  OrchestratorSelection,
} from "./types.ts";

export interface OrchestratorSelectionInput {
  /** Adaptadores de orquestradores detectados como disponíveis nesta sessão */
  available: OrchestratorAdapter[];
  /** Preferência configurada pelo usuário (`delegation.preferredRuntime`) */
  preferred?: string | null;
  /** Sessão interativa ou headless. Hoje não altera a seleção: sem preferência, o resultado é o mesmo. */
  interactive?: boolean;
}

export class OrchestratorRegistry {
  private adapters = new Map<string, OrchestratorAdapter>();

  /**
   * Registra um novo adaptador de orquestrador.
   */
  register(adapter: OrchestratorAdapter): this {
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  /**
   * Obtém um adaptador registrado pelo seu identificador.
   */
  get(id: string): OrchestratorAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * Lista todos os adaptadores cadastrados no registro.
   */
  list(): OrchestratorAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Filtra estaticamente os adaptadores que estão disponíveis na sessão atual,
   * checando o namespace MCP (zero subprocessos/rede).
   */
  detectAvailable(context: OrchestratorProbeContext): OrchestratorAdapter[] {
    return this.list().filter((adapter) => adapter.isAvailable(context));
  }

  /**
   * Algoritmo agnóstico de seleção de orquestrador, na mesma regra que `selectDelegationRuntime`
   * aplica ao runtime MCP (issue #504): o orquestrador só é escolhido pela preferência.
   *
   * 1. available vazio -> native (sem erro nem bloqueio).
   * 2. preferred configurado e disponível -> orchestrate para a preferência.
   * 3. preferred configurado mas indisponível -> native (nunca substitui silenciosamente por outro).
   * 4. sem preferred -> native, com 1 ou mais candidatos e em qualquer modo de sessão. Ninguém
   *    consentiu com o orquestrador, então ele nunca é escolhido em silêncio nem oferecido por
   *    `ask`; `interactive` não altera o resultado.
   */
  select(input: OrchestratorSelectionInput): OrchestratorSelection {
    const { available } = input;
    const preferred = input.preferred ?? null;

    if (available.length === 0) {
      return {
        action: "native",
        reason: "nenhum orquestrador externo disponível; fallback para subagentes nativos",
      };
    }

    if (preferred !== null) {
      const match = available.find((a) => a.id === preferred);
      if (match) {
        return {
          action: "orchestrate",
          adapter: match,
          reason: "preferência configurada e disponível",
        };
      }
      return {
        action: "native",
        reason: "preferência configurada indisponível; fallback nativo sem substituição silenciosa",
      };
    }

    return {
      action: "native",
      reason: "orquestrador disponível, mas sem preferência configurada; sem escolha silenciosa",
    };
  }
}
