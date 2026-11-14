import { assert, assertEquals, assertFalse } from "@std/assert";
import { profileTask } from "../lib/execution/task-profiler.ts";

const MODULE_MAP = `# Module Test Map

## Comandos por módulo

| Módulo | Comando headless | Notas |
|--------|------------------|-------|
| \`root\` | \`deno task test\` | Módulo raiz |
| \`cli\` | \`cd cli && npm test\` | Subpacote npm |

## Detecção de módulo por arquivos alterados

| Prefixo do path | Módulo |
|-----------------|--------|
| \`cli/\` | \`cli\` |
| \`scripts/\` | \`root\` |
| \`./\` | \`root\` |
`;

function baseInput() {
  return {
    taskId: "650",
    title: "feat(execution): task-profiler determinístico com proveniência por campo",
    body:
      "## Descrição\n\nImplementar profiler.\n\n## Critérios de aceite\n\n- [ ] Campo A\n- [x] Campo B\n- [ ] Campo C\n\nAlvos: `scripts/lib/execution/task-profiler.ts` e `scripts/tests/execution-task-profiler_test.ts`",
    labels: ["enhancement", "scripts"],
    moduleTestMap: MODULE_MAP,
  };
}

Deno.test("profileTask: deriva operations/domains e fatos básicos", () => {
  const p = profileTask(baseInput());
  assertEquals(p.profileVersion, 1);
  assertEquals(p.taskId, "650");
  assert(p.operations.includes("feat"));
  assertEquals(p.evidence.titlePrefix, "feat");
  assertEquals(p.evidence.acceptanceCriteriaCount, 3);
  assertEquals(p.evidence.labels, ["enhancement", "scripts"]);
  assert(p.domains.includes("root"));
  assert(p.evidence.resolvedModules.includes("root"));
});

Deno.test("profileTask: complexity e risk são unknown por padrão e informativos (derived)", () => {
  const p = profileTask(baseInput());
  assertEquals(p.complexity, "unknown");
  assertEquals(p.risk, "unknown");
  assertEquals(p.provenance.complexity, "derived");
  assertEquals(p.provenance.risk, "derived");
});

Deno.test("profileTask: operations e domains têm proveniência derived", () => {
  const p = profileTask(baseInput());
  assertEquals(p.provenance.operations, "derived");
  assertEquals(p.provenance.domains, "derived");
});

Deno.test("profileTask: requirements.browser/mcp só true por restrição explícita", () => {
  const p = profileTask(baseInput());
  assertEquals(p.requirements, { browser: false, mcp: false });
  assertEquals(p.provenance.requirements, "default");

  const pExplicit = profileTask({
    ...baseInput(),
    explicit: { requirements: { browser: true, mcp: true } },
  });
  assertEquals(pExplicit.requirements, { browser: true, mcp: true });
  assertEquals(pExplicit.provenance.requirements, "explicit");

  const pPartial = profileTask({
    ...baseInput(),
    explicit: { requirements: { mcp: true } },
  });
  assertEquals(pPartial.requirements, { browser: false, mcp: true });
  assertEquals(pPartial.provenance.requirements, "explicit");
});

Deno.test("profileTask: dataSensitivity só explicit, config ou default (nunca inferido)", () => {
  const pDefault = profileTask(baseInput());
  assertEquals(pDefault.dataSensitivity, "unknown");
  assertEquals(pDefault.provenance.dataSensitivity, "default");

  const pConfig = profileTask({
    ...baseInput(),
    defaultDataSensitivity: "private",
  });
  assertEquals(pConfig.dataSensitivity, "private");
  assertEquals(pConfig.provenance.dataSensitivity, "config");

  const pExplicit = profileTask({
    ...baseInput(),
    defaultDataSensitivity: "private",
    explicit: { dataSensitivity: "sensitive" },
  });
  assertEquals(pExplicit.dataSensitivity, "sensitive");
  assertEquals(pExplicit.provenance.dataSensitivity, "explicit");
});

Deno.test("profileTask: evidence guarda apenas fatos, sem corpo nem prompt", () => {
  const input = {
    ...baseInput(),
    body: "SEGREDO NO CORPO\n- [ ] Critério",
  };
  const p = profileTask(input);
  const serialized = JSON.stringify(p);
  assertFalse(serialized.includes("SEGREDO NO CORPO"));
  assertEquals(p.evidence.acceptanceCriteriaCount, 1);
  // campos de evidence são só fatos estruturais
  assert("labels" in p.evidence);
  assert("acceptanceCriteriaCount" in p.evidence);
  assert("resolvedModules" in p.evidence);
  assert("specProvided" in p.evidence);
  assert("microSpecProvided" in p.evidence);
  // @ts-ignore: evidence não inclui body
  assert(!("body" in p.evidence));
  // @ts-ignore: evidence não inclui prompt
  assert(!("prompt" in p.evidence));
});

Deno.test("profileTask: usa funções puras de §5.3 sem construir ContextPacket", () => {
  const p = profileTask({
    taskId: "1",
    title: "fix(cli): ajusta `cli/bin/vetor.js`",
    body: "- [ ] ok",
    labels: [],
    moduleTestMap: MODULE_MAP,
  });
  // extractTargetFiles + parseModuleTestMap + resolveModule => módulo cli
  assert(p.evidence.resolvedModules.includes("cli"));
  assert(p.domains.includes("cli"));
  assertEquals(p.evidence.acceptanceCriteriaCount, 1);
  assertEquals(p.evidence.titlePrefix, "fix");
});

Deno.test("profileTask: sem alvos usa módulo fallback e sem prefixo não define titlePrefix", () => {
  const p = profileTask({
    taskId: "2",
    title: "Sem prefixo convencional",
    body: "sem checklist",
    labels: [],
    moduleTestMap: MODULE_MAP,
  });
  assertEquals(p.operations, []);
  assertEquals(p.evidence.titlePrefix, undefined);
  assertEquals(p.evidence.resolvedModules, ["root"]);
  assertEquals(p.evidence.acceptanceCriteriaCount, 0);
});

Deno.test("profileTask: specProvided/microSpecProvided e labels vazios por padrão", () => {
  const p = profileTask({
    taskId: "3",
    title: "docs: readme",
    body: "",
    moduleTestMap: MODULE_MAP,
  });
  assertEquals(p.evidence.labels, []);
  assertEquals(p.evidence.specProvided, false);
  assertEquals(p.evidence.microSpecProvided, false);
  const p2 = profileTask({
    ...baseInput(),
    specProvided: true,
    microSpecProvided: true,
  });
  assertEquals(p2.evidence.specProvided, true);
  assertEquals(p2.evidence.microSpecProvided, true);
});

Deno.test("regra de gate: campos derived não eliminam executor (proveniência não-gateante)", () => {
  const p = profileTask({
    ...baseInput(),
    explicit: { requirements: { browser: true }, dataSensitivity: "sensitive" },
  });
  const gateable = ["explicit", "config", "default"] as const;
  // derived não pode gatear
  assertEquals(p.provenance.operations, "derived");
  assertEquals(p.provenance.domains, "derived");
  assertEquals(p.provenance.complexity, "derived");
  assertEquals(p.provenance.risk, "derived");
  assertFalse((gateable as readonly string[]).includes(p.provenance.operations));
  assertFalse((gateable as readonly string[]).includes(p.provenance.complexity));
  // explicit/config/default podem gatear
  assert((gateable as readonly string[]).includes(p.provenance.requirements));
  assert((gateable as readonly string[]).includes(p.provenance.dataSensitivity));
  assertEquals(p.provenance.requirements, "explicit");
  assertEquals(p.provenance.dataSensitivity, "explicit");
});
