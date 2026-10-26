import { assert, assertEquals, assertMatch, assertStringIncludes, assertThrows } from "@std/assert";
import { fileURLToPath } from "node:url";
import {
  checkpointTagName,
  createCheckpointTag,
  expiredDecisions,
  inboxPath,
  loadInbox,
  parseBlockedStatus,
  rebuildInbox,
  resolveDecision,
  suspendBlocked,
} from "../lib/decision-inbox.ts";
import { run } from "../lib/project.ts";
import { isTerminal } from "../lib/status.ts";

// Issue #500 (RF-03/RF-04 de docs/specs/autonomia-continua-e-desacoplamento-interativo.md).

const CLI = fileURLToPath(new URL("../decision-inbox.ts", import.meta.url));
const NOW = new Date("2026-10-26T17:40:00Z");

const BLOCKED = `# Agent Status — feat/488-cache-redis
Updated: 2026-10-26T17:30:00Z
Status: BLOCKED_WAITING
Iteration: 2/5 (Issue #488)
Last action: Aguardando decisão sobre o driver
Next: implementar o adaptador de cache
Blocked on: Ambiguidade no driver de conexão
Options:
1. Usar biblioteca nativa redis-client
2. Implementar adaptador genérico sobre interface de cache
3. Pular módulo e manter mock em memória
Recommendation: 1 — o cliente nativo já está nas dependências
`;

async function makeRoot(): Promise<string> {
  const root = await Deno.makeTempDir();
  await run("git", ["init", "-q", "-b", "main"], root);
  await run("git", ["config", "user.email", "test@example.com"], root);
  await run("git", ["config", "user.name", "Test"], root);
  await run("git", ["commit", "-q", "--allow-empty", "-m", "init"], root);
  await Deno.mkdir(`${root}/.claude/vetor/status`, { recursive: true });
  return root;
}

async function writeStatus(root: string, name: string, content: string): Promise<string> {
  const path = `${root}/.claude/vetor/status/${name}.md`;
  await Deno.writeTextFile(path, content);
  return path;
}

async function withRoot(fn: (root: string) => void | Promise<void>): Promise<void> {
  const root = await makeRoot();
  try {
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("issue #500: parseBlockedStatus lê motivo, opções, recomendação, issue e branch", () => {
  const parsed = parseBlockedStatus(BLOCKED);
  assert(parsed !== null);
  assertEquals(parsed.branch, "feat/488-cache-redis");
  assertEquals(parsed.issueNumber, 488);
  assertEquals(parsed.reason, "Ambiguidade no driver de conexão");
  assertEquals(parsed.options.length, 3);
  assertEquals(parsed.options[0], "Usar biblioteca nativa redis-client");
  assertEquals(parsed.recommendedIndex, 0);
});

Deno.test("issue #500: a recomendação escolhe a opção pelo número no início do texto", () => {
  const parsed = parseBlockedStatus(
    BLOCKED.replace("Recommendation: 1 —", "Recommendation: opção 2 —"),
  );
  assertEquals(parsed?.recommendedIndex, 1);
  // sem número no início, cai na primeira opção
  const semNumero = parseBlockedStatus(
    BLOCKED.replace("Recommendation: 1 — o cliente", "Recommendation: o cliente"),
  );
  assertEquals(semNumero?.recommendedIndex, 0);
});

Deno.test("issue #500: parseBlockedStatus devolve null sem bloco 'Blocked on'", () => {
  assertEquals(parseBlockedStatus("Status: RUNNING\nIteration: 1/5 (Issue #1)\n"), null);
});

Deno.test("issue #500: suspendBlocked grava a inbox no schema da Spec e troca o status para SUSPENDED", async () => {
  await withRoot(async (root) => {
    const statusFile = await writeStatus(root, "feat-488-cache-redis", BLOCKED);

    const entry = suspendBlocked({
      root,
      statusFile,
      worktreePath: "/work/cache-redis",
      timeoutSeconds: 60,
      now: NOW,
    });

    assertEquals(entry.id, "dec-issue-488");
    assertEquals(entry.status, "AWAITING_INPUT");
    assertEquals(entry.timeoutSeconds, 60);

    const inbox = JSON.parse(await Deno.readTextFile(inboxPath(root)));
    assertEquals(inbox.sessionId, "coord-20261026-1740");
    assertEquals(inbox.pendingDecisions.length, 1);
    assertEquals(inbox.pendingDecisions[0], {
      id: "dec-issue-488",
      issueNumber: 488,
      branch: "feat/488-cache-redis",
      worktreePath: "/work/cache-redis",
      blockedAt: "2026-10-26T17:40:00.000Z",
      reason: "Ambiguidade no driver de conexão",
      options: [
        "Usar biblioteca nativa redis-client",
        "Implementar adaptador genérico sobre interface de cache",
        "Pular módulo e manter mock em memória",
      ],
      recommendedIndex: 0,
      timeoutSeconds: 60,
      status: "AWAITING_INPUT",
    });

    const status = await Deno.readTextFile(statusFile);
    assertMatch(status, /^Status: SUSPENDED$/m);
    // os blocos do bloqueio ficam no status file: dele a inbox pode ser reconstruída
    assertStringIncludes(status, "Blocked on: Ambiguidade no driver de conexão");
    assertStringIncludes(status, "2. Implementar adaptador genérico");
    assertStringIncludes(status, "Iteration: 2/5 (Issue #488)");
    assertStringIncludes(status, "Worktree: /work/cache-redis");
  });
});

Deno.test("issue #500: suspender duas vezes não duplica a decisão", async () => {
  await withRoot(async (root) => {
    const statusFile = await writeStatus(root, "feat-488-cache-redis", BLOCKED);
    const input = { root, statusFile, worktreePath: "/work/cache-redis", now: NOW };
    suspendBlocked(input);
    suspendBlocked(input);
    assertEquals(loadInbox(root, NOW).pendingDecisions.length, 1);
  });
});

Deno.test("issue #500: sem timeout configurado a decisão nunca expira (bloqueio de permissão)", async () => {
  await withRoot(async (root) => {
    const statusFile = await writeStatus(root, "feat-488-cache-redis", BLOCKED);
    const entry = suspendBlocked({
      root,
      statusFile,
      worktreePath: "/work/cache-redis",
      now: NOW,
    });
    assertEquals(entry.timeoutSeconds, null);
    const muitoDepois = new Date(NOW.getTime() + 24 * 3600 * 1000);
    assertEquals(expiredDecisions(loadInbox(root, NOW), muitoDepois), []);
  });
});

Deno.test("issue #500: suspendBlocked recusa status que não é BLOCKED_WAITING", async () => {
  await withRoot(async (root) => {
    const statusFile = await writeStatus(
      root,
      "feat-488-cache-redis",
      BLOCKED.replace("BLOCKED_WAITING", "RUNNING"),
    );
    assertThrows(
      () => suspendBlocked({ root, statusFile, worktreePath: "/w", now: NOW }),
      Error,
      "BLOCKED_WAITING",
    );
  });
});

Deno.test("issue #500: expiredDecisions só devolve o que passou do prazo de 60 s", async () => {
  await withRoot(async (root) => {
    const statusFile = await writeStatus(root, "feat-488-cache-redis", BLOCKED);
    suspendBlocked({ root, statusFile, worktreePath: "/w", timeoutSeconds: 60, now: NOW });
    const inbox = loadInbox(root, NOW);
    assertEquals(expiredDecisions(inbox, new Date(NOW.getTime() + 59_000)), []);
    assertEquals(expiredDecisions(inbox, new Date(NOW.getTime() + 60_000)).length, 1);
  });
});

Deno.test("issue #500: inbox corrompida ou apagada é recriada a partir dos status files SUSPENDED", async () => {
  await withRoot(async (root) => {
    const statusFile = await writeStatus(root, "feat-488-cache-redis", BLOCKED);
    suspendBlocked({
      root,
      statusFile,
      worktreePath: "/work/cache-redis",
      timeoutSeconds: 60,
      now: NOW,
    });

    await Deno.writeTextFile(inboxPath(root), "{ isto não é json");
    let recovered = loadInbox(root, NOW);
    assertEquals(recovered.pendingDecisions.length, 1);
    assertEquals(recovered.pendingDecisions[0].worktreePath, "/work/cache-redis");
    assertEquals(recovered.pendingDecisions[0].timeoutSeconds, 60);
    assertEquals(recovered.pendingDecisions[0].blockedAt, "2026-10-26T17:40:00.000Z");
    // o arquivo recuperado já é válido
    JSON.parse(await Deno.readTextFile(inboxPath(root)));

    await Deno.remove(inboxPath(root));
    recovered = loadInbox(root, NOW);
    assertEquals(recovered.pendingDecisions.length, 1);
    assertEquals(rebuildInbox(root, NOW).pendingDecisions[0].id, "dec-issue-488");
  });
});

Deno.test("issue #500: loadInbox sem inbox e sem status SUSPENDED devolve lista vazia", async () => {
  await withRoot((root) => {
    assertEquals(loadInbox(root, NOW).pendingDecisions, []);
  });
});

Deno.test("issue #500: resolveDecision retoma o worker (RUNNING) e remove a pendência", async () => {
  await withRoot(async (root) => {
    const statusFile = await writeStatus(root, "feat-488-cache-redis", BLOCKED);
    suspendBlocked({ root, statusFile, worktreePath: "/w", now: NOW });

    const entry = resolveDecision({
      root,
      id: "dec-issue-488",
      decision: "Usar biblioteca nativa redis-client",
      now: new Date(NOW.getTime() + 5_000),
    });

    assertEquals(entry.issueNumber, 488);
    assertEquals(loadInbox(root, NOW).pendingDecisions, []);
    const status = await Deno.readTextFile(statusFile);
    assertMatch(status, /^Status: RUNNING$/m);
    assertStringIncludes(status, "Iteration: 2/5 (Issue #488)");
    assertStringIncludes(status, "Decisão humana: Usar biblioteca nativa redis-client");
    assert(!status.includes("Blocked on:"), "o bloqueio resolvido não pode ficar no status file");
    assert(!status.includes("Worktree:"));
  });
});

Deno.test("issue #500: avanço otimista registra a tag [OPTIMISTIC_DECISION] no status file", async () => {
  await withRoot(async (root) => {
    const statusFile = await writeStatus(root, "feat-488-cache-redis", BLOCKED);
    suspendBlocked({ root, statusFile, worktreePath: "/w", timeoutSeconds: 60, now: NOW });

    resolveDecision({
      root,
      id: "dec-issue-488",
      decision: "Usar biblioteca nativa redis-client (Recommended)",
      optimistic: true,
      checkpointTag: "_vetor_checkpoint_feat-488-cache-redis_20261026T174100Z",
      now: new Date(NOW.getTime() + 61_000),
    });

    const status = await Deno.readTextFile(statusFile);
    assertStringIncludes(status, "[OPTIMISTIC_DECISION]");
    assertStringIncludes(status, "_vetor_checkpoint_feat-488-cache-redis_20261026T174100Z");
  });
});

Deno.test("issue #500: resolver uma decisão inexistente falha sem tocar nos arquivos", async () => {
  await withRoot((root) => {
    assertThrows(
      () => resolveDecision({ root, id: "dec-issue-1", decision: "x", now: NOW }),
      Error,
      "dec-issue-1",
    );
  });
});

Deno.test("issue #500: o nome do checkpoint é um ref git válido, mesmo com '/' na branch", async () => {
  const name = checkpointTagName("feat/488-cache-redis", NOW);
  assertEquals(name, "_vetor_checkpoint_feat-488-cache-redis_20261026T174000Z");
  const check = await run("git", ["check-ref-format", `refs/tags/${name}`], Deno.cwd());
  assertEquals(check.code, 0, check.stderr);
});

Deno.test("issue #500: createCheckpointTag cria uma tag anotada local na branch do worker", async () => {
  await withRoot(async (root) => {
    await run("git", ["branch", "feat/488-cache-redis"], root);
    const name = await createCheckpointTag(root, "feat/488-cache-redis", NOW);

    const kind = await run("git", ["cat-file", "-t", `refs/tags/${name}`], root);
    assertEquals(kind.stdout.trim(), "tag"); // tag anotada, não leve
    const remote = await run("git", ["remote"], root);
    assertEquals(remote.stdout.trim(), ""); // nada é publicado: a tag é só local
  });
});

Deno.test("issue #500: SUSPENDED é um estado em que o worker pode encerrar (SubagentStop não o reabre)", () => {
  assertEquals(isTerminal("SUSPENDED"), true);
});

Deno.test("issue #500: a CLI suspende, lista com o prazo e resolve com checkpoint", async () => {
  await withRoot(async (root) => {
    await run("git", ["branch", "feat/488-cache-redis"], root);
    const statusFile = await writeStatus(root, "feat-488-cache-redis", BLOCKED);

    const suspend = await run(
      "deno",
      [
        "run",
        "-A",
        CLI,
        "suspend",
        "--root",
        root,
        "--status-file",
        statusFile,
        "--worktree",
        "/work/cache-redis",
        "--timeout",
        "60",
      ],
      root,
    );
    assertEquals(suspend.code, 0, suspend.stderr);
    assertEquals(JSON.parse(suspend.stdout).id, "dec-issue-488");

    const list = await run("deno", ["run", "-A", CLI, "list", "--root", root], root);
    assertEquals(list.code, 0, list.stderr);
    const listed = JSON.parse(list.stdout);
    assertEquals(listed.pendingDecisions[0].id, "dec-issue-488");
    assertEquals(typeof listed.pendingDecisions[0].secondsLeft, "number");
    assertEquals(listed.pendingDecisions[0].expired, false);

    const resolve = await run(
      "deno",
      [
        "run",
        "-A",
        CLI,
        "resolve",
        "--root",
        root,
        "--id",
        "dec-issue-488",
        "--optimistic",
      ],
      root,
    );
    assertEquals(resolve.code, 0, resolve.stderr);
    const resolved = JSON.parse(resolve.stdout);
    assertMatch(resolved.checkpointTag, /^_vetor_checkpoint_feat-488-cache-redis_\d{8}T\d{6}Z$/);
    // o avanço otimista aplica a opção recomendada pelo worker
    assertEquals(
      resolved.decision,
      "Usar biblioteca nativa redis-client (Recommended)",
    );
    const tags = await run("git", ["tag", "--list", "_vetor_checkpoint_*"], root);
    assertStringIncludes(tags.stdout, resolved.checkpointTag);
    assertStringIncludes(
      await Deno.readTextFile(statusFile),
      "[OPTIMISTIC_DECISION]",
    );
  });
});

Deno.test("issue #500: a decisão humana vem de --option ou de --decision-file, nunca da linha de comando", async () => {
  await withRoot(async (root) => {
    const statusFile = await writeStatus(root, "feat-488-cache-redis", BLOCKED);
    suspendBlocked({ root, statusFile, worktreePath: "/w", now: NOW });

    const byOption = await run(
      "deno",
      ["run", "-A", CLI, "resolve", "--root", root, "--id", "dec-issue-488", "--option", "2"],
      root,
    );
    assertEquals(byOption.code, 0, byOption.stderr);
    assertStringIncludes(
      await Deno.readTextFile(statusFile),
      "Decisão humana: Implementar adaptador genérico sobre interface de cache",
    );

    // texto livre com metacaracteres de shell trafega por arquivo e chega literal
    const again = await writeStatus(root, "feat-488-cache-redis", BLOCKED);
    suspendBlocked({ root, statusFile: again, worktreePath: "/w", now: NOW });
    const decisionFile = `${root}/decision.txt`;
    await Deno.writeTextFile(decisionFile, 'Usar $(rm -rf /) e "aspas"\n');
    const byFile = await run(
      "deno",
      [
        "run",
        "-A",
        CLI,
        "resolve",
        "--root",
        root,
        "--id",
        "dec-issue-488",
        "--decision-file",
        decisionFile,
      ],
      root,
    );
    assertEquals(byFile.code, 0, byFile.stderr);
    assertStringIncludes(
      await Deno.readTextFile(again),
      'Decisão humana: Usar $(rm -rf /) e "aspas"',
    );
  });
});

Deno.test("issue #500: resolve exige exatamente uma fonte e uma opção existente", async () => {
  await withRoot(async (root) => {
    const statusFile = await writeStatus(root, "feat-488-cache-redis", BLOCKED);
    suspendBlocked({ root, statusFile, worktreePath: "/w", now: NOW });
    const base = ["run", "-A", CLI, "resolve", "--root", root, "--id", "dec-issue-488"];

    assertEquals((await run("deno", base, root)).code, 1); // nenhuma fonte
    assertEquals((await run("deno", [...base, "--option", "9"], root)).code, 1); // fora do intervalo
    assertEquals((await run("deno", [...base, "--option", "1", "--optimistic"], root)).code, 1);
    assertEquals(loadInbox(root, NOW).pendingDecisions.length, 1);
  });
});

Deno.test("issue #500: o avanço otimista não segue sem checkpoint (branch inexistente)", async () => {
  await withRoot(async (root) => {
    const statusFile = await writeStatus(root, "feat-488-cache-redis", BLOCKED);
    suspendBlocked({ root, statusFile, worktreePath: "/w", timeoutSeconds: 60, now: NOW });

    const resolve = await run(
      "deno",
      [
        "run",
        "-A",
        CLI,
        "resolve",
        "--root",
        root,
        "--id",
        "dec-issue-488",
        "--optimistic",
      ],
      root,
    );
    assertEquals(resolve.code, 1);
    // nada mudou: a decisão continua pendente e o worker continua suspenso
    assertEquals(loadInbox(root, NOW).pendingDecisions.length, 1);
    assertMatch(await Deno.readTextFile(statusFile), /^Status: SUSPENDED$/m);
  });
});
