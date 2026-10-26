import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { delimiter, join } from "node:path";

function getBashCommand(): string {
  if (Deno.build.os === "windows") {
    const gitBash = "C:/Program Files/Git/bin/bash.exe";
    try {
      if (Deno.statSync(gitBash).isFile) return gitBash;
    } catch {
      // fallback
    }
  }
  return "bash";
}

const SCRIPT = join(Deno.cwd(), "scripts", "vetor-merge.sh");

// `gh` falso dirigido por variáveis de ambiente: cada subcomando devolve o valor já filtrado
// (o script usa `--jq`/`-q`, então o mock imita a saída pós-filtro, não o JSON bruto).
const MOCK_GH = `#!/usr/bin/env bash
echo "$*" >> "$MOCK_LOG"
case "$1 $2" in
  "pr view")
    case "$*" in
      *"--json mergeable,headRefName,baseRefName,title"*)
        printf '%s\\n' "\${MOCK_MERGEABLE:-MERGEABLE}" "\${MOCK_HEAD:-fix-branch}" \\
          "\${MOCK_BASE:-master}" "\${MOCK_TITLE:-Fix}"
        ;;
      *"--json body"*) printf '%s\\n' "\${MOCK_BODY:-Desc}" ;;
      *"--json state"*) printf '%s\\n' "\${MOCK_STATE:-MERGED}" ;;
    esac
    ;;
  "api graphql")
    if [ "\${MOCK_QUEUE:-false}" = "error" ]; then exit 1; fi
    printf '%s\\n' "\${MOCK_QUEUE:-false}"
    ;;
  "pr merge")
    shift 2
    printf 'ARG:%s\\n' "$@" > "$MOCK_MERGE_ARGS"
    exit "\${MOCK_MERGE_EXIT:-0}"
    ;;
esac
exit 0
`;

interface MergeRun {
  code: number;
  stdout: string;
  stderr: string;
  calls: string;
  mergeArgs: string[];
}

// `cwd` padrão é um diretório fora de qualquer repositório: o script só usa o git para apagar a
// branch remota, e assim um teste nunca consegue tocar o remoto real.
async function runMerge(
  args: string[],
  mock: Record<string, string> = {},
  cwd?: string,
): Promise<MergeRun> {
  const tempDir = await Deno.makeTempDir({ prefix: "vetor-merge-mock-" });
  try {
    await Deno.writeTextFile(join(tempDir, "gh"), MOCK_GH);
    if (Deno.build.os !== "windows") {
      await Deno.chmod(join(tempDir, "gh"), 0o755);
    }
    const log = join(tempDir, "calls.log").replace(/\\/g, "/");
    const mergeArgsFile = join(tempDir, "merge-args.log").replace(/\\/g, "/");

    const cmd = new Deno.Command(getBashCommand(), {
      args: [SCRIPT, ...args],
      cwd: cwd ?? tempDir,
      stdout: "piped",
      stderr: "piped",
      env: {
        PATH: `${tempDir}${delimiter}${Deno.env.get("PATH") ?? ""}`,
        MOCK_LOG: log,
        MOCK_MERGE_ARGS: mergeArgsFile,
        ...mock,
      },
    });
    const { code, stdout, stderr } = await cmd.output();

    const read = async (path: string) => {
      try {
        return await Deno.readTextFile(path);
      } catch {
        return "";
      }
    };
    return {
      code,
      stdout: new TextDecoder().decode(stdout).trim(),
      stderr: new TextDecoder().decode(stderr).trim(),
      calls: await read(join(tempDir, "calls.log")),
      mergeArgs: (await read(join(tempDir, "merge-args.log")))
        .split("\n")
        .filter((l) => l.startsWith("ARG:"))
        .map((l) => l.slice(4).replace(/\r$/, "")),
    };
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

Deno.test("vetor-merge.sh rejeita invocação sem argumentos com código 2", async () => {
  const res = await runMerge([]);
  assertEquals(res.code, 2);
  assertStringIncludes(res.stderr, "uso: vetor-merge.sh [--auto] <pr-number>");
});

Deno.test("vetor-merge.sh rejeita argumentos excessivos com código 2", async () => {
  const res = await runMerge(["42", "extra"]);
  assertEquals(res.code, 2);
  assertStringIncludes(res.stderr, "uso: vetor-merge.sh [--auto] <pr-number>");
});

Deno.test("vetor-merge.sh rejeita PR com estado CONFLICTING antes de tentar merge", async () => {
  const res = await runMerge(["100"], { MOCK_MERGEABLE: "CONFLICTING" });
  assertEquals(res.code, 3);
  assertStringIncludes(res.stderr, "CONFLICTING");
  assertEquals(res.mergeArgs, [], "não deve chamar o merge de PR em conflito");
});

Deno.test("vetor-merge.sh merge simples: squash + delete-branch, sem --auto, exit 0 quando MERGED", async () => {
  const res = await runMerge(["101"]);
  assertEquals(res.code, 0);
  assertEquals(res.mergeArgs.slice(0, 3), ["101", "--squash", "--delete-branch"]);
  assert(!res.mergeArgs.includes("--auto"));
});

Deno.test("vetor-merge.sh consulta os campos do PR uma única vez (sem chamadas duplicadas)", async () => {
  const res = await runMerge(["101"]);
  const metaCalls = res.calls.split("\n").filter((l) =>
    l.includes("--json mergeable,headRefName,baseRefName,title")
  );
  assertEquals(metaCalls.length, 1);
});

Deno.test("vetor-merge.sh repassa título com aspas e acentos intacto para --subject", async () => {
  const title = 'fix(x): trata "aspas" e acentuação (#1)';
  const res = await runMerge(["101"], { MOCK_TITLE: title });
  assertEquals(res.code, 0);
  const idx = res.mergeArgs.indexOf("--subject");
  assert(idx >= 0, "deve passar --subject");
  assertEquals(res.mergeArgs[idx + 1], title);
});

Deno.test("vetor-merge.sh --auto explícito adiciona --auto e sai com 4 quando o PR fica OPEN (enfileirado)", async () => {
  const res = await runMerge(["--auto", "101"], { MOCK_STATE: "OPEN" });
  assertEquals(res.code, 4);
  assert(res.mergeArgs.includes("--auto"));
  assertStringIncludes(res.stdout, "ENFILEIRADO");
  assert(!res.stdout.includes("mergeado no remoto"), "enfileirado não é merge concluído");
});

Deno.test("vetor-merge.sh --auto sai com 0 quando o PR já está MERGED", async () => {
  const res = await runMerge(["--auto", "101"], { MOCK_STATE: "MERGED" });
  assertEquals(res.code, 0);
  assert(res.mergeArgs.includes("--auto"));
});

Deno.test("vetor-merge.sh detecta merge queue no branch base: usa --auto e omite --delete-branch", async () => {
  const res = await runMerge(["101"], { MOCK_QUEUE: "true", MOCK_STATE: "OPEN" });
  assertEquals(res.code, 4);
  assert(res.mergeArgs.includes("--auto"));
  // o gh recusa --delete-branch quando o branch base exige merge queue
  assert(!res.mergeArgs.includes("--delete-branch"));
  assertStringIncludes(res.calls, "api graphql");
});

Deno.test("vetor-merge.sh sem merge queue não liga --auto mesmo que a consulta responda false", async () => {
  const res = await runMerge(["101"], { MOCK_QUEUE: "false" });
  assertEquals(res.code, 0);
  assert(!res.mergeArgs.includes("--auto"));
  assert(res.mergeArgs.includes("--delete-branch"));
});

Deno.test("vetor-merge.sh: falha na consulta de merge queue não liga --auto (segue o merge direto)", async () => {
  const res = await runMerge(["101"], { MOCK_QUEUE: "error" });
  assertEquals(res.code, 0);
  assert(!res.mergeArgs.includes("--auto"));
});

Deno.test("vetor-merge.sh: gh sai com 0 mas o PR segue OPEN sem --auto (fila não detectada) vira exit 4, não 0", async () => {
  const res = await runMerge(["101"], { MOCK_QUEUE: "false", MOCK_STATE: "OPEN" });
  assertEquals(res.code, 4);
  assertStringIncludes(res.stdout, "ENFILEIRADO");
});

Deno.test("vetor-merge.sh: gh falha e o PR segue OPEN => exit 3", async () => {
  const res = await runMerge(["101"], { MOCK_MERGE_EXIT: "1", MOCK_STATE: "OPEN" });
  assertEquals(res.code, 3);
  assertStringIncludes(res.stderr, "NÃO foi mergeado");
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const out = await new Deno.Command("git", {
    args: ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(out.stderr)}`);
  }
  return new TextDecoder().decode(out.stdout).trim();
}

Deno.test("vetor-merge.sh: gh falha no cleanup local mas o PR está MERGED => exit 0 e apaga a branch remota", async () => {
  // origin local (bare) com a branch do PR: nada aqui toca a rede nem o remoto real.
  const base = await Deno.makeTempDir({ prefix: "vetor-merge-origin-" });
  try {
    const origin = join(base, "origin.git");
    const clone = join(base, "clone");
    await git(base, "init", "--bare", "-b", "master", origin);
    await git(base, "clone", origin, clone);
    await Deno.writeTextFile(join(clone, "a.txt"), "a");
    await git(clone, "add", "a.txt");
    await git(clone, "commit", "-m", "init");
    await git(clone, "push", "origin", "HEAD:master");
    await git(clone, "push", "origin", "HEAD:refs/heads/fix-branch");
    assertStringIncludes(await git(clone, "ls-remote", "--heads", "origin"), "fix-branch");

    const res = await runMerge(
      ["101"],
      { MOCK_MERGE_EXIT: "1", MOCK_STATE: "MERGED" },
      clone,
    );
    assertEquals(res.code, 0);
    assertStringIncludes(res.stdout, "mergeado no remoto");
    assert(
      !(await git(clone, "ls-remote", "--heads", "origin")).includes("fix-branch"),
      "a branch remota deve ser apagada explicitamente",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
