/**
 * Registro e resolução polimórfica de orquestradores (issue #482).
 *
 * Gerencia adaptadores de orquestradores (hoje só o Alethe), realiza a detecção estática
 * de disponibilidade e resolve a seleção de acordo com as preferências configuradas e o
 * modo de execução (interativo vs headless).
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
  /** Se a sessão é interativa (há usuário para responder) ou headless/automática */
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
   * Algoritmo agnóstico de seleção de orquestrador (paridade conceitual com issue #247):
   *
   * 1. available vazio -> native (sem erro nem bloqueio).
   * 2. preferred configurado e disponível -> orchestrate para a preferência.
   * 3. preferred configurado mas indisponível -> native (nunca substitui silenciosamente por outro).
   * 4. sem preferred e exatamente 1 candidato -> orchestrate direto (sem ambiguidade).
   * 5. sem preferred e 2+ candidatos:
   *    - em sessão interativa -> ask (pergunta ao usuário).
   *    - em sessão headless -> native (fallback determinístico sem supor preferências).
   */
  select(input: OrchestratorSelectionInput): OrchestratorSelection {
    const { available, interactive = false } = input;
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

    if (available.length === 1) {
      return {
        action: "orchestrate",
        adapter: available[0],
        reason: "único orquestrador disponível",
      };
    }

    if (interactive) {
      return {
        action: "ask",
        reason: "múltiplos orquestradores disponíveis sem preferência configurada",
      };
    }

    return {
      action: "native",
      reason: "múltiplos orquestradores sem preferência em sessão headless; sem anuência possível",
    };
  }
}
