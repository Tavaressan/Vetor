// Contrato da injeção do Repo Map escopado (RF-04 de docs/specs/repo-map-ast-context-packet.md,
// issue #507): o coordinator gera o mapa no ContextPacket, o worker o recebe na tag <repo_map> e o
// /vetor:fix o consome no diagnóstico. Skills e agentes são prosa lida por um modelo, então o
// contrato é travado por asserções sobre o texto. O comportamento do código (repoMap no payload,
// renderização da tag) é coberto por context-packet_test.ts e repo-map_test.ts.

import { assert, assertFalse, assertMatch, assertStringIncludes } from "@std/assert";

const root = new URL("../../", import.meta.url);
// O checkout no Windows pode trazer CRLF; normaliza para as regex.
const read = async (path: string) =>
  (await Deno.readTextFile(new URL(path, root))).replaceAll("\r\n", "\n");

const dispatchRef = await read("skills/shared/references/issue-coordinator-dispatch.md");
const coordinatorSkill = await read("skills/coordinator/SKILL.md");
const issueWorker = await read("agents/issue-worker.md");
const codexWorker = await read("agents/issue-worker/codex.toml");
const opencodeWorker = await read("opencode/agent/issue-worker.md");
const fixSkill = await read("skills/fix/SKILL.md");

function section(document: string, from: string, to: string): string {
  const start = document.indexOf(from);
  assert(start >= 0, `seção não encontrada: ${from}`);
  const end = document.indexOf(to, start + from.length);
  return document.slice(start, end === -1 ? undefined : end);
}

const repoMapSection = section(
  dispatchRef,
  "### Repo Map escopado",
  "### Dispatch do ship-worker",
);

Deno.test("dispatch: documenta a geração do Repo Map no pacote e a tag <repo_map> no prompt", () => {
  assertStringIncludes(repoMapSection, "<repo_map>");
  assertStringIncludes(repoMapSection, "--repo-root");
  assertStringIncludes(repoMapSection, "--format prompt");
  assertStringIncludes(repoMapSection, "context.repoMap");
  assertStringIncludes(repoMapSection, "scripts/repo-map.ts");
  // O root vem de vetor-checks.sh repo-root, nunca do cwd (#160), e é onde mora o cache.
  assertStringIncludes(repoMapSection, "$REPO_ROOT");
  assertMatch(repoMapSection, /cache/i);
});

Deno.test("dispatch: o mapa é dica sujeita a defasagem e falhar na geração não bloqueia o dispatch", () => {
  assertMatch(repoMapSection, /defas|desatualiz/i);
  assertMatch(repoMapSection, /sem o mapa|sem o campo|omit/i);
});

Deno.test("dispatch: documenta como medir a meta de -40% em tool calls e a mantém não verificada", () => {
  assertStringIncludes(repoMapSection, "40%");
  assertMatch(repoMapSection, /tool calls/i);
  assertMatch(repoMapSection, /5 primeiros turnos/);
  assertMatch(repoMapSection, /não verificad/i);
});

Deno.test("dispatch: o prompt do worker inclui o Repo Map no passo do ContextPacket", () => {
  const contextPacketStep = section(dispatchRef, "8. **ContextPacket", "### ContextPacket");
  assertStringIncludes(contextPacketStep, "<repo_map>");
});

Deno.test("coordinator Fase 4: manda anexar o Repo Map ao abrir o prompt do worker", () => {
  const phase4 = section(
    coordinatorSkill,
    "### 4 — Fase de desenvolvimento",
    "### 5 — Monitoramento",
  );
  assertStringIncludes(phase4, "<repo_map>");
  assertStringIncludes(phase4, "--repo-root");
});

Deno.test("issue-worker: lê o mapa da tag <repo_map> antes de explorar e confere com Read antes de editar", () => {
  for (const [name, text] of [["claude", issueWorker], ["opencode", opencodeWorker]]) {
    assertStringIncludes(text, "<repo_map>", `${name}: precisa citar a tag <repo_map>`);
  }
  assertStringIncludes(codexWorker, "<repo_map>");
  // Não substitui a leitura do arquivo: o mapa só tem assinaturas e pode estar defasado.
  assertMatch(issueWorker, /<repo_map>[\s\S]{0,700}Read/);
  assertMatch(issueWorker, /assinaturas/);
});

Deno.test("fix Fase 1: aciona o Repo Map do módulo da falha, com map e cache do root", () => {
  const phase1 = section(fixSkill, "### 1 — Diagnóstico", "### 2 — Status file");
  assertStringIncludes(phase1, "scripts/repo-map.ts");
  assertStringIncludes(phase1, "--module");
  assertStringIncludes(phase1, "--module-test-map");
  assertStringIncludes(phase1, "--cache-path");
  assertStringIncludes(phase1, "$REPO_ROOT");
  assertStringIncludes(phase1, "<repo_map>");
  assertMatch(phase1, /sem ler arquivos inteiros|antes de (abrir|ler)/i);
});

Deno.test("fix §3.a (passo de testes da #514) não menciona o Repo Map", () => {
  const step = section(fixSkill, "**3.a — Executar testes**", "**3.b — Avaliar resultado**");
  assertFalse(step.includes("repo-map"), "o Repo Map é do diagnóstico (Fase 1), não do passo 3.a");
});
