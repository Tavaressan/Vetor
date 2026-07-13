// Cria o worktree e prepara suas dependências de forma determinística.
//
// Dois modos, porque um worktree nasce por dois caminhos:
//   - Hook (sem args): recebe o JSON do evento WorktreeCreate no stdin. Substitui a
//     criação git padrão do harness, então precisa criar o worktree E imprimir o path
//     resultante no stdout. Cobre o dispatch com `isolation: "worktree"` do issue-coordinator.
//   - CLI (--path <p>): o worktree já existe (criado pelo skill worktree-create);
//     apenas prepara as dependências.
//
// A preparação é tolerante a falhas: avisa em stderr e segue (o worker ainda pode
// instalar por conta própria). A criação do worktree, no modo hook, é fatal.

import { detectProject, run } from "./lib/project.ts";

interface HookInput {
  worktree_path: string;
  source_dir: string;
  branch: string;
}

async function prepareDeps(worktreePath: string, sourceDir: string): Promise<void> {
  const info = detectProject(sourceDir);

  if (!info.needsInstall) {
    // Deno puro resolve pelo cache global $DENO_DIR; rust/go/gradle não precisam de
    // preparação por worktree.
    console.error(`[vetor] runtime=${info.runtime}: nenhuma preparação necessária.`);
    return;
  }

  if (info.runtime === "deno") {
    const { code, stderr } = await run("deno", ["install"], worktreePath);
    if (code !== 0) console.error(`AVISO: deno install falhou no worktree: ${stderr.trim()}`);
    return;
  }

  if (info.runtime === "node") {
    const target = `${sourceDir}/node_modules`;
    const link = `${worktreePath}/node_modules`;

    // Já preparado (ex.: `worktree.symlinkDirectories` do Claude Code, ou node_modules
    // versionado). Reinstalar aqui destruiria o link existente.
    try {
      await Deno.lstat(link);
      console.error("[vetor] node_modules já presente no worktree; nada a fazer.");
      return;
    } catch { /* ausente: segue para link ou instalação */ }

    // Linkar o node_modules da raiz é ordens de grandeza mais rápido que reinstalar.
    // Junction no Windows dispensa privilégio elevado; symlink de diretório exigiria.
    try {
      await Deno.stat(target);
      await Deno.symlink(target, link, { type: "junction" });
      console.error(`[vetor] node_modules linkado a partir de ${target}`);
      return;
    } catch (e) {
      console.error(`[vetor] link de node_modules indisponível (${e}); instalando.`);
    }

    const pm = info.packageManager ?? "npm";
    const args = pm === "npm"
      ? ["ci", "--prefer-offline", "--no-audit"]
      : ["install"];
    const { code, stderr } = await run(pm, args, worktreePath);
    if (code !== 0) console.error(`AVISO: ${pm} install falhou no worktree: ${stderr.trim()}`);
    return;
  }

  if (info.runtime === "python" && info.packageManager === "poetry") {
    const { code, stderr } = await run("poetry", ["install", "--no-root"], worktreePath);
    if (code !== 0) console.error(`AVISO: poetry install falhou no worktree: ${stderr.trim()}`);
    return;
  }

  console.error(`AVISO: runtime=${info.runtime} sem preparação automática de dependências.`);
}

async function main() {
  const args = Deno.args;
  const pathFlag = args.indexOf("--path");

  if (pathFlag !== -1) {
    const worktreePath = args[pathFlag + 1];
    if (!worktreePath) {
      console.error("ERRO: --path exige um valor.");
      Deno.exit(1);
    }
    const sourceIdx = args.indexOf("--source");
    const sourceDir = sourceIdx !== -1 ? args[sourceIdx + 1] : Deno.cwd();
    await prepareDeps(worktreePath, sourceDir);
    return;
  }

  // Modo hook: o harness delega a criação do worktree a este script.
  const raw = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer());
  let input: HookInput;
  try {
    input = JSON.parse(raw);
  } catch {
    console.error("ERRO: stdin não é um JSON válido de WorktreeCreate.");
    Deno.exit(1);
  }

  const { worktree_path, source_dir, branch } = input;
  if (!worktree_path || !source_dir || !branch) {
    console.error("ERRO: WorktreeCreate sem worktree_path/source_dir/branch.");
    Deno.exit(1);
  }

  // Branch nova por padrão; se já existir, faz checkout dela no worktree.
  let created = await run("git", ["-C", source_dir, "worktree", "add", "-b", branch, worktree_path], source_dir);
  if (created.code !== 0) {
    created = await run("git", ["-C", source_dir, "worktree", "add", worktree_path, branch], source_dir);
  }
  if (created.code !== 0) {
    console.error(`ERRO: git worktree add falhou: ${created.stderr.trim()}`);
    Deno.exit(1);
  }

  await prepareDeps(worktree_path, source_dir);

  // O harness usa esta linha como o path efetivo do worktree.
  console.log(worktree_path);
}

await main();
