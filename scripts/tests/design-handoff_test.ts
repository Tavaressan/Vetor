import { assertEquals } from "@std/assert";
import {
  CANONICAL_STATES,
  DESIGN_HANDOFF_DIR,
  findUnaddressedStates,
  type PrototypeExtraction,
  renderDesignContract,
  renderPrototypeHandoffFile,
} from "../lib/design-handoff.ts";
import { writeDesignFiles } from "../lib/design-mode.ts";

function tempDir(): string {
  return Deno.makeTempDirSync();
}

function cleanup(dir: string) {
  try {
    Deno.removeSync(dir, { recursive: true });
  } catch { /* já removido */ }
}

/** Fixture: continuação do Painel de Worktrees usado em
 * skills/design/examples/design-contract-example.md, agora com estados de interface. */
function worktreesPanelExtraction(): PrototypeExtraction {
  return {
    title: "Painel de Worktrees",
    objective:
      "Permitir ao usuário visualizar os worktrees ativos do projeto e criar um novo sem sair da aplicação.",
    screens: "Painel de Worktrees (lista) → Modal de criação de worktree.",
    hierarchy: "Ação primária ('Criar worktree') no topo direito; lista de worktrees abaixo.",
    components: "Button (primary), Card (worktree item), Modal (criação).",
    content: "Título: 'Worktrees ativos'. Botão: 'Criar worktree'.",
    interactions: "Clique em 'Criar worktree' abre o Modal de criação.",
    states: [
      {
        name: "empty",
        trigger: "Nenhum worktree ativo.",
        expectedBehavior: "Explicar que não há worktree ativo no momento.",
        primaryAction: "Criar worktree.",
        visualTreatment: "Ilustração mínima + texto + botão primário, centralizado.",
        evidence: "Prototype + Specification",
      },
      {
        name: "error",
        trigger: "Falha ao carregar a lista de worktrees (erro de rede/filesystem).",
        expectedBehavior: "Exibir mensagem de erro com opção de tentar novamente.",
        primaryAction: "Tentar novamente.",
        evidence: "Specification",
      },
    ],
    notApplicableStates: [
      {
        name: "permission denied",
        reason: "O painel roda localmente sem controle de permissão por usuário.",
      },
    ],
    references: ["Prototype: (link do protótipo)", "Specification: (link da spec)"],
    decisions: [
      {
        state: "CONFIRMED",
        claim: "Ação primária da tela é 'Criar worktree'.",
        source: "Prototype",
      },
      {
        state: "INFERRED",
        claim: "A sidebar representa navegação persistente entre projetos.",
        source: "Prototype + Specification",
      },
      {
        state: "ASSUMED",
        claim: "Navegação desktop permanece expandida acima de 1024px.",
        reason:
          "Nenhuma tela do protótipo cobre breakpoints intermediários; premissa necessária para avançar a especificação.",
      },
    ],
    openQuestions: [
      {
        claim: "Os filtros da lista de worktrees devem persistir entre sessões?",
        impact:
          "Afeta se o estado do filtro precisa ser persistido em storage do cliente ou servidor.",
      },
    ],
  };
}

Deno.test("Design Contract renderizado inclui estado Empty com trigger e comportamento esperado", () => {
  const content = renderDesignContract(worktreesPanelExtraction());

  assertEquals(content.includes("### State: empty"), true);
  assertEquals(content.includes("Nenhum worktree ativo."), true);
  assertEquals(content.includes("Explicar que não há worktree ativo no momento."), true);
});

Deno.test("Design Contract renderizado inclui estado Error com trigger e comportamento esperado", () => {
  const content = renderDesignContract(worktreesPanelExtraction());

  assertEquals(content.includes("### State: error"), true);
  assertEquals(
    content.includes("Falha ao carregar a lista de worktrees (erro de rede/filesystem)."),
    true,
  );
  assertEquals(content.includes("Exibir mensagem de erro com opção de tentar novamente."), true);
});

Deno.test("Design Contract nunca copia o protótipo — preserva decisões, não pixels", () => {
  const content = renderDesignContract(worktreesPanelExtraction());

  // Estrutura do formato (design-vocabulary.md §4.5), não posição/estilo visual.
  for (
    const heading of [
      "## Objetivo da experiência",
      "## Telas",
      "## Hierarquia",
      "## Componentes",
      "## Conteúdo",
      "## Interações",
      "## Estados",
      "## Referências",
      "## Decisões",
      "## Questões abertas",
    ]
  ) {
    assertEquals(content.includes(heading), true, `esperava seção ${heading}`);
  }
});

Deno.test("Evidence State: CONFIRMED e INFERRED citam Source; ASSUMED cita Reason sem Source", () => {
  const content = renderDesignContract(worktreesPanelExtraction());

  assertEquals(
    content.includes("CONFIRMED\nAção primária da tela é 'Criar worktree'.\nSource: Prototype"),
    true,
  );
  assertEquals(
    content.includes(
      "INFERRED\nA sidebar representa navegação persistente entre projetos.\nSource: Prototype + Specification",
    ),
    true,
  );
  const assumedBlock =
    "ASSUMED\nNavegação desktop permanece expandida acima de 1024px.\nReason: Nenhuma tela do protótipo cobre breakpoints intermediários; premissa necessária para avançar a especificação.";
  assertEquals(content.includes(assumedBlock), true);
  // ASSUMED nunca cita Source — não há fonte a apontar para uma premissa (design-vocabulary.md §4.4).
  assertEquals(
    content.includes("ASSUMED\nNavegação desktop permanece expandida acima de 1024px.\nSource:"),
    false,
  );
});

Deno.test("Questões abertas usam OPEN_QUESTION com Impact, fora da seção Decisões", () => {
  const content = renderDesignContract(worktreesPanelExtraction());
  const openQuestionsSection = content.split("## Questões abertas")[1];

  assertEquals(openQuestionsSection.includes("OPEN_QUESTION"), true);
  assertEquals(
    openQuestionsSection.includes(
      "Os filtros da lista de worktrees devem persistir entre sessões?",
    ),
    true,
  );
  assertEquals(openQuestionsSection.includes("Impact:"), true);

  const decisionsSection = content.split("## Decisões")[1].split("## Questões abertas")[0];
  assertEquals(decisionsSection.includes("OPEN_QUESTION"), false);
});

Deno.test("estado não especificado nem marcado como não aplicável vira OPEN_QUESTION, nunca é omitido em silêncio", () => {
  const extraction = worktreesPanelExtraction();
  const unaddressed = findUnaddressedStates(extraction);

  // states cobre empty/error; notApplicableStates cobre permission denied — o resto fica pendente.
  assertEquals(unaddressed.length, CANONICAL_STATES.length - 3);
  assertEquals(unaddressed.includes("loading"), true);

  const content = renderDesignContract(extraction);
  for (const name of unaddressed) {
    assertEquals(
      content.includes(`### State: ${name}`),
      true,
      `esperava bloco pendente para ${name}`,
    );
    assertEquals(content.split(`### State: ${name}`)[1].startsWith("\n\nOPEN_QUESTION"), true);
  }
});

Deno.test("estado marcado como não aplicável registra a razão em vez de ser omitido", () => {
  const content = renderDesignContract(worktreesPanelExtraction());
  assertEquals(content.includes("### State: permission denied"), true);
  assertEquals(content.includes("Not applicable:"), true);
  assertEquals(
    content.includes("O painel roda localmente sem controle de permissão por usuário."),
    true,
  );
});

Deno.test("quando todos os 9 estados são endereçados, findUnaddressedStates retorna vazio", () => {
  const extraction = worktreesPanelExtraction();
  extraction.notApplicableStates = CANONICAL_STATES
    .filter((n) => n !== "empty" && n !== "error")
    .map((name) => ({ name, reason: "coberto para este teste" }));

  assertEquals(findUnaddressedStates(extraction), []);
});

Deno.test("renderPrototypeHandoffFile grava em .vetor/design/handoff/<slug>.md sem sobrescrever", () => {
  const dir = tempDir();
  try {
    const file = renderPrototypeHandoffFile(worktreesPanelExtraction());
    assertEquals(file.path, `${DESIGN_HANDOFF_DIR}/painel-de-worktrees.md`);

    const first = writeDesignFiles(dir, [file]);
    assertEquals(first.written, [file.path]);

    Deno.writeTextFileSync(`${dir}/${file.path}`, "# editado manualmente\n");
    const second = writeDesignFiles(dir, [file]);
    assertEquals(second.written, []);
    assertEquals(second.skipped, [file.path]);
    assertEquals(Deno.readTextFileSync(`${dir}/${file.path}`), "# editado manualmente\n");
  } finally {
    cleanup(dir);
  }
});

Deno.test("campos opcionais ausentes (Layout, Tokens, Responsividade, Acessibilidade, Restrições) são omitidos, nunca preenchidos com placeholder", () => {
  const extraction = worktreesPanelExtraction();
  const content = renderDesignContract(extraction);

  assertEquals(content.includes("## Layout"), false);
  assertEquals(content.includes("## Tokens"), false);
  assertEquals(content.includes("## Responsividade"), false);
  assertEquals(content.includes("## Acessibilidade"), false);
  assertEquals(content.includes("## Restrições"), false);
});

Deno.test("exemplo de handoff em skills/design/examples/ inclui os estados Empty e Error com trigger e comportamento esperado (critério de aceite da #229)", async () => {
  const exampleUrl = new URL(
    "../../skills/design/examples/prototype-handoff-example.md",
    import.meta.url,
  );
  const content = await Deno.readTextFile(exampleUrl);

  assertEquals(content.includes("### State: empty"), true);
  assertEquals(content.includes("Nenhum worktree ativo no projeto."), true);
  assertEquals(
    content.includes("Explicar que não há worktree ativo no momento, sem tratar como erro."),
    true,
  );

  assertEquals(content.includes("### State: error"), true);
  assertEquals(
    content.includes("Falha ao carregar a lista de worktrees (erro de rede ou filesystem)."),
    true,
  );
  assertEquals(
    content.includes(
      "Exibir mensagem de erro específica (não genérica) com opção de tentar novamente",
    ),
    true,
  );
});
