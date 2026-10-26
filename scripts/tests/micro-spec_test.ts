import { assertEquals, assertMatch, assertThrows } from "@std/assert";
import { fileURLToPath } from "node:url";
import { buildContextPacket } from "../lib/orchestrator/context-packet.ts";
import { microSpecPath, validateMicroSpec } from "../lib/orchestrator/micro-spec.ts";
import { run } from "../lib/project.ts";

// Issue #501 (RF-07 de docs/specs/autonomia-continua-e-desacoplamento-interativo.md): micro-spec
// JIT injetada no ContextPacket. Os testes ficam fora de context-packet_test.ts de propósito, para
// não colidir com as extensões do mesmo pacote feitas em paralelo (repoMap, #507).

const CLI = fileURLToPath(new URL("../context-packet.ts", import.meta.url));

const MODULE_TEST_MAP = `## Comandos por módulo

| Módulo | Comando headless |
|--------|------------------|
| \`root\` | \`deno task test\` |

## Detecção de módulo por arquivos alterados

| Prefixo do path | Módulo |
|-----------------|--------|
| \`./\` | \`root\` |
`;

const MICRO_SPEC = `# Micro-spec #488 — Cache com Redis

## Objetivo
Responder leituras repetidas a partir de um cache Redis, sem alterar a API pública.

## Critérios de aceite
- [ ] Uma segunda leitura da mesma chave não consulta o banco
- [ ] Chaves expiram em no máximo 300 s
- [ ] A falha do Redis degrada para o banco sem erro ao chamador

## Non-goals
- Invalidar o cache entre instâncias
- Migrar os dados existentes
`;

Deno.test("issue #501: o path da micro-spec segue docs/specs/micro/<issue#>-<slug>.md", () => {
  assertEquals(microSpecPath(488, "cache-redis"), "docs/specs/micro/488-cache-redis.md");
});

Deno.test("issue #501: o slug da micro-spec não pode escapar do diretório", () => {
  assertThrows(() => microSpecPath(1, "../../etc/passwd"), Error, "slug");
  assertThrows(() => microSpecPath(1, "Com Espaço"), Error, "slug");
  assertThrows(() => microSpecPath(0, "ok"), Error, "issue");
});

Deno.test("issue #501: validateMicroSpec aceita 1 objetivo, 3 critérios e 2 non-goals", () => {
  assertEquals(validateMicroSpec(MICRO_SPEC), []);
});

Deno.test("issue #501: validateMicroSpec lista cada defeito da saída do modelo leve", () => {
  const problems = validateMicroSpec(
    "## Objetivo\n\n## Critérios de aceite\n- [ ] só um\n\n## Non-goals\n- a\n- b\n- c\n",
  );
  assertEquals(problems.length, 3);
  assertMatch(problems.join("\n"), /Objetivo/);
  assertMatch(problems.join("\n"), /3 critérios/);
  assertMatch(problems.join("\n"), /2 non-goals/);
});

Deno.test("issue #501: validateMicroSpec recusa mais de uma página", () => {
  const longSpec = `${MICRO_SPEC}${"linha extra\n".repeat(80)}`;
  assertMatch(validateMicroSpec(longSpec).join("\n"), /1 página/);
});

Deno.test("issue #501: o ContextPacket carrega a micro-spec sem alterar os campos atuais", () => {
  const issue = { number: 488, title: "feat: cache", body: "- [ ] A\n" };
  const base = buildContextPacket({
    issue,
    slug: "cache-redis",
    worktree: { branch: "feat/488-cache-redis", baseBranch: "master" },
    moduleTestMap: MODULE_TEST_MAP,
  });
  const withSpec = buildContextPacket({
    issue,
    slug: "cache-redis",
    worktree: { branch: "feat/488-cache-redis", baseBranch: "master" },
    moduleTestMap: MODULE_TEST_MAP,
    microSpec: MICRO_SPEC,
  });

  assertEquals(base.context.microSpec, undefined);
  assertEquals(withSpec.context.microSpec, {
    path: "docs/specs/micro/488-cache-redis.md",
    content: MICRO_SPEC,
  });
  // tudo que já existia segue igual
  assertEquals({ ...withSpec.context, microSpec: undefined }, {
    ...base.context,
    microSpec: undefined,
  });
  assertEquals(withSpec.issue, base.issue);
  assertEquals(withSpec.worktree, base.worktree);
});

async function runCli(
  extra: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/issue.json`,
      JSON.stringify({ number: 488, title: "feat: cache", body: "- [ ] A\n" }),
    );
    await Deno.writeTextFile(`${dir}/map.md`, MODULE_TEST_MAP);
    await Deno.writeTextFile(
      `${dir}/micro.md`,
      extra.includes("INVALID") ? "# vazio\n" : MICRO_SPEC,
    );
    return await run(
      "deno",
      [
        "run",
        "-A",
        CLI,
        "--issue-json",
        `${dir}/issue.json`,
        "--module-test-map",
        `${dir}/map.md`,
        "--slug",
        "cache-redis",
        "--branch",
        "feat/488-cache-redis",
        "--base",
        "master",
        "--micro-spec",
        `${dir}/micro.md`,
      ],
      dir,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("issue #501: a CLI context-packet injeta a micro-spec lida de --micro-spec", async () => {
  const result = await runCli([]);
  assertEquals(result.code, 0, result.stderr);
  const packet = JSON.parse(result.stdout);
  assertEquals(packet.context.microSpec.path, "docs/specs/micro/488-cache-redis.md");
  assertEquals(packet.context.microSpec.content, MICRO_SPEC);
  assertEquals(packet.context.testCommand, "deno task test");
});

Deno.test("issue #501: a CLI recusa micro-spec inválida para o coordinator despachar sem ela", async () => {
  const result = await runCli(["INVALID"]);
  assertEquals(result.code, 1);
  assertMatch(result.stderr, /micro-spec/);
  assertEquals(result.stdout, "");
});
