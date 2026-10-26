import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";
import { buildEjectionComment, parseFailAnalysis, sanitizeDiagnostic } from "../lib/ejection.ts";
import { dropDecision, loadInbox, suspendBlocked } from "../lib/decision-inbox.ts";
import { run } from "../lib/project.ts";

// Issue #501 (RF-05 de docs/specs/autonomia-continua-e-desacoplamento-interativo.md): comentário
// diagnóstico da ejeção graciosa. O texto vai a uma issue pública, então não pode vazar path local
// nem mencionar usuários por acidente.

const CLI = fileURLToPath(new URL("../eject-comment.ts", import.meta.url));
const DECISION_CLI = fileURLToPath(new URL("../decision-inbox.ts", import.meta.url));

const FAIL_ANALYSIS = `# Handover de Falha — Vetor

O agente de correção automática falhou após 5 iterações.

## Detalhes
* **Módulo**: root
* **Comando de Teste**: \`deno task test\`

## Último Erro de Teste
\`\`\`
error: Uncaught (in promise) Error: boom
    at C:\\Projetos\\Vetor\\.claude\\worktrees\\agent-1\\scripts\\lib\\cache.ts:12:3
    at /home/dev/projeto/scripts/lib/cache.ts:12:3
import { assert } from "jsr:@std/assert";
\`\`\`

## Hipóteses Consideradas
1. Iteração 1: cache sem TTL — refutada
2. Iteração 2: driver não conecta — refutada

## Fixes Tentados (Commits locais)
1. fix: ajusta TTL
2. fix: reconecta driver

## Próximo Passo Sugerido (Humano)
Verificar a configuração do driver e o @mantenedor deve decidir o fallback.
`;

Deno.test("issue #501: parseFailAnalysis separa as seções do FAIL_ANALYSIS.md", () => {
  const parsed = parseFailAnalysis(FAIL_ANALYSIS);
  assertEquals(parsed.testCommand, "deno task test");
  assertStringIncludes(parsed.lastError, "Error: boom");
  assertEquals(parsed.hypotheses.length, 2);
  assertEquals(parsed.fixes, ["fix: ajusta TTL", "fix: reconecta driver"]);
  assertStringIncludes(parsed.nextStep, "driver");
});

Deno.test("issue #501: parseFailAnalysis tolera arquivo sem as seções", () => {
  const parsed = parseFailAnalysis("texto livre\n");
  assertEquals(parsed.testCommand, "");
  assertEquals(parsed.lastError, "");
  assertEquals(parsed.hypotheses, []);
});

Deno.test("issue #501: sanitizeDiagnostic tira paths absolutos locais e mantém os relativos", () => {
  const roots = ["C:/Projetos/Vetor", "/home/dev/projeto"];
  const out = sanitizeDiagnostic(
    [
      "at C:\\Projetos\\Vetor\\.claude\\worktrees\\agent-1\\scripts\\lib\\cache.ts:12:3",
      "at C:/Projetos/Vetor/scripts/lib/cache.ts:12:3",
      "at /home/dev/projeto/scripts/lib/cache.ts:12:3",
      "at /Users/maria/outro/lugar/a.ts:1:1",
      "em scripts/lib/cache.ts:12",
    ].join("\n"),
    roots,
  );
  assertEquals(out.includes("C:\\"), false);
  assertEquals(out.includes("/home/"), false);
  assertEquals(out.includes("/Users/"), false);
  assertEquals(out.includes("Projetos"), false);
  assertStringIncludes(out, "scripts/lib/cache.ts:12:3");
  assertStringIncludes(out, "em scripts/lib/cache.ts:12");
});

Deno.test("issue #501: o comentário de FAILED_MAX_ITERATIONS traz tentativas, comando, log e próximo passo", () => {
  const comment = buildEjectionComment({
    kind: "failed-max-iterations",
    issueNumber: 488,
    branch: "feat/488-cache-redis",
    commits: ["abc1234 fix: ajusta TTL", "def5678 fix: reconecta driver"],
    remotePublished: false,
    failAnalysis: FAIL_ANALYSIS,
    roots: ["C:/Projetos/Vetor", "/home/dev/projeto"],
  });

  assertStringIncludes(comment, "Ejeção graciosa");
  assertStringIncludes(comment, "FAILED_MAX_ITERATIONS");
  assertStringIncludes(comment, "`feat/488-cache-redis`");
  assertMatch(comment, /só local/);
  assertStringIncludes(comment, "git push -u origin feat/488-cache-redis");
  assertStringIncludes(comment, "abc1234 fix: ajusta TTL");
  assertStringIncludes(comment, "deno task test");
  assertStringIncludes(comment, "cache sem TTL");
  assertStringIncludes(comment, "Error: boom");
  assertStringIncludes(comment, "Verificar a configuração do driver");
  // sem path local e sem menção acidental a usuário fora de bloco de código
  assertEquals(/[A-Za-z]:[\\/]/.test(comment), false);
  assertEquals(comment.includes("/home/dev"), false);
  const prose = comment.replace(/```[\s\S]*?```/g, "");
  assertEquals(/@\w/.test(prose), false, "menção a usuário no texto corrido notificaria alguém");
});

Deno.test("issue #501: o log do erro é cortado nas últimas linhas e não quebra o bloco de código", () => {
  const longLog = Array.from({ length: 200 }, (_, i) => `linha ${i + 1}`).join("\n");
  const comment = buildEjectionComment({
    kind: "failed-max-iterations",
    issueNumber: 1,
    branch: "fix/1-x",
    commits: [],
    remotePublished: true,
    failAnalysis: `## Último Erro de Teste\n\`\`\`\n${longLog}\n\`\`\`\n`,
    roots: [],
  });
  assertStringIncludes(comment, "linha 200");
  assertEquals(comment.includes("linha 100\n"), false);
  assertStringIncludes(comment, "origin/fix/1-x");
  // o miolo do log não pode conter uma cerca de código que feche o bloco antes da hora
  const withFence = buildEjectionComment({
    kind: "failed-max-iterations",
    issueNumber: 1,
    branch: "fix/1-x",
    commits: [],
    remotePublished: true,
    failAnalysis: "## Último Erro de Teste\n```\nantes\n'''\ndepois\n```\n",
    roots: [],
  });
  assertEquals((withFence.match(/^```/gm) ?? []).length % 2, 0);
});

Deno.test("issue #501: o comentário de bloqueio sem resposta traz Blocked on, opções e recomendação", () => {
  const comment = buildEjectionComment({
    kind: "blocked-timeout",
    issueNumber: 488,
    branch: "feat/488-cache-redis",
    commits: [],
    remotePublished: false,
    blocked: {
      reason: "Ambiguidade no driver de conexão",
      options: ["Usar cliente nativo", "Adaptador genérico"],
      recommendation: "1 — o cliente nativo já está nas dependências",
    },
    roots: [],
  });
  assertStringIncludes(comment, "bloqueio sem resposta");
  assertStringIncludes(comment, "Ambiguidade no driver de conexão");
  assertStringIncludes(comment, "1. Usar cliente nativo");
  assertStringIncludes(comment, "o cliente nativo já está nas dependências");
});

Deno.test("issue #501: dropDecision remove a pendência da inbox sem mexer no status file", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
    const statusFile = `${root}/.claude/vetor/status/feat-488-cache-redis.md`;
    await Deno.writeTextFile(
      statusFile,
      "# Agent Status — feat/488-cache-redis\nStatus: BLOCKED_WAITING\n" +
        "Iteration: 2/5 (Issue #488)\nBlocked on: dúvida\nOptions:\n1. a\n2. b\nRecommendation: 1\n",
    );
    suspendBlocked({ root, statusFile, worktreePath: "/w" });
    assertEquals(loadInbox(root).pendingDecisions.length, 1);

    const before = await Deno.readTextFile(statusFile);
    const dropped = dropDecision(root, "dec-issue-488");

    assertEquals(dropped.issueNumber, 488);
    assertEquals(loadInbox(root).pendingDecisions, []);
    assertEquals(await Deno.readTextFile(statusFile), before);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("issue #501: a CLI drop remove a pendência pelo id", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
    const statusFile = `${root}/.claude/vetor/status/feat-488-cache-redis.md`;
    await Deno.writeTextFile(
      statusFile,
      "# Agent Status — feat/488-cache-redis\nStatus: BLOCKED_WAITING\n" +
        "Iteration: 2/5 (Issue #488)\nBlocked on: dúvida\nOptions:\n1. a\n2. b\nRecommendation: 1\n",
    );
    suspendBlocked({ root, statusFile, worktreePath: "/w" });

    const drop = await run(
      "deno",
      ["run", "-A", DECISION_CLI, "drop", "--root", root, "--id", "dec-issue-488"],
      root,
    );
    assertEquals(drop.code, 0, drop.stderr);
    assertEquals(JSON.parse(drop.stdout).id, "dec-issue-488");
    assertEquals(loadInbox(root).pendingDecisions, []);

    const missing = await run(
      "deno",
      ["run", "-A", DECISION_CLI, "drop", "--root", root, "--id", "dec-issue-488"],
      root,
    );
    assertEquals(missing.code, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("issue #501: a CLI eject-comment monta o comentário a partir do repositório", async () => {
  const root = await Deno.makeTempDir();
  try {
    await run("git", ["init", "-q", "-b", "main"], root);
    await run("git", ["config", "user.email", "test@example.com"], root);
    await run("git", ["config", "user.name", "Test"], root);
    await run("git", ["commit", "-q", "--allow-empty", "-m", "init"], root);
    await run("git", ["checkout", "-q", "-b", "feat/488-cache-redis"], root);
    await run("git", ["commit", "-q", "--allow-empty", "-m", "fix: ajusta TTL"], root);
    await run("git", ["checkout", "-q", "main"], root);
    const failAnalysis = `${root}/FAIL_ANALYSIS.md`;
    await Deno.writeTextFile(failAnalysis, FAIL_ANALYSIS.replaceAll("C:\\Projetos\\Vetor", root));

    const result = await run(
      "deno",
      [
        "run",
        "-A",
        CLI,
        "--root",
        root,
        "--issue",
        "488",
        "--branch",
        "feat/488-cache-redis",
        "--base",
        "main",
        "--kind",
        "failed-max-iterations",
        "--fail-analysis",
        failAnalysis,
      ],
      root,
    );

    assertEquals(result.code, 0, result.stderr);
    assertStringIncludes(result.stdout, "fix: ajusta TTL");
    assertStringIncludes(result.stdout, "só local");
    assertStringIncludes(result.stdout, "Error: boom");
    assert(!result.stdout.includes(root), "o path local do repositório vazou no comentário");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("issue #501: a CLI eject-comment recusa tipo desconhecido e número de issue inválido", async () => {
  const base = ["run", "-A", CLI, "--root", Deno.cwd(), "--branch", "feat/1-x", "--base", "main"];
  const badKind = await run("deno", [...base, "--issue", "1", "--kind", "qualquer"], Deno.cwd());
  assertEquals(badKind.code, 1);
  const badIssue = await run(
    "deno",
    [...base, "--issue", "1; rm -rf /", "--kind", "blocked-timeout"],
    Deno.cwd(),
  );
  assertEquals(badIssue.code, 1);
});
