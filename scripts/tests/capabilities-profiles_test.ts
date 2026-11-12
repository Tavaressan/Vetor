import { assert, assertEquals } from "@std/assert";
import { validateDescriptor } from "../lib/capabilities/validate.ts";
import { embeddedProfiles } from "../lib/capabilities/profiles/mod.ts";

Deno.test("capabilities profiles - todo perfil embutido passa validateDescriptor", () => {
  const ids = new Set<string>();
  for (const profile of embeddedProfiles) {
    const errors = validateDescriptor(profile, { existingIds: ids });
    assertEquals(errors, [], `perfil inválido: ${profile.id}`);
    ids.add(profile.id);
  }
});

Deno.test("capabilities profiles - ids esperados sem Kilo/Kiro", () => {
  const ids = embeddedProfiles.map((p) => p.id).sort();
  assertEquals(ids, ["antigravity", "claude-code", "codex", "opencode"]);
  assert(!ids.includes("kilo"));
  assert(!ids.includes("kiro"));
});

Deno.test("capabilities profiles - nenhuma capacidade declarada sem source", () => {
  for (const profile of embeddedProfiles) {
    for (const [name, claim] of Object.entries(profile.declared)) {
      assert(
        claim && typeof claim.source === "string" && claim.source.trim().length > 0,
        `${profile.id}.${name} sem source citável`,
      );
    }
  }
});
