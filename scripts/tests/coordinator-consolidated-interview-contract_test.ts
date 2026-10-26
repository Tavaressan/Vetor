import { assert, assertFalse, assertMatch, assertStringIncludes } from "@std/assert";

// Issue #499 (RF-02 de docs/specs/autonomia-continua-e-desacoplamento-interativo.md): contrato
// estrutural da entrevista consolidada de setup na largada. Mede o texto da skill, não o
// comportamento do agente: "exatamente 1 turno" só é verificável em execução real.

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));

const coordinatorSkill = await read("skills/coordinator/SKILL.md");
const delegateReference = await read("skills/shared/references/delegate-to-runtime.md");
const opencodeCoordinator = await read("opencode/agent/issue-coordinator.md");

const slice = (text: string, from: string, to: string) =>
  text.slice(text.indexOf(from), text.indexOf(to));

const phase0 = slice(coordinatorSkill, "### 0 — ", "### 1 — ");
const phase1 = slice(coordinatorSkill, "### 1 — ", "### 2 — ");
const phase2 = slice(coordinatorSkill, "### 2 — ", "### 3 — ");
const interview = slice(
  phase2,
  "#### Entrevista consolidada de setup",
  "#### Obtenção de aprovação",
);

Deno.test("issue #499: a Fase 2 tem a seção da entrevista consolidada, em turno único", () => {
  assert(interview.length > 0, "seção 'Entrevista consolidada de setup' ausente na Fase 2");
  assertMatch(interview, /exatamente 1 turno/);
  assertMatch(interview, /um único `AskUserQuestion`/);
});

Deno.test("issue #499: a entrevista consolida teto, Specs, entrega e aprovação, todos com (Recommended)", () => {
  const items = [
    "Teto de workers",
    "Sinalização de Specs",
    "Estratégia de entrega",
    "Aprovação do plano",
  ];
  let cursor = -1;
  for (const item of items) {
    const at = interview.indexOf(item);
    assert(at > cursor, `item "${item}" ausente ou fora de ordem na entrevista consolidada`);
    cursor = at;
  }
  const recommended = interview.match(/\(Recommended\)/g) ?? [];
  assert(recommended.length >= items.length, "cada item precisa de uma opção (Recommended)");
  // a estratégia de entrega padrão é o comportamento atual da Fase 6
  assertMatch(interview, /Pre-Ship paralelo \+ merge serializado[^\n]*\(Recommended\)/);
});

Deno.test("issue #499: a pergunta por issue e a pergunta solta do teto deixaram de existir", () => {
  assertFalse(
    phase2.includes("Issue #<N> parece não-trivial"),
    "a pergunta por issue do gate de Spec voltou",
  );
  assertFalse(
    phase2.includes("3. Confirmar rapidamente 2-3 pontos agora"),
    "a opção 3 exigia um segundo turno de texto livre",
  );
  assertFalse(
    phase2.includes("uma única vez por sessão"),
    "o teto de workers não pode ter uma pergunta própria",
  );
  // pontos de escopo vão no campo livre da mesma resposta, sem turno extra
  assertMatch(interview, /campo livre \(`Other`\) da mesma resposta/);
});

Deno.test("issue #499: no plan mode e nos outros ecossistemas o pacote cabe em uma única aprovação", () => {
  assertMatch(interview, /plan mode[\s\S]{0,400}`ExitPlanMode`/);
  assertMatch(interview, /`implementation_plan\.md`/);
  assertMatch(interview, /responda `sim`/);
});

Deno.test("issue #499: o runtime de delegação do agrupamento não gera pergunta própria", () => {
  assertMatch(phase1, /sem pergunta própria/);
  assertMatch(
    delegateReference,
    /no `coordinator`, a escolha de runtime não gera pergunta própria/,
  );
});

Deno.test("issue #499: --headless adota o (Recommended) de cada item da entrevista", () => {
  const headless = slice(coordinatorSkill, "## Modo headless", "## Comportamento");
  assertMatch(headless, /\| 2 — entrevista consolidada \|/);
  assertMatch(interview, /Em `--headless`[^\n]*não há entrevista/);
});

Deno.test("issue #499: a retomada (--resume) também pergunta tudo em uma chamada", () => {
  assertMatch(phase0, /uma única chamada de `AskUserQuestion`/);
});

Deno.test("issue #499: o espelho OpenCode registra a entrevista como uma mensagem de texto", () => {
  assertStringIncludes(opencodeCoordinator, "entrevista consolidada");
  assert(
    opencodeCoordinator.split(/\r?\n/).length < 150,
    "o agent fino do OpenCode deve ficar abaixo de 150 linhas",
  );
});
