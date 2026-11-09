// Permissões mínimas para os fluxos autônomos do Vetor no Claude Code (issue #566).
//
// Opcional e aditivo: só faz sentido no Claude Code, cujo `permissions.allow` evita prompts de
// rotina em workers em background. Fontes (consultadas em 2026-11-09):
//   - sintaxe de regras: https://code.claude.com/docs/en/permissions.md
//   - precedência e merge das listas: https://code.claude.com/docs/en/settings.md
//   - auto mode e `autoMode`: https://code.claude.com/docs/en/auto-mode-config.md
//
// Uso: deno run -A scripts/permissions-setup.ts [--check | --apply] [--local] [<root>]
//   --check  (padrão) imprime JSON com as regras mínimas presentes/ausentes e o estado do auto mode
//   --apply  acrescenta as regras ausentes a <root>/.claude/settings.json (ou settings.local.json
//            com --local), sem remover nem alterar nenhuma chave existente
// Exit: 0 = ok | 1 = settings com JSON inválido (nada é gravado) | 2 = uso incorreto.

/** Nunca entram na allowlist: merge, push, entrega e comandos destrutivos. */
const FORBIDDEN = [
  /\bgh pr merge\b/,
  /\bgit push\b/,
  /vetor-merge\.sh/,
  /\bfinalize\b/,
  /\bprepare\b/,
  /\bgit (?:reset|clean|checkout|switch|restore|branch)\b/,
  /safe-remove-worktree|delete-merged-branch|clean-status|carry-changes|sync-root/,
  /^Bash\(\*\)$|^Bash$/,
];

/** Regras de rotina do Vetor: leitura de estado, status files e o comando de teste do projeto. */
export function minimalRules(testCommand: string | null): string[] {
  const rules = [
    // Status files dos workers, na raiz do repositório (`/` = raiz do projeto em settings de projeto).
    "Edit(/.claude/vetor/status/**)",
    "Bash(gh pr view *)",
    "Bash(gh pr checks *)",
    "Bash(gh pr list *)",
    "Bash(gh issue view *)",
    "Bash(gh issue list *)",
    // As skills chamam `bash "$SKILL_DIR/../../scripts/vetor-checks.sh" <sub>`: as duas formas, com e
    // sem aspas antes do subcomando, sem curinga depois do script (que casaria outro subcomando).
    ...["repo-root", "in-worktree", "default-branch", "verify-status", "stalled-workers"].flatMap(
      (sub) => [`Bash(bash *vetor-checks.sh ${sub})`, `Bash(bash *vetor-checks.sh" ${sub})`],
    ),
    "Bash(bash *vetor-status.sh)",
    'Bash(bash *vetor-status.sh")',
  ];
  if (testCommand && !testCommand.startsWith("AJUSTE") && !testCommand.includes("sem suíte")) {
    rules.push(`Bash(${testCommand})`);
  }
  return rules;
}

/** Regras que violam a lista de proibições (usado nos testes e antes de gravar). */
export function forbiddenRules(rules: string[]): string[] {
  return rules.filter((rule) => FORBIDDEN.some((re) => re.test(rule)));
}

type Settings = Record<string, unknown> & { permissions?: { allow?: unknown } };

function readSettings(path: string): Settings | null | "invalid" {
  let text: string;
  try {
    text = Deno.readTextFileSync(path);
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : "invalid";
  } catch {
    return "invalid";
  }
}

function allowOf(settings: Settings | null | "invalid"): string[] {
  if (!settings || settings === "invalid") return [];
  const allow = settings.permissions?.allow;
  return Array.isArray(allow) ? allow.filter((r): r is string => typeof r === "string") : [];
}

function testCommandOf(root: string): string | null {
  const config = readSettings(`${root}/.claude/vetor/config.json`);
  if (!config || config === "invalid") return null;
  return typeof config.testCommand === "string" ? config.testCommand : null;
}

export interface PermissionsState {
  minimalRules: { present: string[]; missing: string[] };
  autoMode: {
    /** `permissions.defaultMode` do usuário é `auto` (de arquivos de projeto o valor não vale). */
    userDefaultModeAuto: boolean;
    /** `autoMode.environment` configurado em ~/.claude/settings.json (o que o /auto-mode-setup grava). */
    environmentConfigured: boolean;
  };
  invalidFiles: string[];
}

export function checkPermissions(root: string, home: string | null): PermissionsState {
  const files = [`${root}/.claude/settings.json`, `${root}/.claude/settings.local.json`];
  const parsed = files.map(readSettings);
  const user = home ? readSettings(`${home}/.claude/settings.json`) : null;
  const allow = new Set([...parsed, user].flatMap(allowOf));
  const rules = minimalRules(testCommandOf(root));
  const userSettings = user && user !== "invalid" ? user : null;
  const autoMode = userSettings?.autoMode as { environment?: unknown } | undefined;
  return {
    minimalRules: {
      present: rules.filter((r) => allow.has(r)),
      missing: rules.filter((r) => !allow.has(r)),
    },
    autoMode: {
      userDefaultModeAuto:
        (userSettings?.permissions as { defaultMode?: unknown } | undefined)?.defaultMode ===
          "auto",
      environmentConfigured: Array.isArray(autoMode?.environment) &&
        autoMode.environment.length > 0,
    },
    invalidFiles: [...files, ...(home ? [`${home}/.claude/settings.json`] : [])].filter((_, i) =>
      (i < parsed.length ? parsed[i] : user) === "invalid"
    ),
  };
}

/**
 * Acrescenta as regras ausentes a um arquivo de settings, preservando tudo o que já existe.
 * Devolve as regras acrescentadas, ou null se o arquivo existe com JSON inválido (nada é gravado).
 */
export function applyPermissions(root: string, local: boolean): string[] | null {
  const path = `${root}/.claude/${local ? "settings.local.json" : "settings.json"}`;
  const current = readSettings(path);
  if (current === "invalid") return null;
  const settings: Settings = current ?? {};
  const rules = minimalRules(testCommandOf(root));
  if (forbiddenRules(rules).length > 0) throw new Error("regra proibida na lista mínima");
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>;
  const allow = Array.isArray(permissions.allow) ? [...permissions.allow] : [];
  const added = rules.filter((r) => !allow.includes(r));
  if (added.length === 0) return [];
  settings.permissions = { ...permissions, allow: [...allow, ...added] };
  Deno.mkdirSync(`${root}/.claude`, { recursive: true });
  Deno.writeTextFileSync(path, JSON.stringify(settings, null, 2) + "\n");
  return added;
}

if (import.meta.main) {
  const flags = Deno.args.filter((a) => a.startsWith("--"));
  const positional = Deno.args.filter((a) => !a.startsWith("--"));
  const unknown = flags.filter((f) => !["--check", "--apply", "--local"].includes(f));
  if (unknown.length > 0 || positional.length > 1) {
    console.error("Uso: permissions-setup.ts [--check | --apply] [--local] [<root>]");
    Deno.exit(2);
  }
  const root = positional[0] ?? Deno.cwd();
  if (flags.includes("--apply")) {
    const added = applyPermissions(root, flags.includes("--local"));
    if (added === null) {
      console.error("ERRO: settings com JSON inválido; nada foi gravado.");
      Deno.exit(1);
    }
    console.log(JSON.stringify({ added }));
  } else {
    console.log(JSON.stringify(checkPermissions(root, Deno.env.get("HOME") ?? null)));
  }
}
