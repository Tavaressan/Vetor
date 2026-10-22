import { assertMatch, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const coordinatorSkill = await Deno.readTextFile(
  new URL("skills/coordinator/SKILL.md", root),
);
const issueWorker = await Deno.readTextFile(
  new URL("agents/issue-worker.md", root),
);
const dispatchRef = await Deno.readTextFile(
  new URL("skills/shared/references/issue-coordinator-dispatch.md", root),
);

Deno.test("issue #458: skills/coordinator/SKILL.md documenta detecção de issues spike e dispensa do gate de Spec", () => {
  // Seção dedicada a detecção de spike
  assertMatch(
    coordinatorSkill,
    /####\s+Detecção de issues spike \(modo investigação\)/i,
    "SKILL.md deve conter subseção dedicada à detecção de issues spike",
  );

  // Detecção por label spike ou equivalentes do repo
  assertMatch(
    coordinatorSkill,
    /label `spike`[\s\S]*?`investigation`[\s\S]*?`research`[\s\S]*?`exploration`/i,
    "SKILL.md deve documentar detecção de spike por label spike ou equivalentes",
  );

  // Detecção por título/prefixo
  assertMatch(
    coordinatorSkill,
    /título iniciar por convenções como `spike:`, `spike\(\.\.\.\)`, `investigação:`, `research:`/i,
    "SKILL.md deve documentar detecção por convenções de prefixo de título",
  );

  // Isenção do gate de Spec
  assertMatch(
    coordinatorSkill,
    /isentas do gate de Spec(?:\*\*)?\s*\(dispensam Spec\)/i,
    "SKILL.md deve documentar que issues spike dispensam Spec",
  );

  // Ação na tabela do plano
  assertStringIncludes(
    coordinatorSkill,
    "Despachar (Spike — modo investigação)",
    "SKILL.md deve conter ação específica no plano para spike",
  );
});

Deno.test("issue #458: skills/coordinator/SKILL.md documenta despacho em modo investigação com worktree docs e prompt específico", () => {
  // Provisionamento com worktree tipo docs
  assertMatch(
    coordinatorSkill,
    /tipo `docs` para a branch e worktree \(`docs\/<issue#>-<slug>`\)/i,
    "SKILL.md deve documentar provisionamento de worktree tipo docs para spike",
  );

  // Prompt específico para modo investigação
  assertMatch(
    coordinatorSkill,
    /despache o worker com prompt específico de investigação/i,
    "SKILL.md deve instruir despacho com prompt específico de investigação",
  );

  // Dispensa de TDD e testes de produto
  assertMatch(
    coordinatorSkill,
    /não roda TDD nem loop de testes de produto/i,
    "SKILL.md deve orientar que o worker não roda TDD nem testes de produto em spike",
  );

  // Entregável em docs/investigations/<slug>.md
  assertStringIncludes(
    coordinatorSkill,
    "docs/investigations/<slug>.md",
    "SKILL.md deve documentar o entregável em docs/investigations/<slug>.md",
  );

  // Formato mínimo do relatório
  assertMatch(
    coordinatorSkill,
    /1\.\s+Pergunta[\s\S]*?2\.\s+Evidências[\s\S]*?3\.\s+Opções avaliadas[\s\S]*?4\.\s+Recomendação/i,
    "SKILL.md deve listar as 4 seções mínimas do relatório de investigação",
  );

  // Critério de GREEN
  assertMatch(
    coordinatorSkill,
    /`docs\/investigations\/<slug>\.md` existir[\s\S]*?`git diff --check` passar/i,
    "SKILL.md deve definir critério de GREEN para spike",
  );

  // Ship de docs (#427) e decisão humana sem issues automáticas
  assertStringIncludes(
    coordinatorSkill,
    "PR só de docs (#427)",
    "SKILL.md deve apontar caminho de PR só de docs",
  );
  assertMatch(
    coordinatorSkill,
    /decisão.*continua humana[\s\S]*?nunca criam issues de follow-up automaticamente/i,
    "SKILL.md deve documentar que a decisão é humana e issues de follow-up não são criadas automaticamente",
  );
});

Deno.test("issue #458: agents/issue-worker.md documenta modo investigação com dispensa de TDD", () => {
  // Subseção de modo investigação no worker
  assertMatch(
    issueWorker,
    /###\s+Modo Investigação \(`spike`\)/i,
    "agents/issue-worker.md deve ter seção para modo investigação",
  );

  // Dispensa de TDD e testes de produto
  assertMatch(
    issueWorker,
    /Dispensa de TDD e testes de produto/i,
    "agents/issue-worker.md deve documentar dispensa de TDD",
  );
  assertMatch(
    issueWorker,
    /não roda TDD nem loop de testes de produto/i,
    "agents/issue-worker.md deve instruir que o worker não roda TDD nem fix em spike",
  );
});

Deno.test("issue #458: agents/issue-worker.md documenta formato do relatório, critério de GREEN e não-escopo", () => {
  // Entregável em docs/investigations/<slug>.md
  assertStringIncludes(
    issueWorker,
    "docs/investigations/<slug>.md",
    "agents/issue-worker.md deve especificar docs/investigations/<slug>.md",
  );

  // Formato mínimo do relatório: Pergunta, Evidências, Opções avaliadas, Recomendação
  assertMatch(
    issueWorker,
    /\*\*Pergunta\*\*:[\s\S]*?\*\*Evidências\*\*:[\s\S]*?\*\*Opções avaliadas\*\*:[\s\S]*?\*\*Recomendação\*\*:/i,
    "agents/issue-worker.md deve documentar as 4 seções mínimas do relatório",
  );

  // Critério de GREEN no issue-worker
  assertMatch(
    issueWorker,
    /Critério de `GREEN`[\s\S]*?`docs\/investigations\/<slug>\.md` existe[\s\S]*?`git diff --check` passa/i,
    "agents/issue-worker.md deve documentar critério de GREEN em investigação",
  );

  // Decisão humana e não criar issues de follow-up
  assertMatch(
    issueWorker,
    /não criam issues de follow-up automaticamente/i,
    "agents/issue-worker.md deve proibir criação automática de issues de follow-up",
  );
  assertMatch(
    issueWorker,
    /PR só de docs \(#427\)/i,
    "agents/issue-worker.md deve referenciar o caminho de PR só de docs (#427)",
  );
});

Deno.test("issue #458: skills/shared/references/issue-coordinator-dispatch.md alinhado com modo investigação", () => {
  assertStringIncludes(
    dispatchRef,
    "Para issues spike, use o tipo `docs` (`docs/<issue#>-<slug>`)",
    "issue-coordinator-dispatch.md deve instruir uso de tipo docs para spike",
  );
  assertMatch(
    dispatchRef,
    /Modo investigação para issues spike[\s\S]*?docs\/investigations\/<slug>\.md[\s\S]*?git diff --check/i,
    "issue-coordinator-dispatch.md deve alinhar o prompt e critério de GREEN para spike",
  );
});
