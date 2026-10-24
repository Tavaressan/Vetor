import {
  assert,
  assertFalse,
  assertMatch,
  assertNotMatch,
  assertStringIncludes,
} from "@std/assert";

// Issue #478: `opencode/agent/issue-coordinator.md` é um agent fino. O fluxo do coordinator mora em
// `skills/coordinator/SKILL.md` e nas referências de `skills/shared/references/`; o agent só carrega
// a skill pela ferramenta `skill` e registra o que muda ao executar no OpenCode. Estes testes
// protegem esse contrato sem exigir que o texto das fases seja duplicado no agent.

const root = new URL("../../", import.meta.url);

function readText(path: string): Promise<string> {
  return Deno.readTextFile(new URL(path, root));
}

const agent = await readText("opencode/agent/issue-coordinator.md");
const skill = await readText("skills/coordinator/SKILL.md");
const reportReference = await readText("skills/shared/references/issue-coordinator-report.md");

function extractFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert(match !== null, "frontmatter YAML ausente");
  return match[1];
}

Deno.test("issue-coordinator carrega a skill coordinator pela ferramenta skill, com permissão explícita — issue #478", () => {
  const frontmatter = extractFrontmatter(agent);

  assertMatch(frontmatter, /^mode:\s*primary\s*$/m);
  // `"*": deny` primeiro e `coordinator: allow` depois: no OpenCode vale a última regra que casa.
  assertMatch(frontmatter, /^ {2}skill:\r?\n {4}"\*":\s*deny\r?\n {4}coordinator:\s*allow\s*$/m);

  assertStringIncludes(agent, "ferramenta `skill`");
  assertStringIncludes(agent, 'name: "coordinator"');
  assertStringIncludes(agent, "Base directory for this skill");
});

Deno.test("issue-coordinator para e reporta a lacuna quando a skill não está disponível — issue #478", () => {
  assertMatch(agent, /ou\s+uma\s+referência[^.]*não existir,\s+\*\*pare\*\*/);
  assertStringIncludes(agent, "vetor install --engines opencode");
});

Deno.test("issue-coordinator não repete as fases nem as regras da skill — issue #478", () => {
  const phaseHeadings = skill.match(/^### \d — .+$/gm) ?? [];
  assert(phaseHeadings.length >= 7, "a skill deveria ter as fases 0 a 7");
  for (const heading of phaseHeadings) {
    assertFalse(agent.includes(heading), `o agent repete o cabeçalho da skill: ${heading}`);
  }

  // Trechos operacionais que pertencem à skill e às referências compartilhadas.
  for (
    const duplicated of [
      "Gerado por",
      "ai-generated",
      "Checkpoint de fechamento de onda",
      "SKIPPED (aguardando",
      "Ondas de despacho",
      "Circuit Breaker",
      "defaultDispatchLabel",
    ]
  ) {
    assertFalse(agent.includes(duplicated), `o agent repete "${duplicated}", que é da skill`);
  }

  assert(
    agent.split(/\r?\n/).length < 150,
    "o agent fino deveria ter menos de 150 linhas (eram 593 antes da #478)",
  );
});

Deno.test("issue-coordinator mantém as diferenças de execução do OpenCode — issue #478", () => {
  // Dispatch por processo separado, no lugar da ferramenta Agent.
  assertStringIncludes(agent, "opencode run --dir");
  assertStringIncludes(agent, "--agent issue-worker");
  assertStringIncludes(agent, "git worktree add");
  assertStringIncludes(agent, "`-c`/`--continue`");

  // Scripts exclusivos do OpenCode, chamados antes de cada dispatch.
  assertStringIncludes(agent, ".opencode/scripts/ensure-external-directory-permission.ts");
  assertStringIncludes(agent, ".opencode/scripts/resolve-model.ts");
  assertStringIncludes(agent, "$(pwd -W 2>/dev/null || pwd)");

  // Ferramentas que a skill usa e o OpenCode não tem: o agent diz o que fazer no lugar delas.
  for (const unavailable of ["Agent()", "SendMessage", "AskUserQuestion", "ExitPlanMode"]) {
    assertStringIncludes(agent, unavailable);
  }
  assertStringIncludes(agent, "## Coordinator Report (OpenCode)");
  assertStringIncludes(agent, "issue-coordinator-report.md");
});

Deno.test("issue-coordinator documenta escalação simple -> complex após FAILED_MAX_ITERATIONS e sem default embutido — issue #395", () => {
  assertNotMatch(
    agent,
    /default embutido[\s\S]{0,40}resolve-model\.ts/,
    "issue-coordinator.md não deve citar default embutido em resolve-model.ts (removido na #312)",
  );

  const redispatchIndex = agent.indexOf("Redespacho de worktree existente");
  assert(redispatchIndex >= 0, "seção de redespacho de worktree existente ausente");
  const redispatchSection = agent.slice(redispatchIndex, redispatchIndex + 1500);

  assertStringIncludes(redispatchSection, "FAILED_MAX_ITERATIONS");
  assertStringIncludes(redispatchSection, "simple");
  assertStringIncludes(redispatchSection, "complex");
  assertStringIncludes(redispatchSection, "uma vez");
  assertStringIncludes(redispatchSection, "resolve-model.ts");
  assertStringIncludes(redispatchSection, "não escala");
});

// Tudo que o agent cita precisa existir: nas referências compartilhadas (instaladas em
// `.opencode/skills/shared/references/`) e nos scripts que o instalador gera em `.opencode/scripts/`.
Deno.test("issue-coordinator só cita referências e scripts que o instalador entrega — issue #478", async () => {
  const references = new Set(
    [...agent.matchAll(/\.\.\/shared\/references\/([A-Za-z0-9._-]+\.md)/g)].map((m) => m[1]),
  );
  assert(references.size > 0, "o agent deveria apontar para as referências da skill");
  for (const name of references) {
    await Deno.stat(new URL(`skills/shared/references/${name}`, root));
  }

  const scripts = new Set(
    [...agent.matchAll(/\.opencode\/scripts\/([A-Za-z0-9._/-]+\.(?:ts|sh))/g)].map((m) => m[1]),
  );
  assert(scripts.size > 0, "o agent deveria citar os scripts do OpenCode");
  for (const name of scripts) {
    const canonical = await exists(new URL(`scripts/${name}`, root));
    const exclusive = await exists(new URL(`opencode/scripts/${name}`, root));
    assert(canonical || exclusive, `.opencode/scripts/${name} não tem fonte no repositório`);
  }
});

async function exists(url: URL): Promise<boolean> {
  try {
    await Deno.stat(url);
    return true;
  } catch {
    return false;
  }
}

// A paridade do relatório e do fechamento de onda (issue #335) agora vem da referência
// compartilhada que o agent manda seguir, não de uma cópia dentro do agent.
Deno.test("o checkpoint de fechamento de onda vive na referência compartilhada — issues #335 e #478", () => {
  const reportHeading = reportReference.indexOf("## Coordinator Report");
  const checkpoint = reportReference.indexOf("Checkpoint de fechamento de onda (issue #246)");
  const headlessInstructions = reportReference.indexOf(
    "Em `--headless`, o relatório é a única saída",
  );

  assert(reportHeading >= 0);
  assert(checkpoint > reportHeading);
  assert(headlessInstructions > checkpoint);
  assertStringIncludes(reportReference, "`Review required`");
  assertStringIncludes(reportReference, "`GREEN (pronto para ship)`");
  assertStringIncludes(reportReference, "`SKIPPED (aguardando insumo do usuário)`");
  assertStringIncludes(reportReference, "`SKIPPED (fora deste repositório)`");
  assertStringIncludes(reportReference, "`SKIPPED (épico/acompanhamento)`");
  assertStringIncludes(reportReference, "não pergunte");
  assertStringIncludes(reportReference, "nem redespache");
});

Deno.test("nenhum agente em opencode/agent/ fixa model: no frontmatter — issue #395", async () => {
  const agentFiles = [
    "issue-coordinator.md",
    "issue-worker.md",
    "code-review.md",
  ];

  for (const file of agentFiles) {
    const document = await readText(`opencode/agent/${file}`);
    const frontmatter = extractFrontmatter(document);
    assertNotMatch(
      frontmatter,
      /^model:\s*\S+/m,
      `${file} fixa model: no frontmatter YAML; modelos devem vir de config.json ou inherit`,
    );
  }
});
