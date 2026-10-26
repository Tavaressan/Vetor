import { assert, assertFalse, assertMatch, assertStringIncludes } from "@std/assert";

// Issue #498 (RF-01 de docs/specs/autonomia-continua-e-desacoplamento-interativo.md): contrato
// estrutural do modo de meta contínua. Mede o texto da skill: a convergência em si só é
// verificável rodando o coordinator contra um backlog real.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

const coordinatorSkill = await read("skills/coordinator/SKILL.md");
const report = await read("skills/shared/references/issue-coordinator-report.md");
const installSkill = await read("skills/install/SKILL.md");
const gitignore = await read(".gitignore");
const wiki = await read("wiki/Decisoes-de-Design.md");
const opencodeCoordinator = await read("opencode/agent/issue-coordinator.md");

const slice = (text: string, from: string, to: string) =>
  text.slice(text.indexOf(from), text.indexOf(to));

const syntax = slice(coordinatorSkill, "## Sintaxe", "## Referências");
const goal = slice(coordinatorSkill, "## Modo goal", "## Comportamento");
const goalReport = report.slice(report.indexOf("## Goal Convergence Report"));

Deno.test("issue #498: a sintaxe aceita --goal com a meta entre aspas, junto de label, lista e retomada", () => {
  assertStringIncludes(syntax, '/vetor:coordinator [label] --goal "<meta>"');
  assertMatch(syntax, /- `--goal "<meta>"`:/);
  assertMatch(syntax, /Sem `\[label\]`[\s\S]{0,200}Fase 0/);
  // o valor é obrigatório
  assertMatch(syntax, /sem valor[^\n]*(não inicia|aborte)/i);
});

Deno.test("issue #498: a relação com --headless e --auto-ship é explícita, numa tabela", () => {
  assert(goal.length > 0, "seção '## Modo goal' ausente");
  for (const row of ["`--headless`", "`--goal`", "`--goal --auto-ship`"]) {
    assertStringIncludes(goal, `| ${row} |`);
  }
  assertMatch(goal, /`--goal` aplica a coluna \*\*Headless\*\*/);
  // o opt-in do --auto-ship continua valendo, e só ele
  assertMatch(syntax, /- `--auto-ship`: só tem efeito com `--headless` ou `--goal`/);
});

Deno.test("issue #498: --goal sozinho nunca entrega nem faz merge; a entrega exige opt-in e os 4 gates", () => {
  assertMatch(goal, /`--goal` sozinho nunca/);
  assertMatch(goal, /quatro gates da Fase 6\.d/);
  assertMatch(goal, /PRs preparados[\s\S]{0,200}vazi/i);
  // o merge autônomo não é habilitado implicitamente
  assertFalse(/--goal[^\n]*implica[^\n]*--auto-ship/i.test(goal));
  assertMatch(goal, /não habilita[\s\S]{0,80}merge/i);
});

Deno.test("issue #498: nenhuma AskUserQuestion e decisões determinísticas pelo (Recommended)", () => {
  assertMatch(goal, /Nenhuma `AskUserQuestion` nem `ExitPlanMode`/);
  for (const decision of ["triagem", "Teto de workers", "Modelos", "Specs", "Bloqueio"]) {
    assertMatch(goal, new RegExp(`\\| ${decision}`, "i"));
  }
  assertMatch(goal, /`\(Recommended\)`/);
  // bloqueio de worker: suspende e, sem humano, ejeta; sem avanço otimista e sem auto-aprovar permissão
  assertMatch(goal, /`SUSPENDED`[\s\S]{0,200}ejeção/);
  assertMatch(goal, /nenhuma permissão é auto-aprovada/i);
});

Deno.test("issue #498: a execução converge até resolver ou ejetar tudo, com teto de sessão de 120 minutos", () => {
  assertMatch(goal, /resolvid[ao]s? ou ejetad[ao]s?/);
  assertMatch(goal, /min\(`maxSessionMinutes`[^\n]*120\)/);
  assertMatch(goal, /120 minutos/);
  // sem o opt-in de entrega, ondas posteriores não saem de QUEUED: a meta não converge e o relatório diz
  assertMatch(goal, /`O_2`[\s\S]{0,200}`QUEUED`/);
  assertMatch(goal, /circuit breaker[\s\S]{0,200}não converg/i);
});

Deno.test("issue #498: a meta é texto literal, nunca interpolada em shell", () => {
  assertMatch(goal, /texto literal/);
  assertMatch(goal, /nunca[^\n]*(comando de shell|`echo`)/i);
  assertStringIncludes(goal, "ferramenta de escrita");
  assertStringIncludes(goal, ".claude/vetor/goal-audit.json");
  // a meta é descritiva: não filtra issues
  assertMatch(goal, /não filtra/);
});

Deno.test("issue #498: o Goal Convergence Report consolida sucessos, PRs preparados e ejetadas", () => {
  assert(
    goalReport.length > 0,
    "seção '## Goal Convergence Report' ausente em issue-coordinator-report.md",
  );
  for (
    const section of [
      "Concluídas",
      "PRs preparados",
      "Ejetadas",
      "Não convergiram",
      "Decisões autônomas",
    ]
  ) {
    assertStringIncludes(goalReport, `### ${section}`);
  }
  assertMatch(goalReport, /CONVERGIU/);
  assertMatch(goalReport, /PARCIAL/);
  assertMatch(goalReport, /nenhum — entrega desabilitada/);
  // RNF-03: cada decisão autônoma com a opção adotada e a referência (commit ou checkpoint)
  assertMatch(goalReport, /checkpoint/);
  // a Fase 7 manda emitir o relatório
  assertStringIncludes(coordinatorSkill, "## Goal Convergence Report");
});

Deno.test("issue #498: o modo goal não relaxa a restrição de nenhum hook nem a de labels", () => {
  assertMatch(goal, /`safety-check\.ts`/);
  assertMatch(goal, /nunca cria labels|nunca executa `gh label create`/);
});

Deno.test("issue #498: as restrições da skill cobrem --goal junto de --headless", () => {
  const restrictions = coordinatorSkill.slice(coordinatorSkill.indexOf("## Restrições"));
  assertMatch(restrictions, /Em `--headless` ou `--goal`: nunca chama `AskUserQuestion`/);
});

Deno.test("issue #498: o registro de decisões não é versionado (repo e passo de instalação)", () => {
  assertMatch(gitignore, /^\.claude\/vetor\/goal-audit\.json$/m);
  assertStringIncludes(installSkill, ".claude/vetor/goal-audit.json");
});

Deno.test("issue #498: a decisão de design está registrada e o espelho OpenCode diz que --goal não se aplica", () => {
  assertStringIncludes(wiki, "Modo de meta contínua `--goal` (issue #498)");
  assertMatch(opencodeCoordinator, /`--goal`[\s\S]{0,300}não se aplicam/);
  assert(opencodeCoordinator.split(/\r?\n/).length < 150);
});
