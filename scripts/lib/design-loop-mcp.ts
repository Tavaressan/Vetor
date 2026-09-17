// Degradação graciosa do Frontend Self-Correction Loop (#230) quando não há MCP de browser
// disponível na sessão. Mecanismo de detecção reaproveita skills/shared/references/mcp-availability.md
// (procurar `mcp__<server>__` na lista de ferramentas do agente) — este módulo só formaliza o
// relato de cada etapa do loop (skills/design/SKILL.md) para nunca pular uma etapa em silêncio
// nem fingir que a inspeção visual/a11y ocorreu sem MCP.

const BROWSER_MCP_SERVERS = ["chrome-devtools", "playwright"] as const;

/** Etapas do loop que dependem de MCP de browser para execução/observação real. */
export const LOOP_STEP_IDS = [
  "inspect",
  "screenshot",
  "accessibility_snapshot",
  "responsive_check",
] as const;

export type LoopStepId = typeof LOOP_STEP_IDS[number];

export type StepVerdict = "verified" | "unverified";

export interface StepReport {
  step: LoopStepId;
  verdict: StepVerdict;
  /** Mensagem explícita e legível por humano quando `verdict` é "unverified"; `null` caso contrário. */
  limitation: string | null;
}

const STEP_LABELS: Record<LoopStepId, string> = {
  inspect: "navegação/interação ao vivo (inspect)",
  screenshot: "captura de screenshot",
  accessibility_snapshot: "accessibility snapshot",
  responsive_check: "checagem de viewports responsivos",
};

/**
 * Procura, na lista de nomes de ferramentas disponíveis do agente, um nome com prefixo
 * `mcp__<server>__` para algum servidor de browser conhecido. Retorna o nome do servidor
 * (ex.: "chrome-devtools") ou `null` se nenhum estiver disponível.
 */
export function detectBrowserMcpServer(toolNames: string[]): string | null {
  for (const server of BROWSER_MCP_SERVERS) {
    const prefix = `mcp__${server}__`;
    if (toolNames.some((name) => name.startsWith(prefix))) return server;
  }
  return null;
}

/**
 * Relata o resultado de uma etapa do loop que depende de MCP de browser. Nunca lança: sem MCP
 * disponível, retorna `verdict: "unverified"` com uma limitação explícita nomeando a etapa pulada
 * — nunca `"verified"`/`"pass"` (que confundiria com inspeção real) nem omissão silenciosa.
 */
export function reportLoopStep(step: LoopStepId, toolNames: string[]): StepReport {
  const server = detectBrowserMcpServer(toolNames);
  if (server) {
    return { step, verdict: "verified", limitation: null };
  }
  return {
    step,
    verdict: "unverified",
    limitation:
      `MCP de browser indisponível nesta sessão — ${STEP_LABELS[step]} não foi executada. ` +
      "Diagnóstico/fix seguem baseados em código, logs e testes existentes; confirmação visual " +
      "e de acessibilidade ao vivo fica para validação manual pós-merge.",
  };
}
