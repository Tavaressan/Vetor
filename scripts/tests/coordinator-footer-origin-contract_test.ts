import { assertFalse, assertMatch, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const claudeCoordinator = await Deno.readTextFile(
  new URL("skills/coordinator/SKILL.md", root),
);
const opencodeCoordinator = await Deno.readTextFile(
  new URL("opencode/agent/issue-coordinator.md", root),
);

Deno.test("issue #453: skills/coordinator/SKILL.md §1 particiona por rodapé 🤖 Gerado por /vetor: no body com transição de ai-generated", () => {
  // Identificação da origem pelo rodapé no body
  assertStringIncludes(
    claudeCoordinator,
    "🤖 Gerado por /vetor:",
    "skills/coordinator/SKILL.md deve mencionar o prefixo de rodapé 🤖 Gerado por /vetor:",
  );
  assertMatch(
    claudeCoordinator,
    /origem\s+passa\s+a\s+ser\s+identificada\s+pelo\s+rodapé[\s\S]*?`🤖 Gerado por \/vetor:`/i,
    "skills/coordinator/SKILL.md deve descrever que a origem é identificada pelo rodapé",
  );

  // Partição do resultado usando body e labels
  assertMatch(
    claudeCoordinator,
    /particione\s+o\s+resultado\s+usando\s+o\s+`body`\s+e\s+os\s+`labels`/i,
    "skills/coordinator/SKILL.md deve instruir a particionar por body e labels já retornados",
  );

  // Recomendadas pelo agente: rodapé no body OU label ai-generated
  assertMatch(
    claudeCoordinator,
    /\*\*Recomendadas pelo agente\*\*: issues cujo `body` contenha o rodapé `🤖 Gerado por \/vetor:` OU que\s+contenham a label `ai-generated`/i,
    "skills/coordinator/SKILL.md deve incluir rodapé OU label ai-generated como recomendadas pelo agente",
  );

  // Regra de transição (leitura apenas, nunca aplica)
  assertMatch(
    claudeCoordinator,
    /regra de transição[\s\S]*?leitura apenas; o plugin nunca aplica a label/i,
    "skills/coordinator/SKILL.md deve documentar transição apenas para leitura da label ai-generated",
  );

  // Pedidas pelo usuário: sem rodapé e sem ai-generated
  assertMatch(
    claudeCoordinator,
    /\*\*Pedidas pelo usuário\*\* \(candidatas primárias\): issues sem o rodapé `🤖 Gerado por \/vetor:` no corpo\s+e sem a label `ai-generated`/i,
    "skills/coordinator/SKILL.md deve definir pedidas pelo usuário como sem rodapé e sem ai-generated",
  );
});

Deno.test("issue #453: opencode/agent/issue-coordinator.md tem paridade com coordinator do Claude na partição por rodapé", () => {
  // Identificação da origem pelo rodapé no body
  assertStringIncludes(
    opencodeCoordinator,
    "🤖 Gerado por /vetor:",
    "opencode/agent/issue-coordinator.md deve mencionar o rodapé 🤖 Gerado por /vetor:",
  );
  assertMatch(
    opencodeCoordinator,
    /origem\s+passa\s+a\s+ser\s+identificada\s+pelo\s+rodapé[\s\S]*?`🤖 Gerado por \/vetor:`/i,
    "opencode/agent/issue-coordinator.md deve descrever a detecção de origem pelo rodapé",
  );

  // Partição usando body e labels
  assertMatch(
    opencodeCoordinator,
    /particione\s+o\s+resultado\s+usando\s+o\s+`body`\s+e\s+os\s+`labels`/i,
    "opencode/agent/issue-coordinator.md deve instruir partição por body e labels",
  );

  // Recomendadas pelo agente
  assertMatch(
    opencodeCoordinator,
    /\*\*Recomendadas pelo agente\*\*: issues cujo `body` contenha o rodapé `🤖 Gerado por \/vetor:` OU que\s+contenham a label `ai-generated`/i,
    "opencode/agent/issue-coordinator.md deve classificar por rodapé OU label ai-generated",
  );

  // Transição (leitura apenas)
  assertMatch(
    opencodeCoordinator,
    /regra de transição[\s\S]*?leitura apenas; o plugin nunca aplica a label/i,
    "opencode/agent/issue-coordinator.md deve documentar a transição de leitura",
  );

  // Pedidas pelo usuário
  assertMatch(
    opencodeCoordinator,
    /\*\*Pedidas pelo usuário\*\* \(candidatas primárias\): issues sem o rodapé `🤖 Gerado por \/vetor:` no corpo\s+e sem a label `ai-generated`/i,
    "opencode/agent/issue-coordinator.md deve definir pedidas pelo usuário sem rodapé e sem label",
  );
});

Deno.test("issue #453: opencode/agent/issue-coordinator.md deixa de ter backlog como label default", () => {
  // Não tem mais (default: `backlog`) na Sintaxe
  assertFalse(
    opencodeCoordinator.includes("default: `backlog`"),
    "opencode/agent/issue-coordinator.md não deve conter 'default: `backlog`'",
  );
  assertFalse(
    opencodeCoordinator.includes("default: backlog"),
    "opencode/agent/issue-coordinator.md não deve conter 'default: backlog'",
  );

  // Documenta que [label] sem argumento usa todas as issues abertas ou defaultDispatchLabel
  assertMatch(
    opencodeCoordinator,
    /`\[label\]`: label das issues a despachar \(sem argumento: todas as issues abertas, ou usa `defaultDispatchLabel`/,
    "opencode/agent/issue-coordinator.md deve documentar [label] com regra de todas as abertas ou defaultDispatchLabel",
  );

  // Fase 0 resume não cai em issue-coordinator 'backlog'
  assertFalse(
    opencodeCoordinator.includes('issue-coordinator "backlog"'),
    'opencode/agent/issue-coordinator.md não deve ter fallback com issue-coordinator "backlog"',
  );
  assertMatch(
    opencodeCoordinator,
    /Se não houver nenhum worktree ativo com status file: caia no fluxo padrão a partir da Fase 1\s+\(todas as issues abertas, ou `defaultDispatchLabel`/,
    "opencode/agent/issue-coordinator.md Fase 0 deve cair no fluxo padrão sem backlog fixo",
  );

  // Fase 1 documenta verificação de defaultDispatchLabel e descoberta dinâmica
  assertMatch(
    opencodeCoordinator,
    /Verifique se `\.claude\/vetor\/config\.json` declara `defaultDispatchLabel`/,
    "opencode/agent/issue-coordinator.md deve documentar verificação de defaultDispatchLabel",
  );
  assertMatch(
    opencodeCoordinator,
    /Descoberta dinâmica \(sem argumento, sem defaultDispatchLabel\):/,
    "opencode/agent/issue-coordinator.md deve documentar descoberta dinâmica",
  );
});
