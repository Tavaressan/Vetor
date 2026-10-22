import { assert, assertFalse, assertMatch, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const claudeCoordinator = await Deno.readTextFile(
  new URL("skills/coordinator/SKILL.md", root),
);
const opencodeCoordinator = await Deno.readTextFile(
  new URL("opencode/agent/issue-coordinator.md", root),
);
const backlogSkill = await Deno.readTextFile(
  new URL("skills/backlog/SKILL.md", root),
);
const retroSkill = await Deno.readTextFile(
  new URL("skills/retro/SKILL.md", root),
);
const guardianSkill = await Deno.readTextFile(
  new URL("skills/guardian/SKILL.md", root),
);

const footerLinePattern = /^🤖 Gerado por `?\/vetor:/;
const documentedReference = "``^🤖 Gerado por `?/vetor:``";
const checklistMention = "- [ ] O rodapé `🤖 Gerado por /vetor:retro` permanece obrigatório.";

Deno.test("issue #453: linhas de rodapé geradas começam com o prefixo rastreável", () => {
  for (
    const [path, skill] of [
      ["skills/backlog/SKILL.md", backlogSkill],
      ["skills/retro/SKILL.md", retroSkill],
      ["skills/guardian/SKILL.md", guardianSkill],
    ]
  ) {
    const lines = skill.split(/\r?\n/).filter((line) => line.startsWith("🤖 Gerado por"));
    assert(lines.length > 0, `${path} deve ter ao menos uma linha de rodapé`);
    for (const line of lines) {
      assertMatch(line, footerLinePattern, `${path}: linha não corresponde ao prefixo do rodapé`);
    }
  }
  assertFalse(footerLinePattern.test(checklistMention));
});

Deno.test("issue #453: skills/coordinator/SKILL.md §1 particiona por rodapé 🤖 Gerado por /vetor: no body com transição de ai-generated", () => {
  // Identificação da origem pelo rodapé no body
  assertStringIncludes(
    claudeCoordinator,
    documentedReference,
    "skills/coordinator/SKILL.md deve documentar a regex de referência",
  );
  assertMatch(
    claudeCoordinator,
    /origem\s+passa\s+a\s+ser\s+identificada\s+por\s+uma\s+linha[\s\S]*?Menções ao rodapé no meio de uma frase ou de um item de checklist\s+não contam/i,
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
    /\*\*Recomendadas pelo agente\*\*: issues cujo `body` tenha uma linha que comece com `🤖 Gerado por` seguida\s+de `\/vetor:<skill>`[\s\S]*?OU que\s+contenham a label `ai-generated`/i,
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
    /\*\*Pedidas pelo usuário\*\* \(candidatas primárias\): issues sem uma linha do corpo que comece com\s+`🤖 Gerado por` seguida de `\/vetor:<skill>` e sem a label `ai-generated`/i,
    "skills/coordinator/SKILL.md deve definir pedidas pelo usuário como sem rodapé e sem ai-generated",
  );
});

Deno.test("issue #453: opencode/agent/issue-coordinator.md tem paridade com coordinator do Claude na partição por rodapé", () => {
  // Identificação da origem pelo rodapé no body
  assertStringIncludes(
    opencodeCoordinator,
    documentedReference,
    "opencode/agent/issue-coordinator.md deve documentar a regex de referência",
  );
  assertMatch(
    opencodeCoordinator,
    /origem\s+passa\s+a\s+ser\s+identificada\s+por\s+uma\s+linha[\s\S]*?Menções ao rodapé no meio de uma frase ou de um item de checklist\s+não contam/i,
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
    /\*\*Recomendadas pelo agente\*\*: issues cujo `body` tenha uma linha que comece com `🤖 Gerado por` seguida\s+de `\/vetor:<skill>`[\s\S]*?OU que\s+contenham a label `ai-generated`/i,
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
    /\*\*Pedidas pelo usuário\*\* \(candidatas primárias\): issues sem uma linha do corpo que comece com\s+`🤖 Gerado por` seguida de `\/vetor:<skill>` e sem a label `ai-generated`/i,
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
