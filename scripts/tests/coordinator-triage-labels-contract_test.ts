import { assertFalse, assertMatch, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const coordinatorSkill = await Deno.readTextFile(
  new URL("skills/coordinator/SKILL.md", root),
);

Deno.test("issue #457: skills/coordinator/SKILL.md documenta tabela de mapeamento de labels de triagem", () => {
  // Consulta de labels existentes no repositório
  assertStringIncludes(
    coordinatorSkill,
    "gh label list --limit 100 --json name",
    "SKILL.md deve instruir a listar labels existentes com gh label list",
  );

  // Cabeçalho da tabela de mapeamento
  assertMatch(
    coordinatorSkill,
    /\|\s*Motivo\s*\|\s*Label Preferido\s*\|\s*Fallback 1\s*\|\s*Fallback 2\s*\|\s*Se nenhum existir\s*\|/,
    "SKILL.md deve conter tabela no estilo de mapeamento do /vetor:backlog §6.a",
  );

  // Mapeamento para SKIPPED (aguardando Spec)
  assertMatch(
    coordinatorSkill,
    /`SKIPPED \(aguardando Spec\)`\s*\|\s*`needs-spec`\s*\|\s*`spec-needed`\s*\|\s*`triage\/needs-information`\s*\|\s*Não aplica/,
    "SKILL.md deve mapear aguardando Spec para needs-spec -> spec-needed -> triage/needs-information",
  );

  // Mapeamento para SKIPPED (aguardando insumo do usuário) / bloqueada
  assertMatch(
    coordinatorSkill,
    /`SKIPPED \(aguardando insumo do usuário\)` \/ bloqueada\s*\|\s*`blocked`\s*\|\s*`status\/blocked`\s*\|\s*—\s*\|\s*Não aplica/,
    "SKILL.md deve mapear aguardando insumo / bloqueada para blocked -> status/blocked",
  );

  // Regra do primeiro existente
  assertStringIncludes(
    coordinatorSkill,
    "primeiro da linha que existir",
    "SKILL.md deve orientar a usar o primeiro label da linha que existir",
  );
});

Deno.test("issue #457: skills/coordinator/SKILL.md proíbe criação de labels (nunca gh label create)", () => {
  // Proibição explícita de gh label create
  assertMatch(
    coordinatorSkill,
    /nunca\s+executa\s+`gh label create`/i,
    "SKILL.md deve explicitar que o coordinator nunca executa 'gh label create'",
  );

  // Sem equivalente no repo, não aplica
  assertMatch(
    coordinatorSkill,
    /sem\s+equivalente(\s+no\s+repo)?,\s+não\s+aplica/i,
    "SKILL.md deve documentar que sem equivalente no repo, a label não é aplicada",
  );

  // Aplicação da label encontrada via gh issue edit --add-label
  assertStringIncludes(
    coordinatorSkill,
    'gh issue edit <N> --add-label "<label-encontrada>"',
    "SKILL.md deve documentar comando de adição de label",
  );
});

Deno.test("issue #457: skills/coordinator/SKILL.md exige remoção da label de triagem ao despachar issue", () => {
  // Comando de remoção de label
  assertStringIncludes(
    coordinatorSkill,
    'gh issue edit <N> --remove-label "<label-de-triagem>"',
    "SKILL.md deve exemplificar a remoção de label com gh issue edit --remove-label",
  );

  // Remoção ao despachar documentada na Fase 4 e na seção de labels
  assertMatch(
    coordinatorSkill,
    /Remoção\s+d[ae]\s+label\s+de\s+triagem\s+ao\s+despachar/i,
    "SKILL.md deve conter regra de remoção de label de triagem ao despachar",
  );
  assertMatch(
    coordinatorSkill,
    /Remoção\s+de\s+labels\s+de\s+triagem\s+antes\s+do\s+dispatch/i,
    "SKILL.md deve conter passo na Fase 4 para remoção de labels de triagem",
  );
  assertStringIncludes(
    coordinatorSkill,
    "needs-spec",
  );
  assertStringIncludes(
    coordinatorSkill,
    "status/blocked",
  );
});

Deno.test("issue #457: skills/coordinator/SKILL.md documenta comportamento em modo --headless", () => {
  // Documentação na tabela do modo headless
  assertMatch(
    coordinatorSkill,
    /\|\s*1\/2\s*—\s*labels\s+de\s+triagem\s*\|\s*Aplica label de triagem existente no repo ao pular issue \(nunca cria\)\s*\|\s*Aplica igualmente se a label existir no repositório;\s*nunca cria \(`gh label create`\)\s*\|/,
    "SKILL.md deve documentar labels de triagem na matriz headless",
  );

  // Documentação nos tópicos do modo headless
  assertMatch(
    coordinatorSkill,
    /Labels de triagem em `--headless`.*aplica igualmente a\s+label de triagem equivalente se já existir no repositório.*nunca.*cria labels/is,
    "SKILL.md deve detalhar comportamento de labels de triagem em --headless",
  );
});

Deno.test("issue #457: skills/coordinator/SKILL.md define não-escopo de status de execução (in-progress)", () => {
  // Proibição explícita de label in-progress
  assertMatch(
    coordinatorSkill,
    /nunca aplique labels indicando execução em andamento\s+\(ex\.: `in-progress`/i,
    "SKILL.md deve proibir expressamente labels de execução como in-progress",
  );

  // Estado de execução vive no worktree e status file
  assertMatch(
    coordinatorSkill,
    /estado\s+de\s+execução\s+vive\s+exclusivamente\s+no\s+worktree\s+e\s+no\s+status\s+file/i,
    "SKILL.md deve registrar que o estado vive em worktree e status file",
  );
});
