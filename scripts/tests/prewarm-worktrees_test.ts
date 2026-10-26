import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  claimPrewarm,
  discardPrewarm,
  manifestPath,
  readManifest,
  startPrewarm,
  validateGroups,
} from "../prewarm-worktrees.ts";
import { prepareFailedMarkerPath } from "../lib/status.ts";

async function git(args: string[], cwd: string): Promise<{ code: number; stdout: string }> {
  const { code, stdout } = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code, stdout: new TextDecoder().decode(stdout).trim() };
}

/** Repo temporário com um commit; `withOrigin` publica `main` num remoto bare local. */
async function makeRepo(
  withOrigin: boolean,
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await Deno.realPath(await Deno.makeTempDir());
  const bare = withOrigin ? await Deno.realPath(await Deno.makeTempDir()) : null;
  await git(["init", "-q", "-b", "main"], root);
  await git(["config", "user.email", "test@example.com"], root);
  await git(["config", "user.name", "Test"], root);
  await Deno.writeTextFile(`${root}/README.md`, "base\n");
  await git(["add", "."], root);
  await git(["commit", "-q", "-m", "init"], root);
  if (bare) {
    await git(["init", "-q", "--bare", "-b", "main"], bare);
    await git(["remote", "add", "origin", bare], root);
    await git(["push", "-q", "origin", "main"], root);
  }
  return {
    root,
    cleanup: async () => {
      // Remove os worktrees registrados antes de apagar o diretório (evita handles no Windows).
      await git(["worktree", "prune"], root);
      await Deno.remove(root, { recursive: true }).catch(() => {});
      if (bare) await Deno.remove(bare, { recursive: true }).catch(() => {});
    },
  };
}

const GROUPS = [
  { slug: "alpha", branch: "feat/1-alpha" },
  { slug: "beta", branch: "fix/2-beta" },
];

Deno.test("validateGroups aceita slug/branch válidos e rejeita entradas perigosas", () => {
  assertEquals(validateGroups(GROUPS), GROUPS);
  assertThrows(() => validateGroups([]), Error, "ao menos um grupo");
  assertThrows(() => validateGroups({}), Error, "lista");
  assertThrows(() => validateGroups([{ slug: "Bad_Slug", branch: "feat/1-x" }]), Error, "slug");
  assertThrows(() => validateGroups([{ slug: "a".repeat(31), branch: "feat/1-x" }]), Error, "slug");
  assertThrows(() => validateGroups([{ slug: "ok", branch: "--force" }]), Error, "branch");
  assertThrows(() => validateGroups([{ slug: "ok", branch: "feat/../x" }]), Error, "branch");
  assertThrows(() => validateGroups([{ slug: "ok", branch: "weird/1-x" }]), Error, "branch");
  assertThrows(
    () => validateGroups([GROUPS[0], { slug: "alpha", branch: "feat/9-other" }]),
    Error,
    "duplicado",
  );
});

Deno.test("startPrewarm cria worktree e branch a partir de origin/<base>, sem upstream, com manifest", async () => {
  const { root, cleanup } = await makeRepo(true);
  try {
    // Avança o remoto além do main local: o pre-warm deve nascer do remoto (mais fresco).
    const other = await Deno.realPath(await Deno.makeTempDir());
    await git(
      ["clone", "-q", (await git(["remote", "get-url", "origin"], root)).stdout, other],
      root,
    );
    await git(["config", "user.email", "t@example.com"], other);
    await git(["config", "user.name", "T"], other);
    await Deno.writeTextFile(`${other}/NEW.md`, "novo\n");
    await git(["add", "."], other);
    await git(["commit", "-q", "-m", "remote ahead"], other);
    await git(["push", "-q", "origin", "main"], other);
    const remoteSha = (await git(["rev-parse", "HEAD"], other)).stdout;
    await Deno.remove(other, { recursive: true }).catch(() => {});

    const manifest = await startPrewarm({ root, base: "main", groups: GROUPS });

    assertEquals(manifest.entries.map((e) => [e.slug, e.state]), [
      ["alpha", "ready"],
      ["beta", "ready"],
    ]);
    const alpha = manifest.entries[0];
    assertEquals(alpha.baseSha, remoteSha);
    assertEquals(alpha.path, `${root}/.claude/worktrees/alpha`);
    assert(typeof alpha.worktreeMs === "number" && alpha.worktreeMs >= 0);
    assert(typeof alpha.depsMs === "number" && alpha.depsMs >= 0);
    assertEquals(alpha.depsFailed, false);

    // O worktree existe, está na branch certa e no commit do remoto.
    assertEquals((await git(["branch", "--show-current"], alpha.path)).stdout, "feat/1-alpha");
    assertEquals((await git(["rev-parse", "HEAD"], alpha.path)).stdout, remoteSha);
    await Deno.stat(`${alpha.path}/NEW.md`);

    // --no-track: a branch não herda upstream de origin/main (igual às branches do hook).
    const upstream = await git(["rev-parse", "--abbrev-ref", "feat/1-alpha@{u}"], root);
    assert(upstream.code !== 0, "a branch pré-aquecida não deve ter upstream");

    // O manifest persiste o mesmo estado, e a escrita atômica não deixa .tmp para trás.
    assertEquals(await readManifest(root), manifest);
    assertEquals(manifest.base, "main");
    assert(manifest.finishedAt);
    let tmpLeft = true;
    try {
      await Deno.stat(`${manifestPath(root)}.tmp`);
    } catch {
      tmpLeft = false;
    }
    assertEquals(tmpLeft, false);
  } finally {
    await cleanup();
  }
});

Deno.test("startPrewarm sem origin cai para a branch base local (falha de rede nunca é fatal)", async () => {
  const { root, cleanup } = await makeRepo(false);
  try {
    const manifest = await startPrewarm({ root, base: "main", groups: [GROUPS[0]] });
    assertEquals(manifest.entries[0].state, "ready");
    assertEquals(
      manifest.entries[0].baseSha,
      (await git(["rev-parse", "main"], root)).stdout,
    );
  } finally {
    await cleanup();
  }
});

Deno.test("startPrewarm marca failed sem tocar em path ou branch já existentes", async () => {
  const { root, cleanup } = await makeRepo(false);
  try {
    // Path já ocupado por outro trabalho: nunca entrar nem sobrescrever.
    await Deno.mkdir(`${root}/.claude/worktrees/alpha`, { recursive: true });
    await Deno.writeTextFile(`${root}/.claude/worktrees/alpha/KEEP.md`, "alheio\n");
    // Branch já existente.
    await git(["branch", "fix/2-beta"], root);

    const manifest = await startPrewarm({ root, base: "main", groups: GROUPS });

    assertEquals(manifest.entries.map((e) => e.state), ["failed", "failed"]);
    assertStringIncludes(manifest.entries[0].error ?? "", "path já existe");
    assertStringIncludes(manifest.entries[1].error ?? "", "branch já existe");
    assertEquals(
      await Deno.readTextFile(`${root}/.claude/worktrees/alpha/KEEP.md`),
      "alheio\n",
    );

    // discard nunca remove o que não criou.
    const report = await discardPrewarm({ root });
    assertEquals(report.removed, []);
    await Deno.stat(`${root}/.claude/worktrees/alpha/KEEP.md`);
    assertEquals((await git(["rev-parse", "--verify", "fix/2-beta"], root)).code, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("startPrewarm recusa sobrescrever manifest com worktrees pendentes", async () => {
  const { root, cleanup } = await makeRepo(false);
  try {
    await startPrewarm({ root, base: "main", groups: [GROUPS[0]] });
    await assertRejects(
      () => startPrewarm({ root, base: "main", groups: [GROUPS[1]] }),
      Error,
      "discard",
    );
    // Depois do discard, um novo start é permitido.
    await discardPrewarm({ root });
    const manifest = await startPrewarm({ root, base: "main", groups: [GROUPS[1]] });
    assertEquals(manifest.entries.map((e) => e.slug), ["beta"]);
  } finally {
    await cleanup();
  }
});

Deno.test("startPrewarm mantém ready e sinaliza depsFailed quando a instalação falha", async () => {
  const { root, cleanup } = await makeRepo(false);
  try {
    // package.json sem lockfile: `npm ci` falha sem rede (mesma fixture de prepare-worktree_test).
    await Deno.writeTextFile(`${root}/package.json`, JSON.stringify({ name: "fixture" }));
    await git(["add", "."], root);
    await git(["commit", "-q", "-m", "pkg"], root);

    const manifest = await startPrewarm({ root, base: "main", groups: [GROUPS[0]] });
    const entry = manifest.entries[0];
    assertEquals(entry.state, "ready");
    assertEquals(entry.depsFailed, true);
    await Deno.stat(prepareFailedMarkerPath(entry.path));
  } finally {
    await cleanup();
  }
});

Deno.test("claimPrewarm entrega o worktree pronto uma única vez", async () => {
  const { root, cleanup } = await makeRepo(false);
  try {
    await startPrewarm({ root, base: "main", groups: GROUPS });

    const claimed = await claimPrewarm(root, "alpha");
    assertEquals(claimed.state, "claimed");
    assertEquals((await readManifest(root))?.entries[0].state, "claimed");

    await assertRejects(() => claimPrewarm(root, "alpha"), Error, "não está ready");
    await assertRejects(() => claimPrewarm(root, "inexistente"), Error, "não encontrado");
  } finally {
    await cleanup();
  }
});

Deno.test("claimPrewarm recusa worktree que sumiu do disco (cai para o dispatch clássico)", async () => {
  const { root, cleanup } = await makeRepo(false);
  try {
    const manifest = await startPrewarm({ root, base: "main", groups: [GROUPS[0]] });
    await git(["worktree", "remove", "--force", manifest.entries[0].path], root);
    await assertRejects(() => claimPrewarm(root, "alpha"), Error, "worktree ausente");
    assertEquals((await readManifest(root))?.entries[0].state, "ready");
  } finally {
    await cleanup();
  }
});

Deno.test("discardPrewarm remove só os não usados, preserva claimed/keep e apaga a branch intocada", async () => {
  const { root, cleanup } = await makeRepo(false);
  try {
    const groups = [
      ...GROUPS,
      { slug: "gamma", branch: "chore/3-gamma" },
      { slug: "delta", branch: "docs/4-delta" },
    ];
    const manifest = await startPrewarm({ root, base: "main", groups });
    await claimPrewarm(root, "alpha");

    const started = Date.now();
    const report = await discardPrewarm({ root, keep: ["gamma"] });
    const elapsed = Date.now() - started;

    assertEquals(report.removed.map((e) => e.slug).sort(), ["beta", "delta"]);
    assertEquals(report.skipped.map((e) => e.slug).sort(), ["alpha", "gamma"]);
    assertEquals(report.branchesKept, []);
    assert(typeof report.durationMs === "number");
    assert(elapsed < 10_000, `discard levou ${elapsed}ms (critério RF-06: < 10 s)`);

    // Removidos: path e branch sumiram. Preservados: continuam.
    for (const slug of ["beta", "delta"]) {
      const entry = manifest.entries.find((e) => e.slug === slug)!;
      let exists = true;
      try {
        await Deno.stat(entry.path);
      } catch {
        exists = false;
      }
      assertEquals(exists, false, `${slug} deveria ter sido removido`);
      assert((await git(["rev-parse", "--verify", entry.branch], root)).code !== 0);
    }
    for (const slug of ["alpha", "gamma"]) {
      const entry = manifest.entries.find((e) => e.slug === slug)!;
      await Deno.stat(entry.path);
      assertEquals((await git(["rev-parse", "--verify", entry.branch], root)).code, 0);
    }

    const after = await readManifest(root);
    assertEquals(after?.entries.map((e) => [e.slug, e.state]), [
      ["alpha", "claimed"],
      ["beta", "discarded"],
      ["gamma", "ready"],
      ["delta", "discarded"],
    ]);
  } finally {
    await cleanup();
  }
});

Deno.test("discardPrewarm nunca destrói trabalho: branch com commit é preservada", async () => {
  const { root, cleanup } = await makeRepo(false);
  try {
    const manifest = await startPrewarm({ root, base: "main", groups: [GROUPS[0]] });
    const entry = manifest.entries[0];
    // Alguém commitou na branch antes do discard (ex.: worker iniciado sem claim).
    await Deno.writeTextFile(`${entry.path}/work.md`, "trabalho\n");
    await git(["add", "."], entry.path);
    await git(["commit", "-q", "-m", "work"], entry.path);

    const report = await discardPrewarm({ root });

    // O worktree limpo é removido, mas a branch com commit sobrevive.
    assertEquals(report.removed.map((e) => e.slug), ["alpha"]);
    assertEquals(report.branchesKept, ["feat/1-alpha"]);
    assertEquals((await git(["rev-parse", "--verify", "feat/1-alpha"], root)).code, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("discardPrewarm não força remoção de worktree com mudanças não commitadas", async () => {
  const { root, cleanup } = await makeRepo(false);
  try {
    const manifest = await startPrewarm({ root, base: "main", groups: [GROUPS[0]] });
    const entry = manifest.entries[0];
    await Deno.writeTextFile(`${entry.path}/README.md`, "alterado sem commit\n");

    const report = await discardPrewarm({ root });

    assertEquals(report.removed, []);
    assertEquals(report.failed.map((e) => e.slug), ["alpha"]);
    await Deno.stat(entry.path);
    assertEquals((await readManifest(root))?.entries[0].state, "ready");
  } finally {
    await cleanup();
  }
});
