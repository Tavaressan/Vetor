import { assertEquals, assertFalse, assertMatch, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const coordinatorSkill = await Deno.readTextFile(
  new URL("skills/coordinator/SKILL.md", root),
);
const coordinatorReport = await Deno.readTextFile(
  new URL("skills/shared/references/issue-coordinator-report.md", root),
);

Deno.test("issue #456: afirmativa defasada de ausência de grafo formal é removida e corrigida", () => {
  assertFalse(
    coordinatorSkill.includes("não há grafo formal de dependências no GitHub"),
    "A afirmação defasada 'não há grafo formal de dependências no GitHub' deve ser removida",
  );
  assertStringIncludes(
    coordinatorSkill,
    'Dependências entre issues ("blocked by" / "blocking") são nativas no GitHub desde 21/08/2025',
    "Deve documentar suporte nativo a dependências entre issues no GitHub desde 21/08/2025",
  );
  assertStringIncludes(coordinatorSkill, "is:blocked");
  assertStringIncludes(coordinatorSkill, "is:blocking");
});

Deno.test("issue #456: documenta leitura do endpoint REST e resumo de dependências bloqueadoras", () => {
  assertStringIncludes(
    coordinatorSkill,
    "gh api repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by",
    "Deve documentar o endpoint REST de leitura via gh api",
  );
  assertStringIncludes(
    coordinatorSkill,
    "gh api repos/{owner}/{repo}/issues/<N> --jq .issue_dependencies_summary",
    "Deve documentar a opção de ler o resumo issue_dependencies_summary da issue",
  );
  assertFalse(
    coordinatorSkill.includes("gh issue view <N> --json issue_dependencies_summary"),
    "Não deve sugerir campo issue_dependencies_summary em gh issue view --json",
  );
});

Deno.test("issue #456: tratamentos documentados para bloqueadora fora da leva vs dentro da leva", () => {
  assertStringIncludes(
    coordinatorSkill,
    "Bloqueadora aberta e fora da leva",
    "Deve documentar a condição de bloqueadora aberta fora da leva",
  );
  assertStringIncludes(
    coordinatorSkill,
    "SKIPPED (bloqueada por #N)",
    "Deve classificar a issue candidata como SKIPPED (bloqueada por #N)",
  );

  assertStringIncludes(
    coordinatorSkill,
    "Bloqueadora dentro da leva",
    "Deve documentar a condição de bloqueadora dentro da leva",
  );
  assertStringIncludes(
    coordinatorSkill,
    "aresta do DAG como **fato** (não inferência)",
    "Deve tratar dependência nativa dentro da leva como fato no DAG",
  );
  assertStringIncludes(
    coordinatorSkill,
    "A issue dependente é alocada para uma onda posterior (`O_2+`)",
  );
});

Deno.test("issue #456: fallback para heurística textual em caso de falha ou indisponibilidade da API", () => {
  assertStringIncludes(
    coordinatorSkill,
    "Fallback para heurística textual",
    "Deve documentar seção ou passo explícito de fallback para heurística textual",
  );
  assertStringIncludes(
    coordinatorSkill,
    "Se a chamada à REST API falhar ou estiver indisponível",
    "Deve documentar o acionamento do fallback em falha ou indisponibilidade",
  );
  assertStringIncludes(
    coordinatorSkill,
    '"blocked by #12"',
    "Heurística textual deve cobrir menções 'blocked by #N'",
  );
  assertStringIncludes(
    coordinatorSkill,
    '"depende de #12"',
    "Heurística textual deve cobrir menções 'depende de #N'",
  );
});

Deno.test("issue #456: SKIPPED (bloqueada por #N) entra na triagem de despachabilidade e no plano da Fase 2", () => {
  // Triagem de despachabilidade (Fase 1)
  assertStringIncludes(
    coordinatorSkill,
    "- `SKIPPED (bloqueada por #N)`: issues cujo endpoint nativo de dependências (`blocked_by`) identifica",
  );

  // Tabela de Ações Propostas (Fase 2)
  assertMatch(
    coordinatorSkill,
    /\|\s*—\s*\|\s*<slug-\d+>\s*\|\s*#<N\d+>\s*\(Lead\)\s*\|\s*—\s*\|\s*SKIPPED \(bloqueada por #<B>\)\s*\|/,
    "A tabela da Fase 2 deve exemplificar SKIPPED (bloqueada por #<B>)",
  );
});

Deno.test("issue #456: SKIPPED (bloqueada por #N) entra no vocabulário do Coordinator Report e fechamento de onda", () => {
  // Linha de exemplo no Coordinator Report
  assertStringIncludes(
    coordinatorReport,
    "| #49 | ⏭️ SKIPPED (bloqueada por #N) | — | dependência nativa GitHub — bloqueadora aberta fora da leva |",
  );

  // Vocabulário de resultados válidos interativo e headless
  assertStringIncludes(
    coordinatorReport,
    "`SKIPPED (bloqueada por #N)`",
    "Deve incluir SKIPPED (bloqueada por #N) na lista de resultados válidos de fechamento de onda",
  );
});

Deno.test("issue #456: modelo de resolução de dependências cobre nativo, fora da leva, dentro da leva e fallback", () => {
  type DependencyResult =
    | { type: "DISPATCH"; wave: number }
    | { type: "SKIPPED"; reason: string }
    | { type: "DAG_EDGE"; from: number; to: number; origin: "fact" | "heuristic" };

  interface IssueData {
    number: number;
    body: string;
  }

  function resolveDependencies(
    candidates: IssueData[],
    fetchBlockedBy: (n: number) => { number: number; state: "open" | "closed" }[],
  ): {
    skipped: Map<number, string>;
    edges: { from: number; to: number; origin: "fact" | "heuristic" }[];
  } {
    const candidateNumbers = new Set(candidates.map((c) => c.number));
    const skipped = new Map<number, string>();
    const edges: { from: number; to: number; origin: "fact" | "heuristic" }[] = [];

    for (const issue of candidates) {
      let nativeLoaded = false;
      try {
        const blockedBy = fetchBlockedBy(issue.number);
        nativeLoaded = true;
        for (const blocker of blockedBy) {
          if (blocker.state === "open") {
            if (!candidateNumbers.has(blocker.number)) {
              skipped.set(issue.number, `SKIPPED (bloqueada por #${blocker.number})`);
            } else {
              edges.push({ from: blocker.number, to: issue.number, origin: "fact" });
            }
          }
        }
      } catch {
        // Fallback para heurística textual
        nativeLoaded = false;
      }

      if (!nativeLoaded && !skipped.has(issue.number)) {
        const match = issue.body.match(/(?:blocked by|depende de)\s+#(\d+)/i);
        if (match) {
          const blockerNum = parseInt(match[1], 10);
          if (!candidateNumbers.has(blockerNum)) {
            skipped.set(issue.number, `SKIPPED (bloqueada por #${blockerNum})`);
          } else {
            edges.push({ from: blockerNum, to: issue.number, origin: "heuristic" });
          }
        }
      }
    }

    return { skipped, edges };
  }

  // 1. Bloqueadora aberta fora da leva -> SKIPPED (bloqueada por #N)
  const res1 = resolveDependencies(
    [{ number: 10, body: "tarefa 10" }],
    () => [{ number: 99, state: "open" }],
  );
  assertEquals(res1.skipped.get(10), "SKIPPED (bloqueada por #99)");
  assertEquals(res1.edges.length, 0);

  // 2. Bloqueadora dentro da leva -> aresta DAG (fato)
  const res2 = resolveDependencies(
    [
      { number: 10, body: "tarefa base" },
      { number: 11, body: "tarefa derivada" },
    ],
    (n) => (n === 11 ? [{ number: 10, state: "open" }] : []),
  );
  assertEquals(res2.skipped.size, 0);
  assertEquals(res2.edges, [{ from: 10, to: 11, origin: "fact" }]);

  // 3. Falha na chamada da API -> fallback textual para "depende de #10"
  const res3 = resolveDependencies(
    [
      { number: 10, body: "tarefa base" },
      { number: 11, body: "tarefa derivada que depende de #10" },
    ],
    () => {
      throw new Error("GitHub API 503 Service Unavailable");
    },
  );
  assertEquals(res3.skipped.size, 0);
  assertEquals(res3.edges, [{ from: 10, to: 11, origin: "heuristic" }]);

  // 4. Falha na chamada da API com bloqueadora textual fora da leva -> SKIPPED
  const res4 = resolveDependencies(
    [{ number: 12, body: "tarefa que blocked by #99" }],
    () => {
      throw new Error("GitHub API connection timeout");
    },
  );
  assertEquals(res4.skipped.get(12), "SKIPPED (bloqueada por #99)");
});
