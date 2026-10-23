import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
const reference = await Deno.readTextFile(
  new URL("skills/shared/references/delegate-to-runtime.md", root),
);
const mcpAvailability = await Deno.readTextFile(
  new URL("skills/shared/references/mcp-availability.md", root),
);

/** Recorta a seção que começa em `heading` até o próximo título de nível igual ou maior. */
function section(text: string, heading: string): string {
  const start = text.indexOf(heading);
  assert(start >= 0, `seção ausente: ${heading}`);
  const level = heading.match(/^#+/)![0].length;
  const rest = text.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next === -1 ? text.slice(start) : text.slice(start, start + heading.length + next);
}

/** Normaliza quebras de linha (CRLF no Windows) e espaços para comparar trechos em prosa. */
const squash = (text: string) => text.replace(/\s+/g, " ");

Deno.test("issues #431 e #434: invocações isolam OpenCode e documentam Codex", () => {
  assertStringIncludes(reference, '`opencode run --agent plan "<prompt>"`');
  assertStringIncludes(reference, "Para OpenCode, `$DELEGATE` é");
  assertStringIncludes(
    reference,
    "`opencode run --agent plan`; para Codex, `codex exec -s read-only`",
  );
  assertStringIncludes(
    reference,
    "compare `git status --porcelain` antes e depois de cada delegação",
  );
  assertStringIncludes(reference, "resposta venha somente pelo stdout");
  assertStringIncludes(reference, "não é um sandbox para comandos shell");
  assertStringIncludes(reference, '`codex exec -s read-only "<prompt>"`');
  assertStringIncludes(reference, "codex-cli 0.163.0");
  assertStringIncludes(reference, "**Confirmado empiricamente** (codex-cli 0.163.0, 2026-10-21)");
  assertStringIncludes(reference, "`--agent plan` deixou `git status --porcelain` inalterado");
  assertStringIncludes(reference, "stdin is appended as a `<stdin>` block");
  assertStringIncludes(reference, "--sandbox");
  assertStringIncludes(reference, "danger-full-access");
});

const delegationHeading = "## 6. Delegação ao Orquestrador MCP (Alethe)";

Deno.test("issue #480: mcp-availability documenta o sinal mcp__alethe__* e a ausência de sinal fora do harness", () => {
  const text = squash(section(mcpAvailability, "### Orquestrador de agentes (Alethe)"));
  assertStringIncludes(text, "`mcp__alethe__*`");
  assertStringIncludes(text, "mcp__plugin_<plugin>_alethe__*");
  assertStringIncludes(text, "Só o namespace");
  assertStringIncludes(text, "Nenhuma variável de ambiente do Alethe foi observada");
  assertStringIncludes(text, "2026-10-23");
  assertStringIncludes(text, '`delegation.preferredRuntime: "alethe"`');
  assertStringIncludes(text, "`timeoutMs <= 50000`");
  assertStringIncludes(text, "`alethe_release` antes de remover o worktree");
});

Deno.test("issue #480: §6 trata o Alethe como runtime MCP com schema observado", () => {
  const text = squash(section(reference, delegationHeading));
  assertStringIncludes(text, "é um tipo de runtime (`mcp`)");
  assertStringIncludes(text, '{ "delegation": { "preferredRuntime": "alethe" } }');
  assertStringIncludes(text, "sonda real ao Alethe em 2026-10-23 (job-67)");
  assertStringIncludes(text, "não são garantias universais do serviço");
  for (
    const piece of [
      "`alethe_delegate`",
      "tasks: string[]",
      "runningInParallel",
      "concurrencyLimit",
      "jobs: [{ id, spec, worktree }]",
      "`alethe_check`",
      "untilAllSettled",
      "deliveries: [{ seq, type: 'worker_done', jobId, outcome: 'succeeded', text }]",
      "workersStillBusy",
      "`alethe_release`",
      "`alethe_cancel`",
      "{ jobIds: string[] }",
      "{ released: [ids] }",
    ]
  ) assertStringIncludes(text, piece);
  // O bloco antigo de preferência não tinha consumidor: a chave é só delegation.preferredRuntime
  assertEquals(/"orchestrator"\s*:/.test(reference), false);
  assertEquals(reference.includes("delegation.orchestrator"), false);
});

Deno.test("issue #480: §2 inclui o runtime MCP no algoritmo de seleção sem escolhê-lo em silêncio", () => {
  const text = squash(section(reference, "## 2. Algoritmo de seleção"));
  assertStringIncludes(text, "`preferred` é um runtime MCP detectado na sessão");
  assertStringIncludes(text, "sem buscar binário no PATH");
  assertStringIncludes(text, "Runtimes MCP nunca entram na escolha sem preferência");
});

Deno.test("issue #481: o algoritmo documenta mcpAvailable e a escolha só por preferência", () => {
  const algorithm = squash(section(reference, "## 2. Algoritmo de seleção"));
  assertStringIncludes(
    algorithm,
    "selectDelegationRuntime({ available, mcpAvailable, preferred, interactive });",
  );
  assertStringIncludes(algorithm, "só os escolhe quando coincidem com `preferred`");
  const detection = squash(section(reference, "### 6.1. Detecção e seleção"));
  assertStringIncludes(detection, 'informa `mcpAvailable: ["alethe"]`');
  assertStringIncludes(
    detection,
    "Sem a preferência, `selectDelegationRuntime` nunca escolhe o orquestrador em silêncio",
  );
});

Deno.test("issue #481: /vetor:now cita o Alethe quando mcp__alethe__* está ativo e registra o probe como não implementado", async () => {
  const now = squash(await Deno.readTextFile(new URL("skills/now/SKILL.md", root)));
  assertStringIncludes(now, "cite o Alethe quando `mcp__alethe__*` estiver ativo na sessão");
  assertStringIncludes(now, "Se `mcp__alethe__*` estiver ativo: **Use o orquestrador Alethe");
  assertStringIncludes(now, "`delegation.preferredRuntime` é `alethe`");
  assertStringIncludes(now, "sem a preferência, não o escolha em silêncio");
  assertStringIncludes(now, "A detecção de orquestrador no probe não está implementada");
  assertEquals(now.includes("`orchestrators`"), false);
});

Deno.test("issue #480: cada regra do contrato prático traz fonte e data", () => {
  const rows = section(reference, "### 6.3. Contrato prático")
    .split(/\r?\n/)
    .filter((line) => /^\| \d+ \|/.test(line));
  assertEquals(rows.length, 10);
  for (const row of rows) {
    const cells = row.split("|").map((cell) => cell.trim()).filter(Boolean);
    assertEquals(cells.length, 3, row);
    assertMatch(cells[2], /\d{4}-\d{2}-\d{2}/, `regra sem data na fonte: ${row}`);
  }
});

Deno.test("issue #480: o contrato prático documenta os limites do Alethe", () => {
  const text = squash(section(reference, "### 6.3. Contrato prático"));
  for (
    const piece of [
      // 1: uma chamada por grupo, cwd sempre
      "**Uma chamada `alethe_delegate` por grupo.**",
      "O `cwd` vale para a chamada inteira e é o worktree do grupo: passe-o sempre",
      "`isolate needs a git repository`",
      // 2: concorrência pelo valor devolvido
      "use o `concurrencyLimit` devolvido por `alethe_delegate`; não fixe um número",
      "Valor 4 observado na sonda de 2026-10-23 (job-67)",
      // 3: tarefa autocontida com o texto da issue
      "`tasks` leva o texto integral da issue",
      // 4 e 5: proibições no worker e testes no host
      "git que escreva (`checkout`, `add`, `commit`, `push`), `gh`, rede e editar o status file",
      "**Suítes e testes empíricos rodam no host.**",
      "`dubious ownership`",
      // 6: espera máxima do alethe_check
      "**`alethe_check` com `timeoutMs <= 50000`.**",
      "Esperas de 90 s ou mais estouraram o timeout MCP",
      // 7: release antes de remover o worktree
      "**`alethe_release` antes de remover o worktree**",
      "`Permission denied` no Windows (observado em 2026-10-22)",
      // 8: o diff é rascunho
      "**O diff é rascunho:**",
      // 9: limite de uso do Codex
      "`outcome: succeeded` com `text` vazio e `tokens: null`",
      "diagnostique com `codex exec` no host",
      // 10: sem retry
      "**Sem retry automático:**",
    ]
  ) assertStringIncludes(text, piece);
});

async function listFiles(directory: URL): Promise<URL[]> {
  const files: URL[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const child = new URL(entry.name + (entry.isDirectory ? "/" : ""), directory);
    if (entry.isDirectory) files.push(...await listFiles(child));
    else files.push(child);
  }
  return files;
}

Deno.test("issue #486: o Alethe é o único orquestrador com adaptador e menção nas skills", async () => {
  const adapters = [];
  for await (const entry of Deno.readDir(new URL("scripts/lib/orchestrator/adapters/", root))) {
    adapters.push(entry.name);
  }
  assertEquals(adapters, ["alethe.ts"]);

  // Orca, o adaptador genérico e as variáveis de ambiente não tinham fonte (sonda de 2026-10-23)
  const unsourced =
    /orca|generic-?mcp|ALETHE_ORCHESTRATOR|ALETHE_SESSION_ID|ORCA_|delegation\.custom/i;
  const offenders: string[] = [];
  for (const file of await listFiles(new URL("skills/", root))) {
    if (!file.pathname.endsWith(".md")) continue;
    const match = unsourced.exec(await Deno.readTextFile(file));
    if (match) offenders.push(`${file.pathname}: ${match[0]}`);
  }
  assertEquals(offenders, []);
});
