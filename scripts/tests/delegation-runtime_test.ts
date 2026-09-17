import { assertEquals } from "@std/assert";
import { selectDelegationRuntime } from "../lib/delegation-runtime.ts";

// Cobre o critério de aceite da issue #247: seleção de runtime de delegação
// agnóstica de provedor (Gemini/OpenCode/Codex), sem assumir nenhum como
// padrão/preferencial sem configuração ou anuência explícita do usuário.

Deno.test("nenhum runtime disponível -> inline, sem erro", () => {
  const result = selectDelegationRuntime({ available: [], interactive: true });
  assertEquals(result, {
    action: "inline",
    reason: "nenhum runtime de delegação disponível no PATH",
  });
});

Deno.test("um único candidato disponível, sem preferência -> delega direto (sem ambiguidade)", () => {
  const result = selectDelegationRuntime({ available: ["agy"], interactive: false });
  assertEquals(result.action, "delegate");
  assertEquals(result.runtime, "agy");
});

Deno.test("dois ou mais candidatos, sem preferência, sessão interativa -> pergunta ao usuário", () => {
  const result = selectDelegationRuntime({ available: ["agy", "opencode"], interactive: true });
  assertEquals(result.action, "ask");
  assertEquals(result.runtime, undefined);
});

Deno.test("dois ou mais candidatos, sem preferência, sessão headless -> inline (critério de desempate documentado: sem anuência possível, nunca escolhe silenciosamente)", () => {
  const result = selectDelegationRuntime({
    available: ["agy", "opencode", "codex"],
    interactive: false,
  });
  assertEquals(result.action, "inline");
});

Deno.test("preferência configurada e disponível -> delega para a preferência, mesmo com outros candidatos", () => {
  const result = selectDelegationRuntime({
    available: ["agy", "opencode"],
    preferred: "opencode",
    interactive: true,
  });
  assertEquals(result.action, "delegate");
  assertEquals(result.runtime, "opencode");
});

Deno.test("preferência configurada mas indisponível -> inline, nunca substitui silenciosamente por outro runtime", () => {
  const result = selectDelegationRuntime({
    available: ["opencode"],
    preferred: "codex",
    interactive: true,
  });
  assertEquals(result.action, "inline");
});

Deno.test("preferência configurada e único candidato disponível coincide -> delega", () => {
  const result = selectDelegationRuntime({
    available: ["codex"],
    preferred: "codex",
    interactive: false,
  });
  assertEquals(result.action, "delegate");
  assertEquals(result.runtime, "codex");
});
