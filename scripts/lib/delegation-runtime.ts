// Seleção agnóstica de runtime de delegação (issue #247).
//
// Generaliza a delegação de tarefas de alto consumo de tokens, antes acoplada só ao `agy`
// (Google Antigravity/Gemini CLI), para qualquer CLI candidato (Gemini/agy, OpenCode, Codex, ...).
//
// Função pura: recebe a lista de candidatos já detectados no PATH (detecção estática, sem
// tentar-e-capturar erro — mesmo princípio de `mcp-availability.md`) e decide a ação sem tocar
// em disco/rede. Quem chama é responsável por rodar `command -v <bin>` para cada candidato e por
// ler a preferência configurada em `.claude/vetor/config.json` (`delegation.preferredRuntime`).

export type DelegationAction = "inline" | "delegate" | "ask";

export interface DelegationSelectionInput {
  /** Runtimes candidatos encontrados no PATH nesta sessão (ex.: ["agy", "opencode"]). */
  available: string[];
  /** Preferência configurada pelo usuário (`delegation.preferredRuntime`), se houver. */
  preferred?: string | null;
  /** Sessão interativa (há interlocutor capaz de responder a uma pergunta) ou headless. */
  interactive: boolean;
}

export interface DelegationSelection {
  action: DelegationAction;
  /** Só presente quando `action === "delegate"`. */
  runtime?: string;
  reason: string;
}

export function selectDelegationRuntime(input: DelegationSelectionInput): DelegationSelection {
  const { available, interactive } = input;
  const preferred = input.preferred ?? null;

  if (available.length === 0) {
    return { action: "inline", reason: "nenhum runtime de delegação disponível no PATH" };
  }

  if (preferred !== null) {
    if (available.includes(preferred)) {
      return {
        action: "delegate",
        runtime: preferred,
        reason: "preferência configurada e disponível",
      };
    }
    // Preferência explícita não disponível: nunca substitui silenciosamente por outro
    // candidato — o usuário consentiu com um runtime específico, não com "qualquer um".
    return {
      action: "inline",
      reason: "preferência configurada indisponível; sem substituição silenciosa por outro runtime",
    };
  }

  if (available.length === 1) {
    // Único candidato: não há ambiguidade entre runtimes para resolver, então não é
    // necessário anuência explícita (issue #247: anuência é exigida apenas "quando houver
    // mais de um runtime viável e nenhuma preferência registrada").
    return { action: "delegate", runtime: available[0], reason: "único candidato disponível" };
  }

  // available.length >= 2 e nenhuma preferência configurada: ambíguo.
  if (interactive) {
    return { action: "ask", reason: "múltiplos candidatos sem preferência configurada" };
  }

  // Sessão headless (fix-loop-agent, issue-worker, ...): não há como obter anuência.
  // Critério de desempate documentado: nunca escolher silenciosamente entre candidatos não
  // consentidos — segue inline.
  return {
    action: "inline",
    reason: "múltiplos candidatos sem preferência em sessão headless; sem anuência possível",
  };
}
