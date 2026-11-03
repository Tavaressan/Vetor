import { assert, assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { delimiter, join } from "node:path";

// Testes de `vetor-checks.sh prepare` e `finalize` (issues #543 e #542) com `gh` mockado e
// repositórios git reais em diretórios temporários (origin bare, root clonado e worktree linkado).

const SCRIPT = join(Deno.cwd(), "scripts", "vetor-checks.sh");

// `gh` falso dirigido por variáveis de ambiente. Cobre o que o prepare e o finalize (via
// vetor-merge.sh, delete-merged-branch) consultam.
const MOCK_GH = `#!/usr/bin/env bash
echo "$*" >> "$MOCK_LOG"
case "$1 $2" in
  "pr list")
    case "$*" in
      *"--json state"*) printf '%s\\n' "\${MOCK_STATE_LIST:-MERGED}" ;;
      *) printf '%s\\n' "\${MOCK_EXISTING_PR:-}" ;;
    esac
    ;;
  "pr create")
    if [ -n "\${MOCK_CREATE_FAIL:-}" ]; then echo "boom" >&2; exit 1; fi
    prev=""
    for a in "$@"; do
      if [ "$prev" = "--body-file" ]; then cp "$a" "$MOCK_BODY_COPY"; fi
      prev="$a"
    done
    echo "https://github.com/o/r/pull/77"
    ;;
  "pr view")
    case "$*" in
      *"--json mergeable,headRefName,baseRefName,title"*)
        printf '%s\\n' "\${MOCK_MERGEABLE:-MERGEABLE}" "\${MOCK_HEAD:-feat/x}" "master" "Titulo"
        ;;
      *"--json body"*) printf '%s\\n' "Corpo" ;;
      *"--json state"*) printf '%s\\n' "\${MOCK_STATE:-MERGED}" ;;
      *"--json url"*) printf '%s\\n' "https://github.com/o/r/pull/\${MOCK_EXISTING_PR:-77}" ;;
    esac
    ;;
  "api graphql") printf '%s\\n' "\${MOCK_QUEUE:-false}" ;;
  "pr merge") exit "\${MOCK_MERGE_EXIT:-0}" ;;
esac
exit 0
`;

const GIT_ENV = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

async function sh(cwd: string, cmd: string, env: Record<string, string> = {}) {
  const out = await new Deno.Command("bash", {
    args: ["-c", cmd],
    cwd,
    stdout: "piped",
    stderr: "piped",
    env: { ...GIT_ENV, ...env },
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

interface Fixture {
  base: string;
  root: string;
  origin: string;
  worktree: string;
  branch: string;
  bin: string;
  statusDir: string;
  statusFile: string;
  preshipFile: string;
  marker: string;
  bodyCopy: string;
  log: string;
}

const BRANCH = "feat/543-ship-deterministico";

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

// root (clone de um origin bare, em master) + worktree linkado numa branch feat/ com 1 commit.
async function setup(statusExtra = ""): Promise<Fixture> {
  const base = await Deno.makeTempDir({ prefix: "vetor-prep-" });
  const origin = join(base, "origin.git");
  const root = join(base, "root");
  const worktree = join(base, "wt");
  const bin = join(base, "bin");
  await Deno.mkdir(bin);
  await Deno.writeTextFile(join(bin, "gh"), MOCK_GH);
  await Deno.chmod(join(bin, "gh"), 0o755);

  await sh(base, `git init -q --bare -b master origin.git && git clone -q origin.git root 2>&1`);
  await sh(
    root,
    `git checkout -q -b master && echo base > a.txt && git add . && git commit -q -m base && git push -q -u origin master`,
  );
  await sh(root, `git remote set-head origin master`);
  await sh(root, `git worktree add -q -b ${BRANCH} ${worktree}`);
  await sh(
    worktree,
    `echo feat > f.txt && git add . && git commit -q -m "feat: entrega determinística"`,
  );

  const statusDir = join(root, ".claude", "vetor", "status");
  await Deno.mkdir(statusDir, { recursive: true });
  const sanitized = BRANCH.replaceAll("/", "-");
  const statusFile = join(statusDir, `${sanitized}.md`);
  await Deno.writeTextFile(
    statusFile,
    `# Agent Status — ${BRANCH}\nStatus: GREEN\nIteration: 2/5 (Issue #543)\n${statusExtra}`,
  );
  const preshipFile = join(statusDir, `${sanitized}-preship.json`);
  return {
    base,
    root,
    origin,
    worktree,
    branch: BRANCH,
    bin,
    statusDir,
    statusFile,
    preshipFile,
    marker: join(base, "tests-ran"),
    bodyCopy: join(base, "body.md"),
    log: join(base, "gh.log"),
  };
}

function ghEnv(f: Fixture, extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: `${f.bin}${delimiter}${Deno.env.get("PATH") ?? ""}`,
    MOCK_LOG: f.log,
    MOCK_BODY_COPY: f.bodyCopy,
    VETOR_PUSH_RETRY_DELAY: "0",
    ...extra,
  };
}

function run(f: Fixture, args: string, extra: Record<string, string> = {}, cwd?: string) {
  return sh(cwd ?? f.root, `bash "${SCRIPT}" ${args}`, ghEnv(f, extra));
}

const touchCmd = (f: Fixture) => `--test-cmd 'touch ${f.marker}'`;

async function ghCalls(f: Fixture): Promise<string> {
  try {
    return await Deno.readTextFile(f.log);
  } catch {
    return "";
  }
}

async function cleanup(f: Fixture) {
  await Deno.remove(f.base, { recursive: true });
}

async function remoteHasBranch(f: Fixture): Promise<boolean> {
  const r = await sh(f.root, `git ls-remote --heads origin ${f.branch}`);
  return r.stdout.trim().length > 0;
}

Deno.test("prepare: sucesso grava PR_STAGED, preship.json, push e PR draft com Closes e --body-file", async () => {
  const f = await setup();
  try {
    const r = await run(f, `prepare "${f.worktree}" 543 ${touchCmd(f)}`);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "PR_STAGED #77 https://github.com/o/r/pull/77");
    assert(await exists(f.marker), "a suíte deveria ter rodado");
    assert(await remoteHasBranch(f), "a branch deveria ter sido enviada");

    const calls = await ghCalls(f);
    assertMatch(
      calls,
      /pr create --title feat: entrega determinística --body-file \S+ --draft --base master/,
    );
    const body = await Deno.readTextFile(f.bodyCopy);
    assertStringIncludes(body, "Closes #543");
    assertStringIncludes(body, "- feat: entrega determinística");

    const status = await Deno.readTextFile(f.statusFile);
    assertStringIncludes(status, "Status: PR_STAGED");
    assertStringIncludes(status, "PR: #77 (https://github.com/o/r/pull/77)");
    const preship = JSON.parse(await Deno.readTextFile(f.preshipFile));
    assertEquals(preship.prNumber, 77);
    assertEquals(preship.branch, f.branch);
    assertEquals(preship.ciStatus, "PENDING");
  } finally {
    await cleanup(f);
  }
});

Deno.test("prepare: várias issues geram uma linha Closes por issue; vários commits usam o template de título", async () => {
  const f = await setup();
  try {
    await sh(f.worktree, `echo 2 > g.txt && git add . && git commit -q -m "feat: segundo"`);
    const r = await run(f, `prepare "${f.worktree}" 543 542 ${touchCmd(f)}`);
    assertEquals(r.code, 0, r.stderr);
    const body = await Deno.readTextFile(f.bodyCopy);
    assertStringIncludes(body, "Closes #543\nCloses #542");
    assertMatch(await ghCalls(f), /--title feat\(ship-deterministico\): /);
  } finally {
    await cleanup(f);
  }
});

Deno.test("prepare: teste vermelho sai com 3, não faz push nem cria PR", async () => {
  const f = await setup();
  try {
    const r = await run(f, `prepare "${f.worktree}" 543 --test-cmd 'echo vermelho; false'`);
    assertEquals(r.code, 3);
    assertStringIncludes(r.stderr, "FALHA(teste)");
    assertEquals(await remoteHasBranch(f), false);
    assertEquals((await ghCalls(f)).includes("pr create"), false);
    assertStringIncludes(await Deno.readTextFile(f.statusFile), "Status: GREEN");
  } finally {
    await cleanup(f);
  }
});

Deno.test("prepare: conflito no sync sai com 3, aborta o merge e preserva o worktree", async () => {
  const f = await setup();
  try {
    await sh(f.worktree, `echo mine > a.txt && git commit -q -am "mine"`);
    await sh(
      f.root,
      `echo theirs > a.txt && git commit -q -am theirs && git push -q origin master`,
    );
    const r = await run(f, `prepare "${f.worktree}" 543 ${touchCmd(f)}`);
    assertEquals(r.code, 3);
    assertStringIncludes(r.stderr, "FALHA(sync)");
    assertEquals(await exists(join(f.worktree, ".git")), true);
    const st = await sh(
      f.worktree,
      `git status --porcelain && test ! -e "$(git rev-parse --git-path MERGE_HEAD)"`,
    );
    assertEquals(st.code, 0);
    assertEquals(await exists(f.marker), false);
  } finally {
    await cleanup(f);
  }
});

Deno.test("prepare: push que falha sai com 5 sem criar PR", async () => {
  const f = await setup();
  try {
    // o hook pre-receive do origin rejeita a branch de trabalho
    const hook = join(f.origin, "hooks", "pre-receive");
    await Deno.writeTextFile(hook, "#!/bin/sh\nexit 1\n");
    await Deno.chmod(hook, 0o755);
    const r = await run(f, `prepare "${f.worktree}" 543 ${touchCmd(f)}`);
    assertEquals(r.code, 5);
    assertStringIncludes(r.stderr, "FALHA(push)");
    assertEquals((await ghCalls(f)).includes("pr create"), false);
  } finally {
    await cleanup(f);
  }
});

Deno.test("prepare: falha do gh pr create sai com 5", async () => {
  const f = await setup();
  try {
    const r = await run(f, `prepare "${f.worktree}" 543 ${touchCmd(f)}`, { MOCK_CREATE_FAIL: "1" });
    assertEquals(r.code, 5);
    assertStringIncludes(r.stderr, "FALHA(pr)");
    assertEquals(await exists(f.preshipFile), false);
  } finally {
    await cleanup(f);
  }
});

Deno.test("prepare: PR já aberto para a branch é reaproveitado (idempotente)", async () => {
  const f = await setup();
  try {
    const r = await run(f, `prepare "${f.worktree}" 543 ${touchCmd(f)}`, {
      MOCK_EXISTING_PR: "91",
    });
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "PR_STAGED #91");
    assertEquals((await ghCalls(f)).includes("pr create"), false);
  } finally {
    await cleanup(f);
  }
});

Deno.test("prepare: uso incorreto e fora de worktree", async () => {
  const f = await setup();
  try {
    assertEquals((await run(f, `prepare`)).code, 2);
    assertEquals((await run(f, `prepare "${f.worktree}" abc`)).code, 2);
    const r = await run(f, `prepare "${f.root}" 543 ${touchCmd(f)}`);
    assertEquals(r.code, 1);
  } finally {
    await cleanup(f);
  }
});

Deno.test("prepare: sem --test-cmd resolve o comando do module-test-map pelos arquivos tocados", async () => {
  const f = await setup();
  try {
    const dir = join(f.root, ".claude", "vetor");
    await Deno.writeTextFile(
      join(dir, "module-test-map.md"),
      `## Comandos por módulo\n\n| Módulo | Comando headless | Notas |\n|---|---|---|\n| \`root\` | \`touch ${f.marker}\` | x |\n| \`docs\` | \`sem suíte de testes\` | y |\n\n## Detecção de módulo por arquivos alterados\n\n| Prefixo do path | Módulo |\n|---|---|\n| \`docs/\` | \`docs\` |\n| \`./\` | \`root\` |\n\n## Regras\n`,
    );
    const r = await run(f, `prepare "${f.worktree}" 543`);
    assertEquals(r.code, 0, r.stderr);
    assert(await exists(f.marker), "o comando do módulo root deveria ter rodado");
  } finally {
    await cleanup(f);
  }
});

// --- #542: pular a suíte quando o SHA já foi testado no GREEN -------------------------------------

async function headSha(f: Fixture): Promise<string> {
  return (await sh(f.worktree, "git rev-parse HEAD")).stdout.trim();
}

Deno.test("#542: HEAD igual ao SHA testado e sync sem commits pula a suíte e registra o motivo", async () => {
  const f = await setup();
  try {
    const sha = await headSha(f);
    await Deno.writeTextFile(
      f.statusFile,
      `# Agent Status\nStatus: GREEN\nIteration: 2/5 (Issue #542)\nTested: ${sha} deno task test pass\n`,
    );
    const r = await run(f, `prepare "${f.worktree}" 542 ${touchCmd(f)}`);
    assertEquals(r.code, 0, r.stderr);
    assertEquals(await exists(f.marker), false, "a suíte não deveria rodar");
    assertStringIncludes(r.stdout, "Testes locais pulados");
    assertStringIncludes(await Deno.readTextFile(f.bodyCopy), "skipped: HEAD");
    // a linha Tested: sobrevive à reescrita do status file
    assertStringIncludes(
      await Deno.readTextFile(f.statusFile),
      `Tested: ${sha} deno task test pass`,
    );
  } finally {
    await cleanup(f);
  }
});

Deno.test("#542: HEAD diferente do SHA testado volta a rodar a suíte", async () => {
  const f = await setup();
  try {
    const sha = await headSha(f);
    await sh(f.worktree, `echo x > h.txt && git add . && git commit -q -m "feat: depois do green"`);
    await Deno.writeTextFile(f.statusFile, `Status: GREEN\nTested: ${sha} deno task test pass\n`);
    const r = await run(f, `prepare "${f.worktree}" 542 ${touchCmd(f)}`);
    assertEquals(r.code, 0, r.stderr);
    assert(await exists(f.marker), "HEAD mudou: a suíte deveria rodar");
  } finally {
    await cleanup(f);
  }
});

Deno.test("#542: sync que trouxe commits da default volta a rodar a suíte mesmo com HEAD testado", async () => {
  const f = await setup();
  try {
    const sha = await headSha(f);
    await Deno.writeTextFile(f.statusFile, `Status: GREEN\nTested: ${sha} deno task test pass\n`);
    await sh(
      f.root,
      `echo n > n.txt && git add . && git commit -q -m novo && git push -q origin master`,
    );
    const r = await run(f, `prepare "${f.worktree}" 542 ${touchCmd(f)}`);
    assertEquals(r.code, 0, r.stderr);
    assert(await exists(f.marker), "o sync trouxe commits: a suíte deveria rodar");
    assertEquals(r.stdout.includes("Testes locais pulados"), false);
  } finally {
    await cleanup(f);
  }
});

// --- finalize --------------------------------------------------------------------------------------

async function stage(f: Fixture) {
  await Deno.writeTextFile(f.preshipFile, "{}");
  await Deno.writeTextFile(f.statusFile, "Status: PR_STAGED\n");
  await Deno.writeTextFile(
    join(f.statusDir, `${f.branch.replaceAll("/", "-")}-touched-files.json`),
    "{}",
  );
}

Deno.test("finalize: merge concluído faz sync-root e cleanup completo, inclusive o preship.json", async () => {
  const f = await setup();
  try {
    await stage(f);
    const r = await run(f, `finalize 77 ${f.branch}`, { MOCK_STATE: "MERGED" });
    assertEquals(r.code, 0, r.stderr);
    assertEquals(await exists(f.worktree), false, "worktree deveria ter sido removido");
    const br = await sh(f.root, `git branch --list ${f.branch}`);
    assertEquals(br.stdout.trim(), "");
    assertEquals(await exists(f.statusFile), false);
    assertEquals(await exists(f.preshipFile), false);
    assertEquals(
      await exists(join(f.statusDir, "feat-543-ship-deterministico-touched-files.json")),
      false,
    );
  } finally {
    await cleanup(f);
  }
});

Deno.test("finalize: merge só enfileirado sai com 4 e preserva worktree, branch, status e preship.json", async () => {
  const f = await setup();
  try {
    await stage(f);
    const r = await run(f, `finalize 77 ${f.branch}`, { MOCK_QUEUE: "true", MOCK_STATE: "OPEN" });
    assertEquals(r.code, 4);
    assertEquals(await exists(f.worktree), true);
    assertStringIncludes((await sh(f.root, `git branch --list ${f.branch}`)).stdout, f.branch);
    assertEquals(await exists(f.statusFile), true);
    assertEquals(await exists(f.preshipFile), true);
  } finally {
    await cleanup(f);
  }
});

Deno.test("finalize: merge que não aconteceu (CONFLICTING) sai com 3 e preserva tudo", async () => {
  const f = await setup();
  try {
    await stage(f);
    const r = await run(f, `finalize 77 ${f.branch}`, { MOCK_MERGEABLE: "CONFLICTING" });
    assertEquals(r.code, 3);
    assertEquals(await exists(f.worktree), true);
    assertEquals(await exists(f.preshipFile), true);
  } finally {
    await cleanup(f);
  }
});

Deno.test("finalize: uso incorreto sai com 2", async () => {
  const f = await setup();
  try {
    assertEquals((await run(f, `finalize`)).code, 2);
    assertEquals((await run(f, `finalize abc ${f.branch}`)).code, 2);
    assertEquals((await run(f, `finalize 77`)).code, 2);
  } finally {
    await cleanup(f);
  }
});
