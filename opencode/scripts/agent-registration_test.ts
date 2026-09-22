// Reprodução da issue #306: `opencode agent list` só reconhece agents definidos em
// .opencode/agent/*.md. `issue-coordinator` vivia em .opencode/skills/issue-coordinator/SKILL.md —
// um diretório diferente, descoberto como skill, não como agent — e por isso nunca era listado nem
// invocável via `opencode run --agent issue-coordinator "<label>"` (caía silenciosamente no agent
// `build` default).
//
// Roda contra o binário `opencode` real quando disponível no PATH; do contrário, pula (o CLI é uma
// dependência externa opcional para dev/CI local, não travável via deno.lock).

import { assertMatch } from "@std/assert";

const OPENCODE_SRC = `${import.meta.dirname}/../`;

async function opencodeAvailable(): Promise<boolean> {
  try {
    const out = await new Deno.Command("opencode", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return out.success;
  } catch {
    return false;
  }
}

async function copyDir(src: string, dest: string): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    const srcPath = `${src}/${entry.name}`;
    const destPath = `${dest}/${entry.name}`;
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}

const AVAILABLE = await opencodeAvailable();

Deno.test({
  name: "opencode agent list reconhece issue-coordinator (CLI real)",
  ignore: !AVAILABLE,
  fn: async () => {
    const dir = await Deno.makeTempDir();
    await copyDir(OPENCODE_SRC, `${dir}/.opencode`);

    const out = await new Deno.Command("opencode", {
      args: ["agent", "list"],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();

    const stdout = new TextDecoder().decode(out.stdout);
    // Linha de agente real, ex. "issue-coordinator (primary)" — não basta checar substring: o
    // JSON de permissões impresso logo abaixo de cada agente contém paths de external_directory que
    // incluem "issue-coordinator" mesmo quando ele só existe como skill (falso positivo). O `mode`
    // também é checado: a issue #306 pede explicitamente `mode: primary` (é o agent de entrada,
    // invocado diretamente pelo usuário — diferente de `issue-worker`/`code-review`, despachados
    // programaticamente pelo próprio coordinator).
    assertMatch(stdout, /^issue-coordinator \(primary\)/m);
  },
});

// Reprodução da issue #311: issue-worker e code-review tinham `mode: subagent` no frontmatter, mas
// nunca são invocados via `task` in-process do OpenCode (não existe esse mecanismo com isolamento de
// cwd) — o único uso real deles é como processo `opencode run --dir ... --agent <nome>` isolado,
// disparado programaticamente pelo issue-coordinator/worktree-ship. Invocar um agent `mode: subagent`
// diretamente via `--agent` cai silenciosamente no agent `build` default, ignorando por completo o
// corpo do agent pedido. `mode: primary` (mesmo valor de issue-coordinator, pelo mesmo motivo) é o
// frontmatter correto.
Deno.test({
  name: "opencode agent list reconhece issue-worker e code-review como primary (CLI real)",
  ignore: !AVAILABLE,
  fn: async () => {
    const dir = await Deno.makeTempDir();
    await copyDir(OPENCODE_SRC, `${dir}/.opencode`);

    const out = await new Deno.Command("opencode", {
      args: ["agent", "list"],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
    }).output();

    const stdout = new TextDecoder().decode(out.stdout);
    assertMatch(stdout, /^issue-worker \(primary\)/m);
    assertMatch(stdout, /^code-review \(primary\)/m);
  },
});
