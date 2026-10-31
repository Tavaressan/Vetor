// Cobre o ContextPacket (RF-07 de docs/specs/pipeline-ship-e-delegacao-eficiente.md, issue #496):
// o pacote JSON que o coordinator injeta no prompt inaugural do issue-worker para ele não gastar
// tool calls redescobrindo módulo, comando de teste e arquivos-alvo.

import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import {
  buildContextPacket,
  catchAllModule,
  CONTEXT_PACKET_SCHEMA,
  type ContextPacket,
  extractAcceptanceCriteria,
  extractTargetFiles,
  parseModuleTestMap,
  renderContextPacketPrompt,
  resolveModule,
} from "../lib/orchestrator/context-packet.ts";

const MODULE_TEST_MAP = `# Module Test Map

## Comandos por módulo

| Módulo | Comando headless | Notas |
|--------|------------------|-------|
| \`root\` | \`deno task test\` | Módulo raiz |
| \`cli\` | \`cd cli && npm test\` | Subpacote npm |
| \`docs-site\` | \`sem suíte de testes\` | Não executar |

## Detecção de módulo por arquivos alterados

| Prefixo do path | Módulo |
|-----------------|--------|
| \`cli/\` | \`cli\` |
| \`cli/lib/installer/\` | \`cli-installer\` |
| \`site/\` | \`docs-site\` |
| \`./\` | \`root\` |
`;

Deno.test("extractAcceptanceCriteria devolve só os itens de checklist, marcados ou não", () => {
  const body = [
    "Descrição solta com - [ ] no meio da frase.",
    "",
    "Critérios de aceite:",
    "- [ ] Retornar JSON com a lista de status",
    "- [x] Executar em menos de 500ms  ",
    "* [ ] Item com asterisco",
    "- item comum sem checkbox",
  ].join("\n");

  assertEquals(extractAcceptanceCriteria(body), [
    "Retornar JSON com a lista de status",
    "Executar em menos de 500ms",
    "Item com asterisco",
  ]);
});

Deno.test("extractAcceptanceCriteria devolve lista vazia quando o body não tem checklist", () => {
  assertEquals(extractAcceptanceCriteria("Sem critérios aqui."), []);
});

Deno.test("extractTargetFiles pega só caminhos de arquivo entre crases, sem duplicar nem poluir", () => {
  const text = [
    "Criar `agents/ship-worker.md` e ajustar `scripts/lib/orchestrator/index.ts`.",
    "Ver `docs\\specs\\pipeline.md`, rodar `deno task test` e `--prepare`.",
    "Versão `1.2.0`, link `https://example.com/a.md` e de novo `agents/ship-worker.md`.",
    "Diretório `agents/` não é arquivo; `deno.json` é.",
  ].join("\n");

  assertEquals(extractTargetFiles(text), [
    "agents/ship-worker.md",
    "scripts/lib/orchestrator/index.ts",
    "docs/specs/pipeline.md",
    "deno.json",
  ]);
});

Deno.test("parseModuleTestMap lê a tabela de comandos e a de prefixos", () => {
  const map = parseModuleTestMap(MODULE_TEST_MAP);

  assertEquals(map.commands, {
    "root": "deno task test",
    "cli": "cd cli && npm test",
    "docs-site": "sem suíte de testes",
  });
  assertEquals(map.prefixes, [
    { prefix: "cli/", module: "cli" },
    { prefix: "cli/lib/installer/", module: "cli-installer" },
    { prefix: "site/", module: "docs-site" },
    { prefix: "./", module: "root" },
  ]);
});

Deno.test("resolveModule usa o prefixo mais longo e cai no módulo './' sem correspondência", () => {
  const map = parseModuleTestMap(MODULE_TEST_MAP);

  assertEquals(resolveModule(["cli/lib/installer/writer.js"], map), "cli-installer");
  assertEquals(resolveModule(["cli/bin/vetor.js"], map), "cli");
  assertEquals(resolveModule(["scripts/x.ts"], map), "root");
  assertEquals(resolveModule([], map), "root");
});

Deno.test("resolveModule escolhe o módulo dominante quando os arquivos se espalham", () => {
  const map = parseModuleTestMap(MODULE_TEST_MAP);

  assertEquals(resolveModule(["cli/a.js", "cli/b.js", "scripts/c.ts"], map), "cli");
});

Deno.test("buildContextPacket monta o pacote completo da Spec (RF-07)", () => {
  const packet = buildContextPacket({
    issue: {
      number: 485,
      title: "feat(cli): adicionar comando de status em lote",
      body:
        "Alterar `cli/status.ts` e `cli/tests/status_test.ts`.\n\n- [ ] Retornar JSON\n- [ ] Rodar em 500ms",
    },
    slug: "status-em-lote",
    worktree: {
      path: "C:/Projetos/Vetor/.claude/worktrees/status-em-lote",
      branch: "feat/485-status-em-lote",
      baseBranch: "main",
    },
    moduleTestMap: MODULE_TEST_MAP,
    conventions: "Tratar exit codes explicitamente.",
  });

  const expected: ContextPacket = {
    $schema: CONTEXT_PACKET_SCHEMA,
    issue: {
      number: 485,
      title: "feat(cli): adicionar comando de status em lote",
      slug: "status-em-lote",
      acceptanceCriteria: ["Retornar JSON", "Rodar em 500ms"],
    },
    worktree: {
      path: "C:/Projetos/Vetor/.claude/worktrees/status-em-lote",
      branch: "feat/485-status-em-lote",
      baseBranch: "main",
    },
    context: {
      module: "cli",
      testCommand: "cd cli && npm test",
      targetFiles: ["cli/status.ts", "cli/tests/status_test.ts"],
      conventions: "Tratar exit codes explicitamente.",
    },
  };
  assertEquals(packet, expected);
});

Deno.test("buildContextPacket omite worktree.path e conventions quando não informados", () => {
  const packet = buildContextPacket({
    issue: { number: 7, title: "chore: ajuste", body: "" },
    slug: "ajuste",
    worktree: { branch: "chore/7-ajuste", baseBranch: "master" },
    moduleTestMap: MODULE_TEST_MAP,
  });

  assertEquals("path" in packet.worktree, false);
  assertEquals("conventions" in packet.context, false);
  assertEquals("repoMap" in packet.context, false);
  assertEquals(packet.context.module, "root");
  assertEquals(packet.context.testCommand, "deno task test");
  assertEquals(packet.context.targetFiles, []);
});

Deno.test("buildContextPacket respeita targetFiles explícitos em vez de inferir do texto", () => {
  const packet = buildContextPacket({
    issue: { number: 7, title: "x", body: "Mexer em `scripts/a.ts`." },
    slug: "x",
    worktree: { branch: "fix/7-x", baseBranch: "master" },
    moduleTestMap: MODULE_TEST_MAP,
    targetFiles: ["site/index.md"],
  });

  assertEquals(packet.context.targetFiles, ["site/index.md"]);
  assertEquals(packet.context.module, "docs-site");
  assertEquals(packet.context.testCommand, "sem suíte de testes");
});

Deno.test("buildContextPacket falha claro quando o module-test-map não tem módulos", () => {
  assertThrows(
    () =>
      buildContextPacket({
        issue: { number: 1, title: "x", body: "" },
        slug: "x",
        worktree: { branch: "fix/1-x", baseBranch: "master" },
        moduleTestMap: "# vazio\n",
      }),
    Error,
    "module-test-map",
  );
});

Deno.test("buildContextPacket falha claro quando o módulo resolvido não tem comando no mapa", () => {
  assertThrows(
    () =>
      buildContextPacket({
        issue: { number: 1, title: "x", body: "" },
        slug: "x",
        worktree: { branch: "fix/1-x", baseBranch: "master" },
        moduleTestMap: MODULE_TEST_MAP,
        targetFiles: ["cli/lib/installer/writer.js"],
      }),
    Error,
    'módulo "cli-installer"',
  );
});

Deno.test("catchAllModule devolve o módulo de './' ou, sem ele, o primeiro da tabela de comandos", () => {
  assertEquals(catchAllModule(parseModuleTestMap(MODULE_TEST_MAP)), "root");
  const semCatchAll = parseModuleTestMap(
    "| Módulo | Comando |\n|---|---|\n| `a` | `x` |\n| `b` | `y` |\n",
  );
  assertEquals(catchAllModule(semCatchAll), "a");
  assertEquals(catchAllModule(parseModuleTestMap("# vazio")), undefined);
});

// Repo Map escopado (issue #507, RF-04 de docs/specs/repo-map-ast-context-packet.md): o mapa é
// uma string Markdown em `context.repoMap` e, no prompt do worker, vai dentro de <repo_map>.
const REPO_MAP = "### cli/status.ts\n```ts\nexport function status(): string { ... }\n```\n";

Deno.test("buildContextPacket inclui context.repoMap e ele sobrevive à serialização do payload", () => {
  const packet = buildContextPacket({
    issue: { number: 507, title: "feat: x", body: "Alterar `cli/status.ts`." },
    slug: "x",
    worktree: { branch: "feat/507-x", baseBranch: "master" },
    moduleTestMap: MODULE_TEST_MAP,
    repoMap: REPO_MAP,
  });

  assertEquals(packet.context.repoMap, REPO_MAP);
  const roundTrip = JSON.parse(JSON.stringify(packet)) as ContextPacket;
  assertEquals(roundTrip.context.repoMap, REPO_MAP);
  assertEquals(roundTrip, packet);
});

Deno.test("renderContextPacketPrompt põe o mapa na tag <repo_map> fora do JSON, depois do bloco json", () => {
  const packet = buildContextPacket({
    issue: { number: 507, title: "feat: x", body: "Alterar `cli/status.ts`.\n- [ ] Criar x" },
    slug: "x",
    worktree: { branch: "feat/507-x", baseBranch: "master" },
    moduleTestMap: MODULE_TEST_MAP,
    repoMap: REPO_MAP,
  });
  const prompt = renderContextPacketPrompt(packet);

  assert(prompt.startsWith("```json\n"), "o bloco json abre o prompt");
  const json = prompt.match(/^```json\n([\s\S]*?)\n```/);
  assert(json, "bloco json presente");
  const { repoMap: _omitted, ...contextWithoutMap } = packet.context;
  assertEquals(JSON.parse(json[1]), { ...packet, context: contextWithoutMap });
  assertEquals(Object.keys(JSON.parse(json[1]).context).includes("repoMap"), false);

  assertMatch(prompt, /\n\n<repo_map>\n### cli\/status\.ts\n/);
  assert(prompt.endsWith("```\n</repo_map>"), "a tag fecha o prompt do pacote");
  assert(prompt.indexOf("</repo_map>") > prompt.indexOf("```json"));
  assertEquals(prompt.split("<repo_map>").length, 2, "uma única tag de abertura");
});

Deno.test("renderContextPacketPrompt sem repoMap emite só o bloco json, sem tag", () => {
  const packet = buildContextPacket({
    issue: { number: 7, title: "chore: ajuste", body: "" },
    slug: "ajuste",
    worktree: { branch: "chore/7-ajuste", baseBranch: "master" },
    moduleTestMap: MODULE_TEST_MAP,
  });
  const prompt = renderContextPacketPrompt(packet);

  assertEquals(prompt.includes("<repo_map>"), false);
  assertEquals(prompt, "```json\n" + JSON.stringify(packet, null, 2) + "\n```");
});

// CLI exposto para o coordinator (skills são prosa e não importam TypeScript — mesmo padrão de
// scripts/spec-validate.ts).
const CLI = new URL("../context-packet.ts", import.meta.url).pathname.replace(
  /^\/([A-Za-z]):/,
  "$1:",
);

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const { code, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", CLI, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

Deno.test("CLI context-packet imprime o JSON do pacote a partir de --issue-json e --module-test-map", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const issuePath = `${dir}/issue.json`;
    const mapPath = `${dir}/module-test-map.md`;
    await Deno.writeTextFile(
      issuePath,
      JSON.stringify({
        number: 485,
        title: "feat(cli): status em lote",
        body: "Alterar `cli/status.ts`.\n- [ ] Retornar JSON",
      }),
    );
    await Deno.writeTextFile(mapPath, MODULE_TEST_MAP);

    const { code, stdout, stderr } = await runCli([
      "--issue-json",
      issuePath,
      "--module-test-map",
      mapPath,
      "--slug",
      "status-em-lote",
      "--branch",
      "feat/485-status-em-lote",
      "--base",
      "main",
      "--worktree",
      "C:/Projetos/Vetor/.claude/worktrees/status-em-lote",
    ]);

    assertEquals(code, 0, stderr);
    const packet = JSON.parse(stdout) as ContextPacket;
    assertEquals(packet.$schema, CONTEXT_PACKET_SCHEMA);
    assertEquals(packet.issue.number, 485);
    assertEquals(packet.issue.acceptanceCriteria, ["Retornar JSON"]);
    assertEquals(packet.context.module, "cli");
    assertEquals(packet.context.testCommand, "cd cli && npm test");
    assertEquals(packet.context.targetFiles, ["cli/status.ts"]);
    assertEquals(packet.worktree.baseBranch, "main");
    assertEquals(packet.worktree.path, "C:/Projetos/Vetor/.claude/worktrees/status-em-lote");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CLI context-packet sem --worktree omite o path e --target-files substitui a inferência", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const issuePath = `${dir}/issue.json`;
    const mapPath = `${dir}/module-test-map.md`;
    await Deno.writeTextFile(
      issuePath,
      JSON.stringify({ number: 9, title: "chore: x", body: null }),
    );
    await Deno.writeTextFile(mapPath, MODULE_TEST_MAP);

    const { code, stdout, stderr } = await runCli([
      "--issue-json",
      issuePath,
      "--module-test-map",
      mapPath,
      "--slug",
      "x",
      "--branch",
      "chore/9-x",
      "--base",
      "master",
      "--target-files",
      "site/index.md, site/a.md",
    ]);

    assertEquals(code, 0, stderr);
    const packet = JSON.parse(stdout) as ContextPacket;
    assertEquals("path" in packet.worktree, false);
    assertEquals(packet.context.targetFiles, ["site/index.md", "site/a.md"]);
    assertEquals(packet.context.module, "docs-site");
    assertEquals(packet.issue.acceptanceCriteria, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// Repositório de verdade para o CLI gerar o Repo Map: cli/ é o módulo-alvo, scripts/ é o catch-all.
const REPO_FILES: Record<string, string> = {
  "cli/status.ts":
    'import { fmt } from "./format.ts";\nexport function status(): string { return fmt("ok"); }\n',
  "cli/format.ts": "export function fmt(text: string): string { return text; }\n",
  "scripts/other.ts": "export const OTHER = 1;\n",
};

async function withIssueFixture(
  fn: (paths: { dir: string; repo: string; issuePath: string; mapPath: string }) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    const repo = `${dir}/repo`;
    for (const [path, content] of Object.entries(REPO_FILES)) {
      await Deno.mkdir(`${repo}/${path.slice(0, path.lastIndexOf("/"))}`, { recursive: true });
      await Deno.writeTextFile(`${repo}/${path}`, content);
    }
    const issuePath = `${dir}/issue.json`;
    const mapPath = `${dir}/module-test-map.md`;
    await Deno.writeTextFile(
      issuePath,
      JSON.stringify({
        number: 507,
        title: "feat(cli): status",
        body: "Alterar `cli/status.ts`.\n- [ ] Retornar JSON",
      }),
    );
    await Deno.writeTextFile(mapPath, MODULE_TEST_MAP);
    await fn({ dir, repo, issuePath, mapPath });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function packetArgs(issuePath: string, mapPath: string): string[] {
  return [
    "--issue-json",
    issuePath,
    "--module-test-map",
    mapPath,
    "--slug",
    "status",
    "--branch",
    "feat/507-status",
    "--base",
    "master",
  ];
}

Deno.test("CLI context-packet --repo-root anexa o Repo Map escopado em context.repoMap", async () => {
  await withIssueFixture(async ({ repo, issuePath, mapPath }) => {
    const { code, stdout, stderr } = await runCli([
      ...packetArgs(issuePath, mapPath),
      "--repo-root",
      repo,
    ]);

    assertEquals(code, 0, stderr);
    const packet = JSON.parse(stdout) as ContextPacket;
    const repoMap = packet.context.repoMap;
    assert(repoMap, "context.repoMap presente no payload serializado");
    assertMatch(repoMap, /### cli\/status\.ts/);
    assertMatch(repoMap, /export function status\(\): string \{ \.\.\. \}/);
    assertEquals(repoMap.includes("return fmt"), false, "corpos de função ficam de fora");
    assert(
      repoMap.indexOf("### cli/status.ts") < repoMap.indexOf("### scripts/other.ts"),
      "o arquivo-alvo vem antes do que está fora do módulo",
    );
  });
});

Deno.test("CLI context-packet sem --repo-root não gera nem anexa o mapa", async () => {
  await withIssueFixture(async ({ issuePath, mapPath }) => {
    const { code, stdout, stderr } = await runCli(packetArgs(issuePath, mapPath));

    assertEquals(code, 0, stderr);
    assertEquals("repoMap" in (JSON.parse(stdout) as ContextPacket).context, false);
  });
});

Deno.test("CLI context-packet --format prompt emite o bloco json e a tag <repo_map>", async () => {
  await withIssueFixture(async ({ repo, issuePath, mapPath }) => {
    const { code, stdout, stderr } = await runCli([
      ...packetArgs(issuePath, mapPath),
      "--repo-root",
      repo,
      "--format",
      "prompt",
    ]);

    assertEquals(code, 0, stderr);
    assert(stdout.startsWith("```json\n"), stdout);
    // O módulo (cli/) vem primeiro; scripts/other.ts, de fora dele, só depois.
    assertMatch(
      stdout,
      /\n<repo_map>\n### cli\/[\s\S]*### cli\/status\.ts[\s\S]*### scripts\/other\.ts/,
    );
    assert(stdout.trimEnd().endsWith("</repo_map>"), stdout);
    const json = stdout.match(/^```json\n([\s\S]*?)\n```/);
    assert(json, "bloco json presente");
    assertEquals("repoMap" in JSON.parse(json[1]).context, false);
  });
});

Deno.test("CLI context-packet segue sem o mapa e avisa quando o --repo-root é inutilizável", async () => {
  await withIssueFixture(async ({ dir, issuePath, mapPath }) => {
    const { code, stdout, stderr } = await runCli([
      ...packetArgs(issuePath, mapPath),
      "--repo-root",
      `${dir}/nao-existe`,
    ]);

    assertEquals(code, 0, stderr);
    assertEquals("repoMap" in (JSON.parse(stdout) as ContextPacket).context, false);
    assertMatch(stderr, /repo-map/);
  });
});

// Issue #534: módulo catch-all com alvos que não são fonte mapeada não ganha um mapa global.
async function runDocsCli(
  body: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  let result = { code: -1, stdout: "", stderr: "" };
  await withIssueFixture(async ({ dir, repo, mapPath }) => {
    const issuePath = `${dir}/docs-issue.json`;
    await Deno.writeTextFile(
      issuePath,
      JSON.stringify({ number: 534, title: "docs: ajustar skill", body }),
    );
    result = await runCli([
      ...packetArgs(issuePath, mapPath),
      "--repo-root",
      repo,
      "--format",
      "prompt",
    ]);
  });
  return result;
}

Deno.test("CLI context-packet omite o Repo Map e avisa quando o módulo é catch-all e nenhum alvo é fonte", async () => {
  const { code, stdout, stderr } = await runDocsCli("Alterar `skills/x.md` e `README.md`.");

  assertEquals(code, 0, stderr);
  assertEquals(stdout.includes("<repo_map>"), false, stdout);
  assertMatch(stderr, /repo-map omitido/);
});

Deno.test("CLI context-packet mantém o Repo Map no catch-all quando algum alvo é fonte", async () => {
  const { code, stdout, stderr } = await runDocsCli(
    "Alterar `skills/x.md` e `scripts/other.ts`.",
  );

  assertEquals(code, 0, stderr);
  assertMatch(stdout, /<repo_map>/);
});

Deno.test("CLI context-packet rejeita --format desconhecido", async () => {
  await withIssueFixture(async ({ issuePath, mapPath }) => {
    const { code, stderr } = await runCli([...packetArgs(issuePath, mapPath), "--format", "xml"]);

    assertEquals(code, 1);
    assertMatch(stderr, /--format/);
  });
});

Deno.test("CLI context-packet recusa número de issue com caracteres de shell", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const mapPath = `${dir}/module-test-map.md`;
    await Deno.writeTextFile(mapPath, MODULE_TEST_MAP);

    const { code, stderr } = await runCli([
      "--issue",
      "12; rm -rf /",
      "--module-test-map",
      mapPath,
      "--slug",
      "x",
      "--branch",
      "fix/12-x",
      "--base",
      "master",
    ]);

    assertEquals(code, 1);
    assertMatch(stderr, /--issue/);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("CLI context-packet sai com erro quando falta flag obrigatória", async () => {
  const { code, stderr } = await runCli(["--slug", "x"]);

  assertEquals(code, 1);
  assertMatch(stderr, /--module-test-map|--branch|--base|--issue/);
});
