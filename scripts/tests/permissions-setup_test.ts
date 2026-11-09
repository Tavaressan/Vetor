import { assert, assertEquals } from "@std/assert";
import {
  applyPermissions,
  checkPermissions,
  forbiddenRules,
  minimalRules,
} from "../permissions-setup.ts";

// Issue #566: regras mínimas para os fluxos autônomos, aplicadas só com anuência e sem
// sobrescrever settings do usuário.

async function project(files: Record<string, string>): Promise<string> {
  const root = await Deno.makeTempDir();
  for (const [path, content] of Object.entries(files)) {
    await Deno.mkdir(`${root}/${path}`.split("/").slice(0, -1).join("/"), { recursive: true });
    await Deno.writeTextFile(`${root}/${path}`, content);
  }
  return root;
}

Deno.test("permissions-setup: a lista mínima nunca libera merge, push nem comando destrutivo", () => {
  const rules = minimalRules("deno task test");
  assertEquals(forbiddenRules(rules), []);
  assert(rules.includes("Bash(deno task test)"));
  assert(rules.includes("Edit(/.claude/vetor/status/**)"));
  assert(!rules.some((r) => r.startsWith("Write(")), "Write(...) não casa: a regra é Edit(...)");
  // o detector de proibidas pega o que nunca pode entrar
  assertEquals(
    forbiddenRules(["Bash(gh pr merge *)", "Bash(git push *)", "Bash(*)", "Bash(gh pr view *)"]),
    ["Bash(gh pr merge *)", "Bash(git push *)", "Bash(*)"],
  );
});

Deno.test("permissions-setup: comando de teste com AJUSTE ou sem suíte não vira regra", () => {
  assert(!minimalRules("AJUSTE: defina").some((r) => r.includes("AJUSTE")));
  assert(!minimalRules("sem suíte de testes").some((r) => r.includes("suíte")));
  assert(!minimalRules(null).some((r) => r.includes("test")));
});

Deno.test("permissions-setup: --check detecta regras presentes e ausentes nos três arquivos", async () => {
  const root = await project({
    ".claude/vetor/config.json": JSON.stringify({ testCommand: "deno task test" }),
    ".claude/settings.json": JSON.stringify({ permissions: { allow: ["Bash(gh pr view *)"] } }),
    ".claude/settings.local.json": JSON.stringify({
      permissions: { allow: ["Bash(deno task test)"] },
    }),
  });
  const home = await project({
    ".claude/settings.json": JSON.stringify({
      permissions: { defaultMode: "auto", allow: ["Bash(gh pr list *)"] },
      autoMode: { environment: ["Repositório de plugin Deno"] },
    }),
  });
  try {
    const state = checkPermissions(root, home);
    for (const rule of ["Bash(gh pr view *)", "Bash(deno task test)", "Bash(gh pr list *)"]) {
      assert(state.minimalRules.present.includes(rule), rule);
    }
    assert(state.minimalRules.missing.includes("Edit(/.claude/vetor/status/**)"));
    assertEquals(state.autoMode, { userDefaultModeAuto: true, environmentConfigured: true });
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("permissions-setup: --apply acrescenta sem remover nem alterar o que existe", async () => {
  const existing = {
    model: "opus",
    permissions: { allow: ["Bash(npm run lint)"], deny: ["Bash(curl *)"], defaultMode: "default" },
    hooks: { PreToolUse: [] },
  };
  const root = await project({ ".claude/settings.json": JSON.stringify(existing) });
  try {
    const added = applyPermissions(root, false)!;
    assert(added.length > 0);
    const after = JSON.parse(await Deno.readTextFile(`${root}/.claude/settings.json`));
    assertEquals(after.model, "opus");
    assertEquals(after.hooks, existing.hooks);
    assertEquals(after.permissions.deny, ["Bash(curl *)"]);
    assertEquals(after.permissions.defaultMode, "default");
    assertEquals(after.permissions.allow[0], "Bash(npm run lint)");
    assertEquals(after.permissions.allow.length, 1 + added.length);
    // idempotente
    assertEquals(applyPermissions(root, false), []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("permissions-setup: --apply --local grava em settings.local.json e não toca no de projeto", async () => {
  const root = await project({ ".claude/settings.json": "{}\n" });
  try {
    applyPermissions(root, true);
    assertEquals(await Deno.readTextFile(`${root}/.claude/settings.json`), "{}\n");
    const local = JSON.parse(await Deno.readTextFile(`${root}/.claude/settings.local.json`));
    assert(local.permissions.allow.includes("Bash(gh pr checks *)"));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("permissions-setup: settings com JSON inválido não é sobrescrito", async () => {
  const root = await project({ ".claude/settings.json": "{ quebrado" });
  try {
    assertEquals(applyPermissions(root, false), null);
    assertEquals(await Deno.readTextFile(`${root}/.claude/settings.json`), "{ quebrado");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
