// Adaptação exclusiva do OpenCode (issue #477): `normalizeCwd` vivia na cópia de
// `lib/project.ts` que `opencode/scripts/` mantinha. Só `resolve-model.ts` e
// `ensure-external-directory-permission.ts` precisam dela, porque recebem o `cwd` de
// `$(pwd -W 2>/dev/null || pwd)` no Git Bash do Windows; os scripts canônicos recebem o cwd
// nativo do harness. Por isso ela fica aqui, em vez de entrar no canônico `scripts/lib/project.ts`.

/**
 * Issue #307: no Git Bash do Windows, `$(pwd)` produz um path POSIX-style (`/c/Users/...`), não
 * nativo (`C:\Users\...`). `Deno.Command`/`Deno.statSync` no Windows não resolvem esse formato —
 * `git rev-parse` falha ao spawnar (`No such cwd`) e `Deno.statSync` trata `/c/...` como relativo à
 * raiz da unidade atual, nunca encontrando o arquivo real. Normaliza só no Windows (no Linux/macOS
 * `/c/Users/x` já é um path absoluto legítimo, nunca deve ser reescrito).
 */
export function normalizeCwd(cwd: string): string {
  if (Deno.build.os !== "windows") return cwd;
  const match = cwd.match(/^\/([a-zA-Z])\/(.*)$/);
  if (!match) return cwd;
  const [, drive, rest] = match;
  return `${drive.toUpperCase()}:/${rest}`;
}
